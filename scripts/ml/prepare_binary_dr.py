"""Map audited five-grade manifests to binary DR labels without changing splits."""
import argparse
import json
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
CLASS_NAMES = ['No DR', 'DR']


def prepare(source, output):
    frames = {}
    for split in ('train', 'validation', 'test'):
        frame = pd.read_csv(source / f'{split}.csv', dtype={'patient': str, 'image': str})
        if frame.empty or frame.level.isna().any() or not frame.level.isin(range(5)).all():
            raise ValueError(f'Invalid original DR grades: {split}')
        frame['dr_grade'] = frame.level
        frame['level'] = (frame.dr_grade > 0).astype(int)
        frame['class_name'] = frame.level.map(dict(enumerate(CLASS_NAMES)))
        if set(frame.level) != {0, 1}:
            raise ValueError(f'Both binary classes required: {split}')
        if frame[['patient', 'image', 'path']].isnull().any().any() or frame.image.duplicated().any():
            raise ValueError(f'Invalid identifiers: {split}')
        frames[split] = frame
    for left, right in [('train', 'validation'), ('train', 'test'), ('validation', 'test')]:
        for key in ('patient', 'image', 'path'):
            if set(frames[left][key]) & set(frames[right][key]):
                raise ValueError(f'{key} leakage: {left}/{right}')
    audit = json.loads((source / 'audit.json').read_text(encoding='utf-8'))
    audit['task'] = 'binary-dr'
    audit['class_names'] = CLASS_NAMES
    audit['grade_to_class_index'] = [0, 1, 1, 1, 1]
    audit['label_scope'] = 'No DR means no diabetic retinopathy according to the dataset label, not absence of all eye diseases. DR includes grades 1-4.'
    audit['parent_manifest_directory'] = str(source.resolve())
    audit['binary_class_counts'] = {s: {CLASS_NAMES[i]: int((f.level == i).sum()) for i in range(2)} for s, f in frames.items()}
    audit['preparation_policy'] = 'Retain audited images, exclusions and split membership. No reintroduction of excluded conflicts or other diseases.'
    output.mkdir(parents=True, exist_ok=False)
    for split, frame in frames.items():
        frame.to_csv(output / f'{split}.csv', index=False)
    (output / 'audit.json').write_text(json.dumps(audit, indent=2), encoding='utf-8')
    print(json.dumps(audit['binary_class_counts'], indent=2))
    return frames


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'data/combined-dr-v1')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/combined-dr-binary-v1')
    args = parser.parse_args()
    prepare(args.source, args.output)
