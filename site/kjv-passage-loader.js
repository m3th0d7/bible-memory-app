/**
 * PUBLIC, explicit user-selected King James Version passages only.
 * Uses a fixed HelloAO endpoint, rejects redirects, and verifies every verse.
 * The supplied catalog is used only for the 66-book/chapter bounds; KJV verse
 * counts are taken from the KJV chapter response, not copied from another Bible.
 */
export const KJV_CHAPTER_ORIGIN='https://bible.helloao.org';
export const KJV_TRANSLATION_ID='eng_kjv';
const maxResponseBytes=2*1024*1024;

export class KJVPassageError extends Error {
  constructor(status,message){super(message);this.name='KJVPassageError';this.status=status;}
}
const fail=(status,message)=>{throw new KJVPassageError(status,message);};

function bookMap(books){
  if(!Array.isArray(books)||books.length!==66)fail(400,'Provide the approved 66-book Bible catalog.');
  const map=new Map();
  for(const source of books){
    if(!source||typeof source!=='object'||Array.isArray(source)||
      typeof source.code!=='string'||! /^[A-Z0-9]{3}$/.test(source.code)||
      map.has(source.code)||typeof source.name!=='string'||!source.name.length||
      source.name.length>100||!Number.isInteger(source.chapterCount)||
      source.chapterCount<1||source.chapterCount>150)fail(400,'Invalid approved Bible book bounds.');
    map.set(source.code,{code:source.code,name:source.name,chapterCount:source.chapterCount});
  }
  return map;
}

function chosenSelection(selection,books){
  if(!selection||typeof selection!=='object'||Array.isArray(selection)||
    Object.keys(selection).some(k=>!['bookCode','chapter','startVerse','endVerse'].includes(k)))
    fail(400,'Choose one book, chapter, and verse range.');
  const {bookCode,chapter,startVerse,endVerse}=selection,book=books.get(bookCode);
  if(!book||!Number.isInteger(chapter)||chapter<1||chapter>book.chapterCount||
    !Number.isInteger(startVerse)||!Number.isInteger(endVerse)||
    startVerse<1||endVerse<startVerse||endVerse>176)
    fail(400,'Choose a valid KJV book, chapter, and verse range.');
  return {bookCode,chapter,startVerse,endVerse};
}

function chapterVerses(data,selection){
  const {bookCode,chapter}=selection,ref=data?.thisChapterReference;
  if(!data||typeof data!=='object'||Array.isArray(data)||
    data.translation?.id!==KJV_TRANSLATION_ID||data.book?.id!==bookCode||
    data.chapter?.number!==chapter||ref?.translationId!==KJV_TRANSLATION_ID||
    ref?.book!==bookCode||ref?.chapter!==chapter||
    !Number.isInteger(data.numberOfVerses)||data.numberOfVerses<1||
    data.numberOfVerses>176||!Array.isArray(data.chapter?.content))
    fail(502,'The Scripture response did not match the selected KJV chapter.');
  const rows=data.chapter.content.filter(node=>node?.type==='verse');
  if(rows.length!==data.numberOfVerses||rows.some((v,index)=>
    !Number.isInteger(v.number)||v.number!==index+1||
    typeof v.text!=='string'||!v.text.trim().length||v.text.length>10000))
    fail(502,'The KJV response did not contain the complete exact verse sequence.');
  return rows;
}

export function validateKJVChapter(data,selection){
  const rows=chapterVerses(data,selection);
  if(selection.endVerse>rows.length)fail(400,'The selected verse range is outside this KJV chapter.');
  return rows;
}

export function createKJVPassageLoader({books,fetcher=globalThis.fetch,timeoutMs=12000}={}){
  const approved=bookMap(books);
  if(typeof fetcher!=='function')fail(503,'The public Scripture source cannot be loaded in this browser.');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)fail(400,'Invalid Scripture request timeout.');
  const cache=new Map();

  async function loadChapter(bookCode,chapter){
    const book=approved.get(bookCode);
    if(!book||!Number.isInteger(chapter)||chapter<1||chapter>book.chapterCount)
      fail(400,'Choose an approved KJV book and chapter.');
    const key=bookCode+':'+chapter;
    if(cache.has(key))return cache.get(key);
    const requestPromise=(async()=>{
      const url=KJV_CHAPTER_ORIGIN+'/api/'+KJV_TRANSLATION_ID+'/'+bookCode+'/'+chapter+'.simple.json';
      const controller=new AbortController();let timer;
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{
        controller.abort();reject(new KJVPassageError(504,'The KJV Scripture request timed out. Please try again.'));
      },timeoutMs);});
      try{
        const request=(async()=>{
          const response=await fetcher(url,{signal:controller.signal,redirect:'error',credentials:'omit',
            referrerPolicy:'no-referrer',headers:{Accept:'application/json'}});
          if(!response?.ok||response.redirected===true||response.url&&response.url!==url)
            fail(502,'The KJV Scripture source was unavailable or redirected.');
          let data;
          try{
            const body=await response.text();
            if(new TextEncoder().encode(body).byteLength>maxResponseBytes)fail(502,'The KJV Scripture response was too large.');
            data=JSON.parse(body);
          }catch(error){if(error instanceof KJVPassageError)throw error;fail(502,'The KJV Scripture response was not valid JSON.');}
          const selection={bookCode,chapter,startVerse:1,endVerse:1};
          const rows=chapterVerses(data,selection);
          return {bookCode,chapter,bookName:book.name,numberOfVerses:rows.length,verses:rows.map(({number,text})=>({number,text}))};
        })();
        return await Promise.race([request,timeout]);
      }catch(error){
        if(error instanceof KJVPassageError)throw error;
        fail(503,'The public KJV Scripture source could not be reached. No other source was used.');
      }finally{clearTimeout(timer);}
    })();
    cache.set(key,requestPromise);
    try{return await requestPromise;}catch(error){cache.delete(key);throw error;}
  }

  async function load(selection){
    const chosen=chosenSelection(selection,approved);
    const chapter=await loadChapter(chosen.bookCode,chosen.chapter);
    if(chosen.endVerse>chapter.numberOfVerses)
      fail(400,'The selected verse range is outside this KJV chapter.');
    const verses=chapter.verses.slice(chosen.startVerse-1,chosen.endVerse);
    return {
      id:'kjv-'+chosen.bookCode.toLowerCase()+'-'+chosen.chapter+'-'+chosen.startVerse+'-'+chosen.endVerse,
      kind:'verse',...(chosen.endVerse>chosen.startVerse?{memoryGroup:'extended'}:{}),
      version:1,
      reference:chapter.bookName+' '+chosen.chapter+':'+chosen.startVerse+
        (chosen.endVerse===chosen.startVerse?'':'-'+chosen.endVerse),
      text:verses.map(v=>v.text).join(' '),verses,translation:'KJV'
    };
  }
  load.loadChapter=loadChapter;
  load.validate=selection=>chosenSelection(selection,approved);
  load.bookName=bookCode=>{const book=approved.get(bookCode);if(!book)fail(400,'Choose an approved KJV book.');return book.name;};
  return load;
}
