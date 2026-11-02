/** Isolated PUBLIC browser-local API prototype. No fetch/auth/D1/private content. */
import {createEmptyCard,nextReview,schedulerVersion,memoryCurve} from './scheduling.js';
import {browserTimeZone,validateTimeZone,dayKey,calendarDue,midnight,shiftDay} from './calendar.js';
import {createCmState,cmDate,cmPlacements,cmDueTargets,cmNextDueDate,cmReviewed,cmAdvance,cmEnroll} from './cm-policy.js';
import {progressOverview} from './progress-overview.js';
import {validatePublicBackup} from './backup-validation.js';
import {loadPublicStoryPassage} from './public-passage.js';
import {migrateLegacyPublicRoot} from './public-catalog-compatibility.js';
import {selectedPublicId,selectedPublicDefinition,parseSelectedPublicId} from './public-selected-item.js';
import {isPublicCard,publicCardId,publicCardDefinition,validatePublicCardDefinition} from './public-card.js';
import {normalizeCardInput} from './card-model.js';
import {isPublicSummary,publicSummaryId,publicSummaryInput,publicSummarySource,publicSummaryDefinition,publicSummaryDefinitionInput,validatePublicSummaryDefinition} from './public-summary.js';
export const PUBLIC_DATABASE_PREFIX='bible-memory-public-v1';
export const PUBLIC_BACKUP_FORMAT='bible-memory-public-browser-backup';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clone=value=>JSON.parse(JSON.stringify(value));
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const safeInt=n=>Number.isSafeInteger(n)&&n>=0;
export class PublicMemoryError extends Error {constructor(status,message){super(message);this.name='PublicMemoryError';this.status=status;}}
const fail=(status,message)=>{throw new PublicMemoryError(status,message);};
function keys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail(400,'Invalid fields.');}
function str(value,max=500){return typeof value==='string'&&value.length>0&&value.length<=max;}
export function validateCatalog(input){
 if(!Array.isArray(input)||input.length>10000)fail(400,'Provide an explicit approved catalog array.');
 const allowed=['id','kind','reference','version','text','title','number','passageReference','memoryGroup','members','verses','translation','segments','originalReference','reviewNeeded','provenance','sourcePassage','card','bibleReference','group','tags'];
 const catalog=clone(input),ids=new Set();
 for(const c of catalog){
  keys(c,allowed);
  if(!str(c.id,160)||!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(c.id)||['__proto__','constructor','prototype'].includes(c.id)||ids.has(c.id)||!['verse','chapter','book','sequence','story','card'].includes(c.kind)||!str(c.reference)||!Number.isSafeInteger(c.version)||c.version<1)fail(400,'Invalid approved catalog definition.');
  ids.add(c.id);
  if(c.kind==='card'||c.provenance==='user-card-v1'||c.id.startsWith('card-')){try{validatePublicCardDefinition(c);}catch{fail(400,'Invalid visitor-made card.');}}
  else if(c.provenance!==undefined||c.sourcePassage!==undefined||c.id.startsWith('summary-')||c.card!==undefined||c.bibleReference!==undefined||c.group!==undefined||c.tags!==undefined){try{validatePublicSummaryDefinition(c);}catch{fail(400,'Invalid visitor-authored summary.');}}
  for(const name of ['text','title','passageReference','memoryGroup','translation','originalReference'])if(c[name]!==undefined&&!str(c[name],name==='text'?50000:1000))fail(400,'Invalid public text field.');
  if(c.memoryGroup!==undefined&&(c.memoryGroup!=='extended'||c.kind!=='verse'))fail(400,'Invalid public memory category.');
  if(c.number!==undefined&&(!safeInt(c.number)||c.number<1))fail(400,'Invalid item number.');
  if(c.reviewNeeded!==undefined&&typeof c.reviewNeeded!=='boolean')fail(400,'Invalid review warning.');
  if(c.members!==undefined){if(c.kind!=='sequence'||!Array.isArray(c.members)||!c.members.length)fail(400,'Invalid collection.');const seen=new Set();for(const m of c.members){keys(m,['cardId','version']);if(!str(m.cardId,160)||!Number.isSafeInteger(m.version)||m.version<1||seen.has(m.cardId))fail(400,'Invalid collection member.');seen.add(m.cardId);}}
  if(c.verses!==undefined){if(!Array.isArray(c.verses)||c.verses.length>2000)fail(400,'Invalid public passage.');for(const v of c.verses){keys(v,['number','text']);if(!Number.isInteger(v.number)||v.number<1||!str(v.text,10000))fail(400,'Invalid public verse.');}}
  if(c.segments!==undefined){if(!Array.isArray(c.segments)||c.segments.length>100)fail(400,'Invalid public passage boundary.');for(const s of c.segments){keys(s,['book','bookCode','startChapter','startVerse','endChapter','endVerse']);if(!str(s.book,100)||!str(s.bookCode,10)||!Number.isInteger(s.startChapter)||s.startChapter<1||!Number.isInteger(s.startVerse)||s.startVerse<1||!Number.isInteger(s.endChapter)||s.endChapter<s.startChapter||!(s.endVerse===null||Number.isInteger(s.endVerse)&&s.endVerse>=1))fail(400,'Invalid public passage segment.');}}
 }
 const byId=new Map(catalog.map(c=>[c.id,c]));const assigned=new Set();
 for(const c of catalog)for(const m of c.members||[]){const member=byId.get(m.cardId);if(!member||member.version!==m.version||member.kind==='sequence'||assigned.has(m.cardId))fail(400,'Invalid or multiply assigned public collection member.');assigned.add(m.cardId);}
 return {catalog,byId,assigned};
}
function initial(timeZone){return {version:1,revision:0,storageGeneration:0,items:{},backupMarker:{revision:0,lastDownloadedAt:null,exportedRevision:null},settings:{revision:0,timeZone},cards:{},reviews:[],practice:[],corrections:{},storyNotes:{},cm:{revision:0,plan:{version:1,active:false,sabbath:null,box:null}},receipts:{}};}
function openDatabase(indexedDB,name){
 if(!indexedDB?.open)return Promise.reject(new PublicMemoryError(503,'This browser cannot save local progress. No fallback storage or online save is used.'));
 return new Promise((resolve,reject)=>{let request,blocked=false;try{request=indexedDB.open(name,1);}catch{reject(new PublicMemoryError(503,'Local progress storage is unavailable.'));return;}
 request.onupgradeneeded=()=>request.result.createObjectStore('state');
 request.onerror=()=>reject(new PublicMemoryError(503,'Local progress storage could not open.'));
 request.onblocked=()=>{blocked=true;reject(new PublicMemoryError(503,'Close older app tabs before opening local progress.'));};
 request.onsuccess=()=>{const db=request.result;if(blocked){db.close();return;}db.onversionchange=()=>db.close();resolve(db);};});
}
/** Returns the same data-Promise / Error.status seam as the client api().
 * Native readwrite transaction owns read/CAS/state+receipt/commit across all tabs.
 * A successful response is returned ONLY after IndexedDB confirms transaction completion.
 */
