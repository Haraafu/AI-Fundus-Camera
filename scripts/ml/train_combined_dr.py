"""Train one EfficientNetB3 using the audited combined five-class manifests."""
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
from train_eyepacs_v2 import train,metrics
ROOT=Path(__file__).resolve().parents[2]

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--data',type=Path,default=ROOT/'data/combined-dr-v1')
    p.add_argument('--output',type=Path,default=ROOT/'models/combined_dr_b3_v1')
    p.add_argument('--batch-size',type=int,default=16)
    p.add_argument('--head-epochs',type=int,default=8)
    p.add_argument('--fine-tune-epochs',type=int,default=20)
    args=p.parse_args()
    audit=json.loads((args.data/'audit.json').read_text())
    frames={name:pd.read_csv(args.data/f'{name}.csv',dtype={'patient':str,'image':str}) for name in ['train','validation','test']}
    report=train(frames,args.output,args.batch_size,args.head_epochs,args.fine_tune_epochs)
    report['experiment']='combined-dr-efficientnetb3-v1'
    report['data_audit']=audit
    report['mendeley_attribution']='Islam, Md Samiul; Jahan, Israt (2025), Diabetic Retinopathy and Retinal Diseases Fundus Image Dataset, V1, doi:10.17632/6ry9n79gb4.1, CC BY 4.0'
    report['per_source_metrics']={}
    for split,frame in frames.items():
        saved=np.load(args.output/f'predictions-{split}.npz')
        if saved['image'].tolist()!=frame.image.tolist(): raise ValueError('Prediction and manifest order mismatch')
        report['per_source_metrics'][split]={}
        for source in ['EyePACS','APTOS','Mendeley']:
            mask=frame.sources.fillna('').str.split('|').apply(lambda names:source in names).to_numpy()
            if mask.any(): report['per_source_metrics'][split][source]={'images':int(mask.sum()),**metrics(saved['truth'][mask],saved['probabilities'][mask])}
    (args.output/'report.json').write_text(json.dumps(report,indent=2))
    print('Saved combined model and per-source evaluation:',args.output)

if __name__=='__main__':main()
