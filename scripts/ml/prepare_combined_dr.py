"""Prepare 5-class DR manifests from EyePACS, APTOS and Mendeley V1.

Existing holdouts stay held out. Cross-source duplicates are grouped before splitting.
Unknown patient identities remain a documented limitation.
"""
import argparse
from collections import Counter,defaultdict
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import zipfile
import cv2
import numpy as np
import pandas as pd
from PIL import Image
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from fundus.preprocessing import preprocess_bytes,VERSION

MENDELEY_LABELS={'11normalfundus':0,'3milddr':1,'4moderatedr':2,'5severedr':3,'6proliferatedr':4}
APTOS_LABELS={'No_DR':0,'Mild':1,'Moderate':2,'Severe':3,'Proliferate_DR':4,'Proliferative_DR':4}
PRIORITY={'train':0,'validation':1,'test':2}

class Groups:
    def __init__(self,n): self.parent=list(range(n))
    def find(self,x):
        while self.parent[x]!=x:
            self.parent[x]=self.parent[self.parent[x]];x=self.parent[x]
        return x
    def union(self,a,b): self.parent[self.find(a)]=self.find(b)

class HashTree:
    def __init__(self): self.root=None
    def query(self,value,radius):
        if self.root is None: return []
        out=[]; pending=[self.root]
        while pending:
            old,index,children=pending.pop(); distance=(value^old).bit_count()
            if distance<=radius: out.append(index)
            pending.extend(child for edge,child in children.items() if distance-radius<=edge<=distance+radius)
        return out
    def add(self,value,index):
        if self.root is None: self.root=[value,index,{}];return
        node=self.root
        while True:
            distance=(value^node[0]).bit_count()
            if distance not in node[2]: node[2][distance]=[value,index,{}];return
            node=node[2][distance]

def fingerprints(content):
    image=np.asarray(Image.open(io.BytesIO(content)).convert('RGB'))
    gray=cv2.resize(cv2.cvtColor(image,cv2.COLOR_RGB2GRAY),(32,32),interpolation=cv2.INTER_AREA)
    coefficients=cv2.dct(gray.astype(np.float32))[:8,:8].flatten()
    bits=coefficients>np.median(coefficients[1:]); bits[0]=False
    phash=sum(int(bit)<<i for i,bit in enumerate(bits))
    # Decoded-pixel identity catches lossless re-encoding; perceptual grouping catches some derivatives.
    pixel=hashlib.sha256(str(image.shape).encode()+image.tobytes()).hexdigest()
    return hashlib.sha256(content).hexdigest(),pixel,phash

def mendeley_grade(member):
    for part in Path(member).parts[:-1]:
        key=re.sub('[^a-z0-9]','',part.lower())
        if key in MENDELEY_LABELS: return MENDELEY_LABELS[key]
    return None

def identity(filename):
    stem=Path(filename).stem.lower()
    found=re.search(r'(\d+_(?:left|right))(?![a-z0-9])',stem)
    if found: return 'eyepacs:'+found.group(1)
    found=re.search(r'(?<![a-f0-9])([a-f0-9]{12})(?![a-f0-9])',stem)
    return 'aptos:'+found.group(1) if found else None

def records(eyepacs,aptos,split_path,archive):
    rows=[]
    for split in PRIORITY:
        for row in pd.read_csv(eyepacs/f'{split}.csv',dtype={'patient':str,'image':str}).itertuples():
            rows.append({'source':'EyePACS','source_id':row.image,'raw_path':str(row.path),'level':int(row.level),
                         'anchor':split,'known_patient':'EyePACS:'+row.patient,'prepared':True})
    split=json.loads(split_path.read_text())
    for name,files in split['files'].items():
        for item in files:
            old=Path(item.replace('\\','/')); grade=APTOS_LABELS[old.parent.name]
            raw=aptos/old.parent.name/old.name
            if not raw.exists(): raise FileNotFoundError(raw)
            rows.append({'source':'APTOS','source_id':old.stem,'raw_path':str(raw),'level':grade,
                         'anchor':name,'known_patient':None,'prepared':False})
    excluded=Counter()
    with zipfile.ZipFile(archive) as z:
        for item in z.infolist():
            if item.is_dir() or Path(item.filename).suffix.lower() not in ['.png','.jpg','.jpeg']: continue
            grade=mendeley_grade(item.filename)
            if grade is None:
                excluded[str(Path(item.filename).parent)]+=1;continue
            inferred=identity(item.filename)
            known_patient='EyePACS:'+inferred.split(':',1)[1].rsplit('_',1)[0] if inferred and inferred.startswith('eyepacs:') else None
            rows.append({'source':'Mendeley','source_id':item.filename,'raw_path':None,'level':grade,
                         'anchor':None,'known_patient':known_patient,'prepared':False})
    return rows,dict(excluded)

