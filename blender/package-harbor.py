"""Package the saved local harbor scene without changing the editing copy.

Example:
  python blender/package-harbor.py --blender D:/Blender/blender.exe --node node --version 14.2
All processing uses independent background Blender processes. The package remains
local; no upload or Git operation is performed. Requires the existing font notice
and previous package manifest to verify the embedded licensed font is unchanged.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ROOT=Path(__file__).resolve().parent.parent
SCRIPTS=ROOT/'blender'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--blender',required=True)
parser.add_argument('--node',default='node')
parser.add_argument('--version',required=True)
args=parser.parse_args()
assert re.fullmatch(r'[0-9]+(?:\.[0-9]+)*',args.version), 'Use a numerical local version'
STAGE=ROOT/'output'/('portable-pov-v'+args.version)
STAGE.mkdir(parents=True,exist_ok=True)
FINAL=STAGE/'final'
live=SCRIPTS/'small-goods-harbor-pov.blend'
sha=lambda data:hashlib.sha256(data).hexdigest()
source_hash=sha(live.read_bytes())
old_manifest=json.loads((SCRIPTS/'pov-model-manifest.json').read_text(encoding='utf8'))
expected_font=old_manifest['portableResources']['font']
notice=(SCRIPTS/'FONT_NOTICES.txt').read_bytes()
assert expected_font['noticeFile']=='FONT_NOTICES.txt'
assert expected_font['fsType']==8
assert b'Editable Embedding' in notice

def run(label,cmd):
    result=subprocess.run(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    log=STAGE/(label+'.log')
    log.write_bytes(result.stdout)
    assert result.returncode==0, 'Failed '+label+'; see '+str(log)
    print(label+' OK',flush=True)

def blender(label,source,script,report=None):
    command=[args.blender,'-b','--factory-startup',str(source),'--python-exit-code','1',
             '--python',str(SCRIPTS/script),'--','--stage',str(STAGE)]
    if report:command+=['--report',report]
    run(label,command)

blender('prepare',live,'package-prepare.py')
assert sha(live.read_bytes())==source_hash, 'Source changed during packaging; wait for edits to finish and rerun'
blender('finalize',STAGE/live.name,'package-finalize.py')
run('privacy',[args.node,str(SCRIPTS/'package-scrub.mjs'),str(STAGE)])
blender('validate-final',FINAL/live.name,'package-validate.py')
validation=json.loads((STAGE/'validation.json').read_text(encoding='utf8'))
privacy=json.loads((STAGE/'privacy-verification.json').read_text(encoding='utf8'))
assert all(validation['comparison'].values())
assert privacy['knownPersonalOrTokenMatches']==0
assert privacy['validAbsoluteWindowsPaths']==0 and privacy['utf16PrivatePathMatches']==0
assert len(validation['fonts'])==1
font=validation['fonts'][0]
assert font['sha256']==expected_font['sha256'] and font['bytes']==expected_font['bytes'], 'Embedded font changed; review notice and embedding permission'
assert sha(live.read_bytes())==source_hash, 'Source changed during packaging; rerun after edits settle'
source_check={'sourceUnchanged':True,'sourceSha256':source_hash,'fontMatchesExistingNotice':True}
(STAGE/'source-and-font-check.json').write_text(json.dumps(source_check,indent=2),encoding='utf8')
model=FINAL/live.name
raw=model.read_bytes()
assert not re.search(rb'(?i)/(?:Users|home|Volumes|tmp|mnt)/',raw)
assert not re.search(rb'\\\\[A-Za-z0-9_.-]+\\[A-Za-z0-9_.-]+',raw)
state=validation['state']
today=datetime.date.today()
manifest={
  'format':'Portable editable Blender scene - local POV edition',
  'modelVersion':'V'+args.version,'packagedDate':today.isoformat(),
  'blenderVersion':validation['blenderVersion'],
  'file':{'name':model.name,'bytes':len(raw),'sha256':sha(raw)},
  'sourceWorkingFileSha256':source_hash,
  'scene':state,
  'content':{'mainIslandObjects':state['objects']-state['environmentObjects'],
    'horizonObjects':state['environmentObjects'],
    'sailboats':len(state['movableSailboatRoots']),
    'horizonCollection':'POV_ENVIRONMENT',
    'horizonHiddenByDefault':all(state['environmentHidden'].values()),
    'movableSailboatRoots':state['movableSailboatRoots']},
  'validation':{'independentBackgroundReopen':True,'sourceWorkingFileUnchanged':True,
    'sceneObjectStateMatches':True,'geometryAndShapeKeysMatch':True,
    'materialGraphAndInputValuesMatch':True,'sceneDependencyDriverFingerprintMatches':True,
    'noLinkedLibraries':True,'noExternalTextureFiles':True,'noEmbeddedTextScripts':True,
    'knownPersonalPathAndTokenMatches':0,'validAbsoluteWindowsPathMatches':0,
    'asciiAndBothUtf16AlignmentsScanned':True,'noRenderPerformed':True},
  'portableResources':{'font':{**font,'fsType':8,'noticeFile':'FONT_NOTICES.txt',
    'standaloneFontDistributed':False},'renderOutput':'//renders/harbor-'},
  'privacyChanges':[
    'Scene-only copy excludes unrelated scenes, original editor state and unused authoring data',
    'Fresh factory editor layout opens the harbor scene directly',
    'Removed embedded text scripts and unused editor brushes',
    'Sanitized private custom-property strings and asset author metadata',
    'Packed all used external resources and replaced paths with portable relative references',
    'Cleared stale bytes only inside the SDNA-identified FileSelectParams directory string buffer',
    'Archive contains no source filesystem paths or original diagnostic logs'],
  'verificationScope':[
    'Static editable scene, mesh geometry, shape-key coordinates, transforms, hierarchy, material nodes and scene dependency drivers were compared before and after packaging',
    'Scene dependency driver count and fingerprints are read dynamically from this source model',
    'Privacy scan covers current user name, workspace/token strings, printable absolute Windows paths, common Unix home/workspace path prefixes, UNC paths, ASCII and both UTF-16LE alignments',
    'Public font license and certificate URLs remain embedded with their legal notices',
    'No render, playback performance benchmark or full frame-by-frame animation comparison was performed',
    'Website sky, expanded water, fog, and runtime boat animation remain separate JavaScript features'],
  'publication':'Local archive only; this packaging step does not deploy or publish the project',
}
(FINAL/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
(FINAL/'FONT_NOTICES.txt').write_bytes(notice)
(FINAL/'README.txt').write_text(
    'Small Goods Harbor - Local POV model archive V'+args.version+'\n\n'
    'Open small-goods-harbor-pov.blend in Blender '+validation['blenderVersion']+'.\n'
    'The opening scene is Small Goods · Reference Harbor.\n'
    'This archive includes the expanded main island and POV_ENVIRONMENT.\n'
    'POV_ENVIRONMENT is hidden for the normal overview. Enable the collection\n'
    'in the Outliner for editing or rendering the distant islands, reefs, clouds\n'
    'and sailboats. The website shows this collection only in first-person mode.\n\n'
    'The font is embedded. See FONT_NOTICES.txt. No external model resources\n'
    'or MCP connection are required to open the scene.\n'
    'The website sky, expanded water, fog and distant boat movement are runtime\n'
    'JavaScript features and are not baked into this Blender archive.\n\n'
    'See manifest.json for contents, checksums, verification scope and limitations.\n',encoding='utf8')
members=[model.name,'manifest.json','FONT_NOTICES.txt','README.txt']
staged_archive=STAGE/'small-goods-harbor-pov.blend.zip'
with zipfile.ZipFile(staged_archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
    for name in members:
        info=zipfile.ZipInfo(name,date_time=(today.year,today.month,today.day,0,0,0))
        info.compress_type=zipfile.ZIP_DEFLATED
        info.external_attr=0o644<<16
        z.writestr(info,(FINAL/name).read_bytes(),compresslevel=9)
extracted=STAGE/'zip-reopen'
extracted.mkdir(exist_ok=True)
with zipfile.ZipFile(staged_archive) as z:
    assert z.testzip() is None and z.namelist()==members
    member_checks=[]
    for name in members:
        data=z.read(name)
        assert data==(FINAL/name).read_bytes()
        member_checks.append({'name':name,'bytes':len(data),'sha256':sha(data)})
    (extracted/model.name).write_bytes(z.read(model.name))
blender('validate-extracted',extracted/model.name,'package-validate.py','validation-zip.json')
zip_validation=json.loads((STAGE/'validation-zip.json').read_text(encoding='utf8'))
assert all(zip_validation['comparison'].values())
assert sha((extracted/model.name).read_bytes())==sha(raw)
assert sha(live.read_bytes())==source_hash, 'Source changed before promotion; rerun after edits settle'
archive_info={'name':staged_archive.name,'bytes':staged_archive.stat().st_size,
    'sha256':sha(staged_archive.read_bytes()),'crcIntegrityPassed':True,
    'extractedModelHashMatches':True,'members':member_checks,
    'extractedArchiveIndependentReopenPassed':True}
manifest['archive']=archive_info
# Promote only after every privacy, integrity and independent reopen check passes.
shutil.copyfile(staged_archive,SCRIPTS/staged_archive.name)
(SCRIPTS/'pov-model-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
report={'archive':archive_info,'sourceWorkingFileUnchanged':True,
    'independentReopenValidation':validation,'extractedArchiveReopenValidation':zip_validation,
    'privacyVerification':privacy,'knownUnixHomeOrWorkspacePathMatches':0,'uncPathMatches':0,'noPublication':True}
(STAGE/'package-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'archive':archive_info,'objects':state['objects'],'sourceUnchanged':True},indent=2))
