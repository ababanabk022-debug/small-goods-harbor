import fs from 'node:fs';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
const stage=path.resolve(process.argv[2]);
const file=path.join(stage,'final','small-goods-harbor-pov.blend');
const bytes=fs.readFileSync(file);
assert.equal(bytes.subarray(0,17).toString(),'BLENDER17-01v0502');
const blocks=[];
let at=17;
while(at+32<=bytes.length){
  const code=bytes.subarray(at,at+4).toString('ascii');
  const sdna=bytes.readUInt32LE(at+4),length=Number(bytes.readBigUInt64LE(at+16));
  blocks.push({code,sdna,start:at+32,end:at+32+length,length});
  at+=32+length;
  if(code==='ENDB')break;
}
const dna=blocks.find(b=>b.code==='DNA1');
let pos=dna.start+4;
function tag(text){assert.equal(bytes.subarray(pos,pos+4).toString(),text);pos+=4;}
function strings(){let count=bytes.readUInt32LE(pos);pos+=4;const list=[];while(count--){const end=bytes.indexOf(0,pos);list.push(bytes.subarray(pos,end).toString());pos=end+1;}pos=dna.start+((pos-dna.start+3)&~3);return list;}
tag('NAME');const names=strings();tag('TYPE');const types=strings();tag('TLEN');
const lengths=[];for(let i=0;i<types.length;i++,pos+=2)lengths.push(bytes.readUInt16LE(pos));
pos=dna.start+((pos-dna.start+3)&~3);tag('STRC');let count=bytes.readUInt32LE(pos);pos+=4;
const structs=[];
while(count--){
  const type=bytes.readUInt16LE(pos),fieldsCount=bytes.readUInt16LE(pos+2);pos+=4;
  let offset=0;const fields=[];
  for(let i=0;i<fieldsCount;i++){
    const fieldType=bytes.readUInt16LE(pos),fieldName=bytes.readUInt16LE(pos+2);pos+=4;
    const name=names[fieldName],elements=[...name.matchAll(/\[(\d+)\]/g)].reduce((n,m)=>n*Number(m[1]),1);
    const length=(name.includes('*')?8:lengths[fieldType])*elements;
    fields.push({name,type:types[fieldType],offset,length});offset+=length;
  }
  structs.push({type:types[type],length:lengths[type],computed:offset,fields});
}
const edits=[];
for(const block of blocks){
  const schema=structs[block.sdna];
  if(schema?.type!=='FileSelectParams')continue;
  assert.equal(schema.computed,schema.length);
  for(const field of schema.fields){
    if(field.type!=='char'||!field.name.startsWith('dir['))continue;
    const start=block.start+field.offset,end=start+field.length;
    const zero=bytes.indexOf(0,start);
    assert(zero<end);
    assert.equal(bytes.subarray(start,zero).toString(),'//');
    const staleBytes=bytes.subarray(zero+1,end).reduce((n,b)=>n+(b!==0),0);
    bytes.fill(0,zero+1,end);
    edits.push({structure:schema.type,field:field.name,visibleValue:'//',clearedStaleNonzeroBytes:staleBytes});
  }
}
// A fresh Blender UI may contain no file-browser state. Zero edits is valid if scans pass.
const text=bytes.toString('latin1');
const owner=os.userInfo().username.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const privacyTokens=new RegExp(owner+'|codex_files|CodexData|AppData|source-copy\\.blend|(?:ghp_|github_pat_|sk-proj-)[A-Za-z0-9_\\-]{10,}','gi');
const knownMatches=[...text.matchAll(privacyTokens)].map(m=>({offset:m.index,text:m[0]}));
const windowsCandidates=[...text.matchAll(/(?<![A-Za-z])[A-Za-z]:[\\/][\x20-\x7e]{3,}/g)];
const rejectedBinaryRuns=[],validPathMatches=[];
for(const match of windowsCandidates){
  // A float array can coincidentally contain a drive-prefix byte sequence.
  // Reject only runs in raw numerical data that contain a character forbidden
  // in a Windows path component; never edit geometry to suppress a scan hit.
  const block=blocks.find(b=>match.index>=b.start&&match.index<b.end);
  if(/[<>:"|?*]/.test(match[0].slice(3))&&block?.code==='DATA'&&block.sdna===0)rejectedBinaryRuns.push({offset:match.index,reason:'Contains a forbidden Windows path character; numerical raw-data block'});
  else validPathMatches.push({offset:match.index,text:match[0],blockCode:block?.code,sdna:block?.sdna,structure:block?structs[block.sdna]?.type:null});
}
let unicodeMatches=[];
const unicodePrivate=/codex_files|CodexData|AppData|(?<![A-Za-z])[A-Za-z]:[\\/][\x20-\x7e]{3,}/gi;
for(const alignment of [0,1]){
  const part=bytes.subarray(alignment,bytes.length-((bytes.length-alignment)%2));
  const unicode=part.toString('utf16le');
  for(const m of unicode.matchAll(new RegExp(owner+'|'+unicodePrivate.source,'gi')))unicodeMatches.push({offset:alignment+m.index*2,text:m[0]});
}
if(knownMatches.length||validPathMatches.length||unicodeMatches.length)fs.writeFileSync(path.join(stage,'privacy-candidates.json'),JSON.stringify({knownMatches,validPathMatches,unicodeMatches},null,2));
assert.equal(knownMatches.length,0);assert.equal(validPathMatches.length,0);assert.equal(unicodeMatches.length,0);
fs.writeFileSync(file,bytes);
const report={uncompressedBytes:bytes.length,sdnaBoundedUiTailEdits:edits,
  knownPersonalOrTokenMatches:knownMatches.length,validAbsoluteWindowsPaths:validPathMatches.length,
  utf16PrivatePathMatches:unicodeMatches.length,rejectedBinaryRuns,
  scope:'ASCII and both UTF-16LE alignments; known personal/workspace/token patterns; all printable Windows drive-path candidates. Public embedded font license and certificate URLs retained.'};
fs.writeFileSync(path.join(stage,'privacy-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