export function createPublicMemoryApi({catalog:input=[],indexedDB=globalThis.indexedDB,databaseName=PUBLIC_DATABASE_PREFIX,now=()=>new Date(),BroadcastChannel=globalThis.BroadcastChannel,passageLoader,kjvPassageLoader}={}){
 if(typeof databaseName!=='string'||!(databaseName===PUBLIC_DATABASE_PREFIX||databaseName.startsWith(PUBLIC_DATABASE_PREFIX+':')))fail(400,'Use the dedicated public storage namespace.');
 const {catalog,byId,assigned}=validateCatalog(input),defaultTimeZone=validateTimeZone(browserTimeZone());
 let dbPromise,closed=false,channel,observedGeneration;const listeners=new Set();
 const open=()=>{if(closed)return Promise.reject(new PublicMemoryError(503,'Local progress connection is closed.'));return dbPromise??=(openDatabase(indexedDB,databaseName));};
 const notify=event=>{for(const fn of listeners)try{fn(event);}catch{};};
 function ensureChannel(){if(!channel&&BroadcastChannel)try{channel=new BroadcastChannel(databaseName);channel.onmessage=event=>{if(event.data?.kind==='local-progress-changed')notify(event.data);};}catch{}}
 function broadcast(event){ensureChannel();const message={kind:'local-progress-changed',...event};try{channel?.postMessage(message);}catch{}notify(message);}
 function transaction(write,fn){return open().then(db=>new Promise((resolve,reject)=>{
  let tx,result,changed=false,restored=false,generation,revision,problem;try{tx=db.transaction('state','readwrite');const store=tx.objectStore('state'),request=store.get('root');
   request.onsuccess=()=>{try{const root=request.result??initial(defaultTimeZone);if(root.version!==1)fail(503,'Unsupported local progress version.');const migrated=migrateLegacyPublicRoot(root);if(migrated)root.revision++;const value=fn(root);result=value.result;changed=value.changed===true||migrated;restored=value.restored===true;generation=root.storageGeneration;revision=root.revision;if(changed)store.put(root,'root');}catch(error){problem=error;tx.abort();}};
   request.onerror=()=>{problem=new PublicMemoryError(503,'Local progress could not be read.');};
   tx.oncomplete=()=>{if(changed)broadcast({storageGeneration:generation,storageRevision:revision,restored});resolve(clone(result));};
   tx.onabort=()=>reject(problem??new PublicMemoryError(503,'Local save was not confirmed. Keep the same request ID and retry; no online fallback was used.'));
   tx.onerror=()=>{};
  }catch(error){reject(error instanceof PublicMemoryError?error:new PublicMemoryError(503,'Local progress transaction could not start.'));}
 }));}
 const definitions=root=>[...catalog,...Object.values(root.items??{})];
 function definition(root,id){const c=root.items?.[id]??byId.get(id);if(!c)fail(404,'Public learning item not found.');return c;}
 const canManage=(root,id)=>(byId.has(id)||Object.hasOwn(root.items??{},id))&&!assigned.has(id);
 function state(root,id,instant){return root.cards[id]??{revision:0,stageRevision:0,stage:'learning',status:'later',skipRevision:0,skipUntil:null,fsrs:clone(createEmptyCard(instant))};}
 function saveState(root,id,instant){return root.cards[id]??=(state(root,id,instant));}
 function activeIds(root,instant,includeSkipped=false){return definitions(root).filter(c=>canManage(root,c.id)).filter(c=>{const s=state(root,c.id,instant);return s.status==='active'&&(includeSkipped||!s.skipUntil||new Date(s.skipUntil)<=instant);}).map(c=>c.id);}
 function cmData(root,instant){const date=dayKey(instant,root.settings.timeZone),active=activeIds(root,instant);return {...root.cm,date,dueIds:root.cm.plan.active&&root.cm.plan.box?cmDueTargets(root.cm.plan.box,date,{sabbath:root.cm.plan.sabbath,activeIds:active}).map(t=>t.id):[]};}
 function invalidateReviewForms(root,instant){for(const c of definitions(root).filter(c=>canManage(root,c.id)))saveState(root,c.id,instant).revision++;}
 function enroll(root,ids,instant){if(root.cm.plan.active&&root.cm.plan.box&&ids.length){const result=cmEnroll(root.cm.plan.box,ids,dayKey(instant,root.settings.timeZone));if(result.enrolledIds.length){root.cm.plan.box=result.nextState;root.cm.revision++;}}}
 function session(root,instant){
  const cm=cmData(root,instant),placements=cm.plan.box?cmPlacements(cm.plan.box):[];
  return {now:instant.toISOString(),storageScope:PUBLIC_DATABASE_PREFIX,storageRevision:root.revision,storageGeneration:root.storageGeneration??0,localOnly:true,totalReviews:root.reviews.length,lastSaved:root.reviews.at(-1)?.reviewed_at??null,scheduler:schedulerVersion,timeZone:root.settings.timeZone,reviewPolicy:cm.plan.active?'charlotte-mason':'adaptive',cmRevision:cm.revision,cmSabbath:cm.plan.sabbath,cmSetUp:!!cm.plan.box,studyAids:{},bookResources:{},memoryRoutes:[],reviewSets:{sets:definitions(root).filter(c=>c.kind==='sequence')},cards:definitions(root).map(c=>{
   const s=state(root,c.id,instant),p=placements.find(x=>x.id===c.id);let due=s.fsrs.due;
   if(cm.plan.active&&p){const target=cm.dueIds.includes(c.id)?cm.date:cmNextDueDate(p,cm.plan.box.completed[c.id]===cm.date?cm.date:shiftDay(cm.date,-1),{sabbath:cm.plan.sabbath});due=midnight(target,root.settings.timeZone).toISOString();}
   const {text,verses,segments,sourcePassage,card,bibleReference,group,...summary}=c;return {...summary,...(isPublicSummary(c)?{custom:true,sourceSelection:publicSummarySource(c)}:{}),...(isPublicCard(c)?{custom:true,userCard:true,cardGroup:group,cardType:card.type}:{}),canManage:canManage(root,c.id),studyStatus:s.status,learningStage:s.status==='later'?'later':s.stage,stageRevision:s.stageRevision,hasReviews:s.fsrs.reps>0,scheduled:canManage(root,c.id)&&s.status==='active'&&(!cm.plan.active||!!p),cmDaily:p?.kind==='daily',cmDue:cm.dueIds.includes(c.id),due,adaptiveDue:s.fsrs.due,revision:s.revision,skipUntil:s.skipUntil,skipRevision:s.skipRevision};
  })};
 }
 function overview(root,instant){return progressOverview(definitions(root).map(c=>({...c,canManage:canManage(root,c.id)})),{reviews:root.reviews,practice:root.practice,legacy:[],cm:Object.values(root.receipts).filter(r=>r.path==='/api/cm').map(r=>({request_id:r.receipt.requestId,outcome_json:JSON.stringify(r.receipt)})),choices:Object.entries(root.cards).map(([card_id,s])=>({card_id,status:s.status})),stages:Object.entries(root.cards).map(([card_id,s])=>({card_id,stage:s.stage})),plans:[{state_json:JSON.stringify(root.cm.plan)}],corrections:Object.entries(root.corrections).map(([event_request_id,c])=>({event_source:'practice',event_request_id,removed:c.removed?1:0,revision:c.revision}))},instant,root.settings.timeZone);}
 function entries(root,instant,query){const day=query.get('day');if(day)try{cmDate(day);}catch{fail(400,'Choose a valid calendar day.');}const includeRemoved=query.get('includeRemoved')==='1';const events=root.practice.filter(p=>!day||dayKey(p.completed_at,root.settings.timeZone)===day).map(p=>({key:'practice:'+p.request_id,targetId:p.target_id,contentVersion:p.content_version,reference:p.reference,at:p.completed_at,day:dayKey(p.completed_at,root.settings.timeZone),kind:p.modality,scheduled:false,canRemove:true,removed:root.corrections[p.request_id]?.removed===true,correctionRevision:root.corrections[p.request_id]?.revision??0})).sort((a,b)=>b.at.localeCompare(a.at)||a.key.localeCompare(b.key));return {day:day??null,total:events.filter(e=>!e.removed).length,removedTotal:events.filter(e=>e.removed).length,events:events.filter(e=>includeRemoved||!e.removed)};}
 function read(root,path,q,instant){
  if(path==='/api/session')return session(root,instant);
  if(path==='/api/preferences')return root.settings;
  if(path==='/api/story-notes'){const c=definition(root,q.get('id'));if(c.kind!=='story')fail(400,'Choose a Story item.');return {cardId:c.id,contentVersion:c.version,...(root.storyNotes[c.id]??{revision:0,outline:''})};}
  if(path==='/api/backup-status'){const marker=root.backupMarker,dates=Object.values(root.receipts).filter(r=>!['/api/backup-marker','/api/preferences','/api/restore'].includes(r.path)).map(r=>r.receipt.savedAt).filter(d=>Number.isFinite(Date.parse(d))).sort(),firstProgressAt=dates[0]??null,anchor=firstProgressAt&&marker.lastDownloadedAt&&marker.lastDownloadedAt>firstProgressAt?marker.lastDownloadedAt:firstProgressAt;return {...marker,firstProgressAt,reminderDue:!!firstProgressAt&&!!anchor&&instant-new Date(anchor)>=7*86400000,daysBetween:7,localOnly:true};}
  if(path==='/api/cm')return cmData(root,instant);
  if(path==='/api/reveal'){
   const c=definition(root,q.get('id')),set=q.has('set')?definition(root,q.get('set')):null;if(set&&(!set.members?.some(m=>m.cardId===c.id&&m.version===c.version)||!canManage(root,set.id)))fail(409,'This public collection changed.');
   const s=state(root,set?.id??c.id,instant),member=set?state(root,c.id,instant):null;
   if(set&&s.status!=='active')fail(409,'This collection is in Memorize Later.');
   return {...c,revision:member?.revision??s.revision,due:member?.fsrs.due??s.fsrs.due,schedulingPolicy:{version:'public-calendar-v1',againDays:1,timeZone:root.settings.timeZone,dayStartsAt:'00:00'},options:[1,2,3,4].map(rating=>{const next=nextReview(s.fsrs,instant,rating,root.settings.timeZone);return {rating,due:next.card.due.toISOString(),intervalDays:next.card.scheduled_days};}),...(set?{reviewTarget:{id:set.id,version:set.version,revision:s.revision,due:s.fsrs.due}}:{})};
  }
  if(path==='/api/item-passage'||path==='/api/story-passage'){const c=definition(root,q.get('id'));if(isPublicCard(c)){if(path!=='/api/item-passage')fail(404,'Story not found.');return {definition:c,reference:c.reference,translation:null,contentKind:'user-card',verses:[]};}if(isPublicSummary(c)){const source=c.sourcePassage??null;return {definition:c,reference:c.reference,translation:null,contentKind:'user-summary',sourceTranslation:source?'BSB':null,sourceReference:source?.reference??null,sourcePassage:source,sourceUnavailable:!source,verses:source?.verses??[]};}if(!c.verses)fail(501,'Approved public passage loading is not connected to this local adapter. No fallback request was made.');return {definition:c,reference:c.passageReference??c.reference,translation:c.translation??'BSB',verses:c.verses};}
  if(path==='/api/practice'){const events=root.practice.filter(p=>!root.corrections[p.request_id]?.removed).sort((a,b)=>b.completed_at.localeCompare(a.completed_at));return {total:events.length,events:events.slice(0,50)};}
  if(path==='/api/practice-entries')return entries(root,instant,q);
  if(path==='/api/progress-overview')return overview(root,instant);
  if(path==='/api/progress'){
   const id=q.get('card');if(id)definition(root,id);const reviews=root.reviews.filter(r=>!id||r.card_id===id),daily={};for(const r of reviews){const day=dayKey(r.reviewed_at,root.settings.timeZone),d=daily[day]??={count:0,cards:[],recalled:0,attempts:0};d.count++;if(!d.cards.includes(r.card_id))d.cards.push(r.card_id);if(JSON.parse(r.previous_json).reps>0){d.attempts++;if(r.rating>1)d.recalled++;}}
   const today=dayKey(instant,root.settings.timeZone),practiceDays=Object.keys(daily).length;return {today,totalReviews:reviews.length,practiceDays,daysThisWeek:Object.keys(daily).filter(d=>d>=shiftDay(today,-6)&&d<=today).length,daily,weeks:Array.from({length:8},(_,i)=>{const start=shiftDay(today,-55+i*7),end=shiftDay(start,6),rows=Object.entries(daily).filter(([d])=>d>=start&&d<=end).map(([,d])=>d);return {start,end,attempts:rows.reduce((n,d)=>n+d.attempts,0),recalled:rows.reduce((n,d)=>n+d.recalled,0)};}),milestones:[{id:'first',label:'First saved review',value:reviews.length,target:1},{id:'ten',label:'10 saved reviews',value:reviews.length,target:10},{id:'fifty',label:'50 saved reviews',value:reviews.length,target:50},{id:'seven-days',label:'7 memory days',value:practiceDays,target:7},{id:'thirty-days',label:'30 memory days',value:practiceDays,target:30}].map(m=>({...m,earned:m.value>=m.target})),...(id?{curve:memoryCurve(reviews),reviews:reviews.map(r=>({cardId:r.card_id,rating:r.rating,reviewedAt:r.reviewed_at,nextDue:r.next_due,intervalDays:JSON.parse(r.next_json).scheduled_days}))}:{})};
  }
  if(path==='/api/history')return {reviews:root.reviews.slice().reverse().slice(0,100).map(({previous_json,next_json,...r})=>r)};
  if(path==='/api/export')return {format:PUBLIC_BACKUP_FORMAT,schemaVersion:1,exportedAt:instant.toISOString(),catalogVersions:definitions(root).map(c=>({id:c.id,version:c.version})),state:root};
  fail(501,'This public local route is not implemented. No fallback request was made.');
 }
 function mutate(root,path,body,instant,loadedItem,restoreFingerprint){
  const allowed={
   '/api/items':['bookCode','chapter','startVerse','endVerse','stage','kind','reference','summary','source','card'],
   '/api/card-import':['stage','items'],
   '/api/story-notes':['cardId','contentVersion','revision','outline'],
   '/api/backup-marker':['revision','exportedRevision'],
   '/api/restore':['revision','backup'],
   '/api/reviews':['cardId','rating','revision','contentVersion'],
   '/api/learning-stage':['cardId','stage','revision','stateRevision'],
   '/api/study-status':['status','items'],
   '/api/deferrals':['cardId','action','revision','stateRevision'],
   '/api/practice':['targetId','contentVersion','modality'],
   '/api/practice-corrections':['eventKey','action','revision'],
   '/api/preferences':['revision','timeZone'],
   '/api/cm':['revision','kind','dailyIds','sabbath','confirmed','active','targetId','contentVersion']
  };
  if(!allowed[path])fail(501,'This public local write route is not implemented.');keys(body,['requestId','storageGeneration',...allowed[path]]);
  if(typeof body.requestId!=='string'||!uuid.test(body.requestId))fail(400,'Use one UUID v4 request ID for each explicit action.');if(body.storageGeneration!==undefined&&!safeInt(body.storageGeneration))fail(400,'Invalid local storage generation.');
  const request=path==='/api/restore'?restoreFingerprint:stable(body),prior=root.receipts[body.requestId];if(prior){if(prior.path!==path||prior.request!==request)fail(409,'Submission ID already used.');return {result:prior.receipt,changed:false};}
  if((body.storageGeneration??0)!==(root.storageGeneration??0))fail(409,'This browser was restored. Clear old pending actions and refresh before starting a new action.');
  const receipt={saved:true,requestId:body.requestId,savedAt:instant.toISOString()};
  const requireRevision=(value,current)=>{if(!safeInt(value))fail(400,'Invalid revision.');if(value!==current)fail(409,'This item changed in another tab. Refresh before acting.');};
  const target=(id)=>{const c=definition(root,id);if(!canManage(root,id))fail(409,'Choose the complete collection.');return c;};
  if(path==='/api/restore'){
   requireRevision(body.revision,root.revision);const restored=validatePublicBackup(body.backup,{catalog,validateCatalog});const generation=Math.max(root.storageGeneration??0,restored.storageGeneration??0)+1,revision=root.revision+1;if(!Number.isSafeInteger(generation))fail(400,'Backup generation exceeds the supported range.');Object.assign(root,restored,{storageGeneration:generation,revision});Object.assign(receipt,{storageGeneration:generation,revision,restored:true});root.receipts[body.requestId]={path,request,receipt};return {result:receipt,changed:true,restored:true};
  }else if(path==='/api/items'){
   const card=body.kind==='card',manual=body.kind==='summary'||card,stage=body.stage??(manual?'later':undefined);if(!['learning','later'].includes(stage))fail(400,'Choose Learning or Later.');if(!loadedItem)fail(503,'The selected learning item did not load.');
   const c=validateCatalog([loadedItem]).catalog[0],kind=body.kind??'verse';
   if(card){try{validatePublicCardDefinition(c);if(c.id!==publicCardId(normalizeCardInput(body.card)))throw Error();}catch{fail(400,'Invalid visitor-made card.');}}
   else if(manual){try{validatePublicSummaryDefinition(c);if(c.id!==publicSummaryId(publicSummaryInput(body)))throw Error();}catch{fail(400,'Invalid visitor-authored summary.');}}
   else if(c.kind!==kind||c.translation!=='BSB'||c.id!==selectedPublicId(body)||(kind==='story'?c.memoryGroup!==undefined:body.endVerse>body.startVerse?c.memoryGroup!=='extended':c.memoryGroup!==undefined)||!Array.isArray(c.verses)||c.verses.length!==body.endVerse-body.startVerse+1||c.verses.some((v,index)=>v.number!==body.startVerse+index)||c.text!==c.verses.map(v=>v.text).join(' '))fail(400,'Invalid approved BSB item.');
   const existing=byId.has(c.id)||Object.hasOwn(root.items,c.id);if(existing&&stable(definition(root,c.id))!==stable(c))fail(409,'This exact learning item or its linked Scripture changed. Existing text and history were preserved.');
   if(!existing){if(Object.keys(root.items).length>=1000)fail(409,'This browser has reached its supported saved-item limit. Export a backup before reorganizing items.');root.items[c.id]=c;const item=saveState(root,c.id,instant);item.status=stage==='learning'?'active':'later';item.stage='learning';if(item.status==='active')enroll(root,[c.id],instant);}
   const item=state(root,c.id,instant);Object.assign(receipt,{itemId:c.id,existing,stage:item.status==='later'?'later':item.stage,revision:item.revision});
  }else if(path==='/api/card-import'){
   // Each card is saved exactly as a single card Add would be, with its own /api/items receipt, so backups and
   // retries treat imported cards like any other. The batch itself keeps no receipt: a retry finds every card's.
   const items=body.items.map((item,index)=>{const request={requestId:item.requestId,...(body.storageGeneration!==undefined?{storageGeneration:body.storageGeneration}:{}),kind:'card',card:item.card,stage:body.stage},prior=root.receipts[item.requestId];
    if(prior&&(prior.path!=='/api/items'||prior.request!==stable(request)))fail(409,'Submission ID already used.');
    const c=validateCatalog([loadedItem[index]]).catalog[0];try{validatePublicCardDefinition(c);if(c.id!==publicCardId(normalizeCardInput(item.card)))throw Error();}catch{fail(400,'Card '+(index+1)+' is not a valid card.');}
    const existing=byId.has(c.id)||Object.hasOwn(root.items,c.id);if(existing&&stable(definition(root,c.id))!==stable(c))fail(409,'A card in this import changed. Existing text and history were preserved.');
    return {item,request,prior,c,existing};});
   const adding=new Set(items.filter(x=>!x.prior&&!x.existing).map(x=>x.c.id)),room=1000-Object.keys(root.items).length;
   if(adding.size>room)fail(409,'This browser has room for '+Math.max(0,room)+' more items, and this import adds '+adding.size+'. Import fewer cards.');
   const learning=[],results=items.map(({item,request,prior,c,existing})=>{if(prior)return prior.receipt;
    const fresh=!existing&&!Object.hasOwn(root.items,c.id);if(fresh){root.items[c.id]=c;const s=saveState(root,c.id,instant);s.status=body.stage==='learning'?'active':'later';s.stage='learning';if(s.status==='active')learning.push(c.id);}
    const s=state(root,c.id,instant),receipt={saved:true,requestId:item.requestId,savedAt:instant.toISOString(),itemId:c.id,existing:!fresh,stage:s.status==='later'?'later':s.stage,revision:s.revision};
    root.receipts[item.requestId]={path:'/api/items',request:stable(request),receipt};return receipt;});
   enroll(root,learning,instant);
   const changed=items.some(x=>!x.prior);if(changed)root.revision++;
   return {result:{saved:true,requestId:body.requestId,savedAt:instant.toISOString(),results},changed};
  }else if(path==='/api/story-notes'){
   const c=definition(root,body.cardId);if(c.kind!=='story')fail(400,'Choose a Story item.');if(c.version!==body.contentVersion)fail(409,'This public Story changed.');if(typeof body.outline!=='string'||body.outline.length>4000||body.outline.includes('\0'))fail(400,'Use an outline of at most 4,000 characters.');const prior=root.storyNotes[c.id]??{revision:0,outline:''};requireRevision(body.revision,prior.revision);const next={revision:prior.revision+1,outline:body.outline};root.storyNotes[c.id]=next;Object.assign(receipt,{cardId:c.id,contentVersion:c.version,...next});
  }else if(path==='/api/backup-marker'){
   requireRevision(body.revision,root.backupMarker.revision);if(!safeInt(body.exportedRevision)||body.exportedRevision>root.revision)fail(400,'Choose a backup actually exported by this browser.');root.backupMarker={revision:body.revision+1,lastDownloadedAt:instant.toISOString(),exportedRevision:body.exportedRevision};Object.assign(receipt,root.backupMarker);
  }else if(path==='/api/preferences'){
   requireRevision(body.revision,root.settings.revision);try{validateTimeZone(body.timeZone);}catch{fail(400,'Choose a valid timezone.');}if(root.settings.timeZone!==body.timeZone)invalidateReviewForms(root,instant);root.settings={revision:body.revision+1,timeZone:body.timeZone};Object.assign(receipt,root.settings);
  }else if(path==='/api/reviews'){
   const c=target(body.cardId),s=saveState(root,c.id,instant);requireRevision(body.revision,s.revision);if(c.version!==body.contentVersion)fail(409,'This public item changed.');if(![1,2,3,4].includes(body.rating))fail(400,'Choose a recall rating.');if(root.cm.plan.active)fail(409,'Charlotte Mason is active. Use its explicit completion actions.');if(s.status!=='active'||new Date(s.fsrs.due)>instant||s.skipUntil&&new Date(s.skipUntil)>instant)fail(409,'This item is not due and active. Use Library for extra practice.');
   const previous_json=JSON.stringify(s.fsrs),next=nextReview(s.fsrs,instant,body.rating,root.settings.timeZone);s.fsrs=clone(next.card);const previous_revision=s.revision++;root.reviews.push({request_id:body.requestId,card_id:c.id,rating:body.rating,content_version:c.version,previous_revision,previous_json,next_json:JSON.stringify(next.card),reviewed_at:instant.toISOString(),next_due:next.card.due.toISOString()});Object.assign(receipt,{cardId:c.id,rating:body.rating,revision:s.revision,due:s.fsrs.due});
  }else if(path==='/api/learning-stage'){
   const c=target(body.cardId),s=saveState(root,c.id,instant);if(!['learning','memorized','later'].includes(body.stage))fail(400,'Choose a valid learning stage.');requireRevision(body.revision,s.stageRevision);requireRevision(body.stateRevision,s.revision);s.stageRevision++;s.revision++;const status=body.stage==='later'?'later':'active';if(s.status!==status&&s.skipRevision>0){s.skipRevision++;s.skipUntil=null;}s.status=status;if(body.stage!=='later')s.stage=body.stage;enroll(root,body.stage==='later'?[]:[c.id],instant);Object.assign(receipt,{cardId:c.id,stage:body.stage,revision:s.stageRevision});
  }else if(path==='/api/study-status'){
   if(!['active','later'].includes(body.status)||!Array.isArray(body.items)||!body.items.length||body.items.length>50)fail(400,'Choose 1–50 public learning targets.');const ids=new Set();for(const item of body.items){keys(item,['cardId','revision']);target(item.cardId);if(ids.has(item.cardId))fail(400,'Duplicate selection.');ids.add(item.cardId);requireRevision(item.revision,state(root,item.cardId,instant).revision);}
   for(const id of ids){const s=saveState(root,id,instant);s.status=body.status;s.revision++;if(s.skipRevision>0){s.skipRevision++;s.skipUntil=null;}}enroll(root,body.status==='active'?[...ids]:[],instant);Object.assign(receipt,{status:body.status,cardIds:[...ids].sort()});
  }else if(path==='/api/deferrals'){
   const c=target(body.cardId),s=saveState(root,c.id,instant);requireRevision(body.revision,s.skipRevision);requireRevision(body.stateRevision,s.revision);if(!['skip','undo'].includes(body.action))fail(400,'Invalid review choice.');const cm=cmData(root,instant);if(s.status!=='active'||body.action==='skip'&&(root.cm.plan.active?!cm.dueIds.includes(c.id):new Date(s.fsrs.due)>instant))fail(409,'This item is not due and active.');s.skipRevision++;s.skipUntil=body.action==='skip'?calendarDue(instant,1,root.settings.timeZone).toISOString():null;Object.assign(receipt,{cardId:c.id,action:body.action,revision:s.skipRevision,skipUntil:s.skipUntil});
  }else if(path==='/api/practice'){
   const c=definition(root,body.targetId);if(c.version!==body.contentVersion)fail(409,'This public item changed.');if(!['read','listen','external-audio','recall-practice'].includes(body.modality))fail(400,'Choose a practice modality.');root.practice.push({request_id:body.requestId,target_id:c.id,content_version:c.version,reference:c.reference,completed_at:instant.toISOString(),modality:body.modality});Object.assign(receipt,{targetId:c.id,contentVersion:c.version,reference:c.reference,modality:body.modality});
  }else if(path==='/api/practice-corrections'){
   const match=typeof body.eventKey==='string'&&/^practice:([0-9a-f-]+)$/i.exec(body.eventKey);if(!match||!uuid.test(match[1])||!root.practice.some(p=>p.request_id===match[1]))fail(404,'Public practice entry not found.');if(!['remove','undo'].includes(body.action))fail(400,'Choose Remove or Undo.');const id=match[1],c=root.corrections[id]??{revision:0,removed:false};requireRevision(body.revision,c.revision);root.corrections[id]={revision:c.revision+1,removed:body.action==='remove'};Object.assign(receipt,{eventKey:body.eventKey,action:body.action,...root.corrections[id]});
  }else if(path==='/api/cm'){
   requireRevision(body.revision,root.cm.revision);const cm=cmData(root,instant),active=activeIds(root,instant),known=activeIds(root,instant,true),plan=clone(cm.plan),date=cm.date;let moves=[],completions=[];
   const fields={setup:['dailyIds','sabbath','confirmed'],settings:['active','sabbath'],reviewed:['targetId','contentVersion'],advance:['targetId','contentVersion']};if(!fields[body.kind])fail(400,'Invalid schedule action.');keys(body,['requestId','storageGeneration','revision','kind',...fields[body.kind]]);
   try{if(body.kind==='setup'){
    if(plan.box)fail(409,'CM is already set up.');if(body.confirmed!==true||!Array.isArray(body.dailyIds)||!body.dailyIds.length||new Set(body.dailyIds).size!==body.dailyIds.length||body.dailyIds.some(id=>!known.includes(id)))fail(409,'Explicitly confirm existing Active targets.');if(body.sabbath!==null&&(!Number.isInteger(body.sabbath)||body.sabbath<0||body.sabbath>6))fail(400,'Choose no Sabbath or one weekday.');plan.active=true;plan.sabbath=body.sabbath;plan.box=createCmState({date,dailyIds:body.dailyIds});
   }else if(body.kind==='settings'){
    if(typeof body.active!=='boolean'||body.sabbath!==null&&(!Number.isInteger(body.sabbath)||body.sabbath<0||body.sabbath>6))fail(400,'Invalid CM settings.');if(body.active&&!plan.box)fail(409,'Set up CM first.');if(body.active){const r=cmEnroll(plan.box,known,date);plan.box=r.nextState;moves=r.moves;}plan.active=body.active;plan.sabbath=body.sabbath;
   }else{const c=target(body.targetId);if(c.version!==body.contentVersion)fail(409,'This public item changed.');if(!plan.active||!plan.box)fail(409,'CM is not active.');const r=(body.kind==='advance'?cmAdvance:cmReviewed)(plan.box,c.id,date,{sabbath:plan.sabbath,activeIds:active});plan.box=r.nextState;moves=r.moves;completions=r.completions;if(body.kind==='advance'){const card=saveState(root,c.id,instant);card.stage='memorized';card.stageRevision++;card.revision++;Object.assign(receipt,{stage:'memorized',stageRevision:card.stageRevision,stateRevision:card.revision});}}
   }catch(error){if(error instanceof PublicMemoryError)throw error;fail(409,error.message||'Invalid CM action.');}
   if(root.cm.plan.active!==plan.active)invalidateReviewForms(root,instant);root.cm={revision:root.cm.revision+1,plan};Object.assign(receipt,{revision:root.cm.revision,policy:'charlotte-mason-v1',kind:body.kind,targetId:body.targetId??null,contentVersion:body.contentVersion??null,date,moves,completions,active:plan.active});
  }
  root.receipts[body.requestId]={path,request,receipt};root.revision++;return {result:receipt,changed:true};
 }
 async function api(path,options={}){
  if(typeof path!=='string'||!/^\/api\/[a-z-]+(?:\?[^#]*)?$/.test(path))fail(400,'Use an explicit local API path.');
  const url=new URL(path,'https://public-memory.invalid'),method=(options.method??'GET').toUpperCase();const queries={'/api/reveal':['id','set'],'/api/item-passage':['id'],'/api/story-passage':['id'],'/api/story-notes':['id'],'/api/progress':['card'],'/api/practice-entries':['day','includeRemoved']};for(const key of url.searchParams.keys())if(!(queries[url.pathname]??[]).includes(key)||url.searchParams.getAll(key).length!==1)fail(400,'Invalid local API query.');if(url.searchParams.has('includeRemoved')&&!['0','1'].includes(url.searchParams.get('includeRemoved')))fail(400,'Invalid practice history query.');if(!['GET','POST'].includes(method))fail(405,'Use GET or POST.');const instant=new Date(now());if(!Number.isFinite(+instant))fail(503,'Invalid local clock.');
  if(method==='GET'&&['/api/story-passage','/api/item-passage'].includes(url.pathname)){const item=await transaction(false,root=>({result:definition(root,url.searchParams.get('id'))}));if(item.kind==='story'&&item.segments)return loadPublicStoryPassage(item,passageLoader);}
  if(method==='GET'){const result=await transaction(false,root=>({result:read(root,url.pathname,url.searchParams,instant)}));if(url.pathname==='/api/session')observedGeneration=result.storageGeneration;return result;}
  let body=options.body;try{if(typeof body==='string'){if(body.length>5*1024*1024)fail(413,'Local request is too large.');body=JSON.parse(body);}}catch(error){if(error instanceof PublicMemoryError)throw error;fail(400,'Invalid JSON.');}keys(body,Object.keys(body??{}));if(JSON.stringify(body).length>5*1024*1024)fail(413,'Local request is too large.');body=clone(body);
  let loadedItem,restoreFingerprint;
  if(url.pathname==='/api/items'){
   const card=body.kind==='card',manual=body.kind==='summary';keys(body,card?['requestId','storageGeneration','kind','card','stage']:manual?['requestId','storageGeneration','kind','reference','summary','source','stage']:['requestId','storageGeneration','bookCode','chapter','startVerse','endVerse','stage','kind','translation']);
   if(!uuid.test(body.requestId??''))fail(400,'Use a UUID v4 request ID.');
   let summaryInput,cardItem;if(card){try{cardItem=publicCardDefinition(body.card);}catch(error){fail(400,error.message);}if(body.stage!==undefined&&!['learning','later'].includes(body.stage))fail(400,'Choose Learning or Later.');}
   else if(manual){try{summaryInput=publicSummaryInput(body);}catch(error){fail(400,error.message);}if(body.stage!==undefined&&!['learning','later'].includes(body.stage))fail(400,'Choose Learning or Later.');}
   else if(!['verse','story'].includes(body.kind??'verse')||!['learning','later'].includes(body.stage)||!['BSB','KJV',undefined].includes(body.translation)||body.kind==='story'&&body.translation==='KJV'||typeof body.bookCode!=='string'||!/^[A-Z0-9]{3}$/.test(body.bookCode)||!Number.isInteger(body.chapter)||body.chapter<1||!Number.isInteger(body.startVerse)||body.startVerse<1||!Number.isInteger(body.endVerse)||body.endVerse<body.startVerse)fail(400,'Choose a valid BSB or KJV passage and Learning or Later.');
   const guard=await transaction(false,root=>({result:{prior:root.receipts[body.requestId]??null,generation:root.storageGeneration??0}}));const prior=guard.prior;if(prior){if(prior.path!==url.pathname||prior.request!==stable(body))fail(409,'Submission ID already used.');return prior.receipt;}
   if(body.storageGeneration!==undefined&&!safeInt(body.storageGeneration))fail(400,'Invalid local storage generation.');if((body.storageGeneration??0)!==guard.generation)fail(409,'This browser was restored. Clear old pending actions and refresh.');
   if(card)loadedItem=cardItem;
   else if(manual){let source;if(summaryInput.source){if(typeof passageLoader!=='function')fail(503,'Approved public BSB passage loading is not configured.');source=await passageLoader(summaryInput.source);}try{loadedItem=publicSummaryDefinition(summaryInput,source);}catch(error){fail(400,error.message);}}
   else{const translation=body.translation??'BSB',loader=translation==='KJV'?kjvPassageLoader:passageLoader;if(typeof loader!=='function')fail(503,'The selected public Scripture translation is not configured.');loadedItem=selectedPublicDefinition(await loader({bookCode:body.bookCode,chapter:body.chapter,startVerse:body.startVerse,endVerse:body.endVerse}),body.kind??'verse');}
  }
  if(url.pathname==='/api/card-import'){
   keys(body,['requestId','storageGeneration','stage','items']);if(!uuid.test(body.requestId??''))fail(400,'Use a UUID v4 request ID.');
   if(!['learning','later'].includes(body.stage))fail(400,'Choose Learning or Later.');if(!Array.isArray(body.items)||!body.items.length||body.items.length>100)fail(400,'Send 1 to 100 cards at a time.');
   const ids=new Set([body.requestId]);loadedItem=body.items.map((item,index)=>{keys(item,['requestId','card']);if(!uuid.test(item.requestId??'')||ids.has(item.requestId))fail(400,'Each card needs its own request ID.');ids.add(item.requestId);try{return publicCardDefinition(item.card);}catch(error){fail(400,'Card '+(index+1)+': '+error.message);}});
  }
  if(url.pathname==='/api/restore'){
   keys(body,['requestId','revision','backup','storageGeneration']);if(!uuid.test(body.requestId??'')||!safeInt(body.revision)||body.storageGeneration!==undefined&&!safeInt(body.storageGeneration))fail(400,'Use a UUID v4 request ID and a valid current storage revision.');
   if(body.backup?.format!==PUBLIC_BACKUP_FORMAT||body.backup?.schemaVersion!==1)fail(400,'Only a public browser backup is accepted. Private app exports are never imported.');
   if(!globalThis.crypto?.subtle)fail(503,'Secure local restore verification is unavailable.');
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(body)));restoreFingerprint='sha256:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
   const guard=await transaction(false,root=>({result:{prior:root.receipts[body.requestId]??null,generation:root.storageGeneration??0,revision:root.revision}}));
   if(guard.prior){if(guard.prior.path!==url.pathname||guard.prior.request!==restoreFingerprint)fail(409,'Submission ID already used.');observedGeneration=guard.prior.receipt.storageGeneration;return guard.prior.receipt;}
   if((body.storageGeneration??0)!==guard.generation||body.revision!==guard.revision)fail(409,'Local progress changed. Clear stale pending actions and refresh before restoring.');
   const validated=validatePublicBackup(body.backup,{catalog,validateCatalog}),additions=Object.values(validated.items).filter(item=>parseSelectedPublicId(item.id)||isPublicSummary(item)&&item.sourcePassage);
   if(additions.length){if(typeof passageLoader!=='function'&&typeof kjvPassageLoader!=='function')fail(503,'Approved public Scripture verification is required to restore selected passages.');let index=0;
    await Promise.all(Array.from({length:Math.min(4,additions.length)},async()=>{while(index<additions.length){const item=additions[index++],manual=isPublicSummary(item),selection=manual?publicSummarySource(item):parseSelectedPublicId(item.id),loader=selection.translation==='KJV'?kjvPassageLoader:passageLoader;if(typeof loader!=='function')fail(503,'The selected Scripture translation is not configured for backup verification.');const source=await loader({bookCode:selection.bookCode,chapter:selection.chapter,startVerse:selection.startVerse,endVerse:selection.endVerse});const verified=manual?publicSummaryDefinition(publicSummaryDefinitionInput(item),source):selectedPublicDefinition(source,selection.kind);if(stable(verified)!==stable(item))fail(400,'Stored Scripture text does not match its approved public source. Nothing was restored.');}}));
   }
  }
  const result=await transaction(true,root=>mutate(root,url.pathname,clone(body),instant,loadedItem,restoreFingerprint));if(url.pathname==='/api/restore')observedGeneration=result.storageGeneration;return result;
 }
 api.prepareMutation=body=>{if(observedGeneration===undefined)fail(409,'Load the local session before creating a pending action.');keys(body,Object.keys(body??{}));if(body.storageGeneration!==undefined&&body.storageGeneration!==observedGeneration)fail(409,'Do not rebase an old pending action after restore. Clear it and create a new explicit action.');return {...clone(body),storageGeneration:observedGeneration};};
 api.subscribe=fn=>{if(typeof fn!=='function')throw TypeError('Expected a listener');listeners.add(fn);ensureChannel();return ()=>listeners.delete(fn);};
 // Card pictures live beside the progress record (one key each, named by the SHA-256 of the bytes), so saving progress
 // never copies them; a picture is only ever added, never changed.
 api.savePicture=async blob=>{
  const bytes=new Uint8Array(await blob.arrayBuffer()),mime=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff?'image/jpeg':bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47?'image/png':String.fromCharCode(...bytes.subarray(8,12))==='WEBP'?'image/webp':null;
  if(!mime||bytes.length>1_500_000)fail(400,'This file is not a picture the app can show.');
  const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join(''),db=await open();
  await new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put({mime,bytes},'picture:'+id);tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(new PublicMemoryError(503,'The picture could not be kept in this browser.'));});
  return {id,mime};
 };
 api.readPicture=async id=>{
  if(typeof id!=='string'||!/^[0-9a-f]{64}$/.test(id))fail(404,'Picture not found.');const db=await open();
  return new Promise((resolve,reject)=>{const tx=db.transaction('state','readonly'),request=tx.objectStore('state').get('picture:'+id);request.onsuccess=()=>request.result?resolve({mime:request.result.mime,bytes:new Uint8Array(request.result.bytes)}):reject(new PublicMemoryError(404,'Picture not found.'));request.onerror=()=>reject(new PublicMemoryError(503,'The picture could not be read.'));});
 };
 api.close=async()=>{closed=true;channel?.close();listeners.clear();if(dbPromise)try{(await dbPromise).close();}catch{/* Opening already reported its storage failure. */}};
 return api;
}