def prepare(rows,archive,output,excluded):
    output.mkdir(parents=True,exist_ok=True)
    if (output/'audit.json').exists(): raise ValueError('Use a new output directory for a new preparation run')
    groups=Groups(len(rows)); keys={}; tree=HashTree(); near_pairs=0
    image_dir=output/'images';image_dir.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        for i,row in enumerate(rows):
            content=z.read(row['source_id']) if row['source']=='Mendeley' else Path(row['raw_path']).read_bytes()
            raw,pixel,phash=fingerprints(content)
            # EyePACS is already processed. Hash all sources in the same production processing space too.
            processed=cv2.cvtColor(cv2.imdecode(np.frombuffer(content,np.uint8),cv2.IMREAD_COLOR),cv2.COLOR_BGR2RGB) if row['prepared'] else preprocess_bytes(content)
            normalized=hashlib.sha256(processed.tobytes()).hexdigest()
            # Cross-source matching uses both original content and normalized images.
            _,_,processed_phash=fingerprints(cv2.imencode('.png',cv2.cvtColor(processed,cv2.COLOR_RGB2BGR))[1].tobytes())
            for key in [('raw',raw),('pixel',pixel),('processed',normalized),('id',identity(row['source_id']))]:
                if key[1] is None: continue
                if key in keys: groups.union(i,keys[key])
                else: keys[key]=i
            for old in tree.query(processed_phash,4):
                groups.union(i,old);near_pairs+=1
            tree.add(processed_phash,i)
            destination=image_dir/f'{row["source"].lower()}-{i:06d}.jpg'
            if row['prepared']: destination=Path(row['raw_path']).resolve()
            else:
                ok,encoded=cv2.imencode('.jpg',cv2.cvtColor(processed,cv2.COLOR_RGB2BGR),[cv2.IMWRITE_JPEG_QUALITY,95])
                if not ok: raise ValueError('JPEG encode failed')
                destination.write_bytes(encoded.tobytes())
            row.update(path=str(destination.resolve()),raw_sha256=raw,pixel_sha256=pixel,processed_sha256=normalized,phash=f'{processed_phash:016x}')
            if (i+1)%500==0: print(f'Audited and processed {i+1}/{len(rows)}',flush=True)
    duplicates=defaultdict(list)
    for i in range(len(rows)): duplicates[groups.find(i)].append(i)
    selected=[];conflicts=[]
    for indices in duplicates.values():
        cluster=[rows[i] for i in indices]
        if len({r['level'] for r in cluster})>1:
            conflicts.append([{'source':r['source'],'image':r['source_id'],'level':r['level']} for r in cluster]);continue
        chosen=max(cluster,key=lambda r:PRIORITY.get(r['anchor'],-1)).copy()
        chosen['sources']='|'.join(sorted({r['source'] for r in cluster}))
        chosen['patients']=sorted({r['known_patient'] for r in cluster if r['known_patient']})
        chosen['anchors']=sorted({r['anchor'] for r in cluster if r['anchor']})
        chosen['duplicate_count']=len(cluster);selected.append(chosen)
    patients=Groups(len(selected)); owners={}
    for i,row in enumerate(selected):
        for patient in row['patients']:
            if patient in owners: patients.union(i,owners[patient])
            else: owners[patient]=i
    components=defaultdict(list)
    for i in range(len(selected)):components[patients.find(i)].append(i)
    splits={name:[] for name in PRIORITY}
    for root,indices in components.items():
        anchors={a for i in indices for a in selected[i]['anchors']}
        if len(anchors)>1:
            # Existing train patients are never allowed to pull held-out images into training.
            split=max(anchors,key=lambda a:PRIORITY[a])
        elif anchors: split=next(iter(anchors))
        else:
            key='|'.join(sorted(selected[i]['processed_sha256'] for i in indices))
            bucket=int(hashlib.sha256(('20261010:'+key).encode()).hexdigest()[:8],16)%100
            split='train' if bucket<70 else 'validation' if bucket<85 else 'test'
        patient='group:'+hashlib.sha256('|'.join(sorted(selected[i]['processed_sha256'] for i in indices)).encode()).hexdigest()[:20]
        for i in indices:
            row=selected[i];splits[split].append({**row,'patient':patient,'image':row['source']+':'+row['source_id']})
    for name,values in splits.items():
        pd.DataFrame(values).to_csv(output/f'{name}.csv',index=False)
    audit={'preprocessing_version':VERSION,'source_counts':dict(Counter(r['source'] for r in rows)),
           'excluded_mendeley_folders':excluded,'selected_counts':{name:len(values) for name,values in splits.items()},
           'class_counts':{name:dict(Counter(r['level'] for r in values)) for name,values in splits.items()},
           'near_duplicate_pairs':near_pairs,'conflicting_groups_excluded':len(conflicts),
           'duplicate_images_removed':sum(len(ids)-1 for ids in duplicates.values()),
           'patient_limitation':'EyePACS patient IDs retained. APTOS and Mendeley lack verified patient IDs. Duplicate grouping is not a complete substitute.',
           'evaluation_limitation':'Historical holdouts already inspected. Perceptual matching is conservative but cannot guarantee all derivatives are found.'}
    (output/'audit.json').write_text(json.dumps(audit,indent=2));(output/'conflicts.json').write_text(json.dumps(conflicts,indent=2))
    print(json.dumps(audit,indent=2),flush=True)
    return splits

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--eyepacs',type=Path,default=ROOT/'data/eyepacs/processed')
    p.add_argument('--aptos',type=Path,default=ROOT/'colored_images')
    p.add_argument('--aptos-split',type=Path,default=ROOT/'models/baseline_split.json')
    p.add_argument('--mendeley',type=Path,default=ROOT/'data/mendeley/6ry9n79gb4-v1.zip')
    p.add_argument('--output',type=Path,default=ROOT/'data/combined-dr-v1')
    args=p.parse_args()
    rows,excluded=records(args.eyepacs,args.aptos,args.aptos_split,args.mendeley)
    prepare(rows,args.mendeley,args.output,excluded)

if __name__=='__main__':main()
