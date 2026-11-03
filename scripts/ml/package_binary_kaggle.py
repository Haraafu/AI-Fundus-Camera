"""Package audited binary manifests and a self-contained private Kaggle job."""
import ast
import hashlib
import json
from pathlib import Path
import zipfile
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATASET = 'falahandhesryo/combined-dr-binary-audited-v1'
KERNEL = 'falahandhesryo/combined-dr-efficientnetb3-binary-v1'


def main(code_only=False):
    source = ROOT / 'data/combined-dr-binary-v1'
    assets = ROOT / 'data/kaggle-combined-binary-dataset'
    job = ROOT / 'data/kaggle-combined-binary-training'
    assets.mkdir(exist_ok=True)
    job.mkdir(exist_ok=True)
    audit = json.loads((source / 'audit.json').read_text())
    audit.pop('parent_manifest_directory', None)
    frames = {}
    if code_only:
        frames = {split: len(pd.read_csv(source / f'{split}.csv')) for split in ('train', 'validation', 'test')}
    else:
        with zipfile.ZipFile(assets / 'combined-binary.zip', 'w', compression=zipfile.ZIP_STORED) as archive:
            for split in ('train', 'validation', 'test'):
                frame = pd.read_csv(source / f'{split}.csv', dtype={'patient': str, 'image': str})
                packed = frame[['image', 'patient', 'level', 'dr_grade', 'class_name', 'sources']].copy()
                paths = []
                for index, path in enumerate(frame.path):
                    relative = f'images/{split}-{index:06d}.jpg'
                    archive.write(path, relative)
                    paths.append(relative)
                packed['path'] = paths
                archive.writestr(f'{split}.csv', packed.to_csv(index=False))
                frames[split] = len(packed)
            archive.writestr('audit.json', json.dumps(audit, indent=2))
    (assets / 'dataset-metadata.json').write_text(json.dumps({
        'id': DATASET, 'title': 'Combined DR Binary Audited V1',
        'licenses': [{'name': 'other'}],
        'description': 'Private experiment input: audited EyePACS, APTOS and Mendeley DR subset. Original source terms apply. Mendeley: Islam and Jahan (2025), DOI 10.17632/6ry9n79gb4.1, CC BY 4.0. No DR does not mean absence of other retinal diseases.'
    }, indent=2))
    (assets / 'SOURCES.txt').write_text('Private training input. Original source terms apply.\nEyePACS: Kaggle diabetic-retinopathy-detection competition.\nAPTOS: local audited APTOS dataset.\nMendeley: Islam, Md Samiul and Jahan, Israt (2025), DOI 10.17632/6ry9n79gb4.1, CC BY 4.0.\n')

    base = (ROOT / 'scripts/ml/train_eyepacs.py').read_text()
    functions = base[base.index('def dataset('):base.index('def evaluate(')]
    functions = functions.replace('def dataset(', 'def base_dataset(').replace('def build_model(', 'def base_build_model(')
    binary = (ROOT / 'scripts/ml/train_combined_binary.py').read_text()
    binary = binary.replace('from train_eyepacs import ROOT, SEED, dataset as base_dataset, build_model as base_build_model', '''ROOT = Path('/kaggle/working')
SEED = 20261003
GRADE_TO_CLASS = np.array([0, 1], dtype=np.int32)
''' + functions)
    bootstrap = '''import os
import sys
import zipfile
from pathlib import Path
import pandas as pd

def prepare_input():
    import json
    import shutil
    target = Path('/kaggle/working/combined-data')
    target.mkdir(exist_ok=True)
    matches = list(Path('/kaggle/input').rglob('combined-binary.zip'))
    if len(matches) == 1:
        with zipfile.ZipFile(matches[0]) as archive:
            archive.extractall(target)
        source = target
    elif not matches:
        # Kaggle may automatically unpack uploaded ZIP files in its input mount.
        candidates = []
        for audit_path in Path('/kaggle/input').rglob('audit.json'):
            metadata = json.loads(audit_path.read_text())
            parent = audit_path.parent
            if metadata.get('task') == 'binary-dr' and all((parent / f'{split}.csv').is_file() for split in ('train', 'validation', 'test')):
                candidates.append(parent)
        if len(candidates) != 1:
            raise RuntimeError(f'Expected one binary dataset root, found {len(candidates)}')
        source = candidates[0]
        shutil.copyfile(source / 'audit.json', target / 'audit.json')
    else:
        raise RuntimeError('Multiple combined dataset archives found')
    print(f'Binary dataset located at {source}', flush=True)
    for split in ('train', 'validation', 'test'):
        path = source / f'{split}.csv'
        frame = pd.read_csv(path, dtype={'patient': str, 'image': str})
        frame['path'] = frame.path.map(lambda value: str(source / value))
        if not frame.path.map(lambda value: Path(value).is_file()).all():
            raise RuntimeError(f'Missing image files in {split}')
        frame.to_csv(target / f'{split}.csv', index=False)
        print(f'{split}: {len(frame)} images verified', flush=True)
    sys.argv = ['run.py', '--data', str(target), '--output', '/kaggle/working/combined_dr_binary_b3_v1']

prepare_input()
'''
    # Future imports must stay at the beginning of the complete script.
    binary = binary.replace('from __future__ import annotations\n', '')
    script = bootstrap + '\n' + binary
    script = script.replace('    model, backbone = build_model(weights=weights)', '''    if not tf.config.list_physical_devices('GPU'):
        raise RuntimeError('GPU required for full combined training. Refusing CPU fallback.')
    model, backbone = build_model(weights=weights)''')
    ast.parse(script)
    (job / 'run.py').write_text(script, encoding='utf-8')
    (job / 'kernel-metadata.json').write_text(json.dumps({
        'id': KERNEL, 'title': 'Combined DR EfficientNetB3 Binary V1', 'code_file': 'run.py',
        'language': 'python', 'kernel_type': 'script', 'is_private': 'true',
        'enable_gpu': 'true', 'enable_tpu': 'false', 'enable_internet': 'true',
        'dataset_sources': [DATASET], 'competition_sources': [], 'kernel_sources': [], 'model_sources': []
    }, indent=2))
    manifest = {'dataset': DATASET, 'kernel': KERNEL, 'split_sizes': frames,
                'archive_bytes': (assets / 'combined-binary.zip').stat().st_size,
                'script_sha256': hashlib.sha256(script.encode()).hexdigest()}
    (job / 'package.json').write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--code-only', action='store_true')
    main(parser.parse_args().code_only)
