/** Canonical identity for an exact source-verified user-selected passage. */
export function selectedPublicId({bookCode,chapter,startVerse,endVerse,kind='verse',translation='BSB'}){const prefix=translation==='KJV'?'kjv':'bsb';return `${prefix}-${kind==='story'?'story-':''}${bookCode.toLowerCase()}-${chapter}-${startVerse}-${endVerse}`;}
export function parseSelectedPublicId(id){const m=typeof id==='string'&&/^(bsb|kjv)-(story-)?([a-z0-9]{3})-(\\d+)-(\\d+)-(\\d+)$/.exec(id);return m?{translation:m[1]==='kjv'?'KJV':'BSB',kind:m[2]?'story':'verse',bookCode:m[3].toUpperCase(),chapter:Number(m[4]),startVerse:Number(m[5]),endVerse:Number(m[6])}:null;}
export function selectedPublicDefinition(source,kind='verse'){
 if(!['verse','story'].includes(kind))throw Error('Choose Verse or Story classification.');
 const selection=parseSelectedPublicId(source.id);if(!selection||selection.kind!=='verse'||source.kind!=='verse'||source.translation!==selection.translation||kind==='story'&&selection.translation!=='BSB')throw Error('Approved source definition is required.');
 const copy=JSON.parse(JSON.stringify(source));if(kind==='story'){copy.id=selectedPublicId({...selection,kind});copy.kind='story';delete copy.memoryGroup;}return copy;
}
