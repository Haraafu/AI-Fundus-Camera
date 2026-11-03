import json
from pathlib import Path
import tempfile
import unittest
import pandas as pd
from prepare_binary_dr import prepare


class BinaryPreparationTests(unittest.TestCase):
    def fixture(self, root):
        source = root / 'source'
        source.mkdir()
        (source / 'audit.json').write_text('{}')
        for split in ('train', 'validation', 'test'):
            pd.DataFrame([{'level': grade, 'image': f'{split}-{grade}', 'patient': f'{split}-{grade}',
                           'path': f'{split}-{grade}.jpg', 'sources': 'APTOS'} for grade in range(5)]).to_csv(source / f'{split}.csv', index=False)
        return source

    def test_all_dr_grades_collapse_without_changing_split_ids(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.fixture(root)
            original = (source / 'train.csv').read_bytes()
            frames = prepare(source, root / 'binary')
            for split, frame in frames.items():
                self.assertEqual(frame.level.tolist(), [0, 1, 1, 1, 1])
                self.assertEqual(frame.dr_grade.tolist(), list(range(5)))
                self.assertEqual(frame.image.tolist(), [f'{split}-{g}' for g in range(5)])
            self.assertEqual((source / 'train.csv').read_bytes(), original)
            self.assertEqual(json.loads((root / 'binary/audit.json').read_text())['class_names'], ['No DR', 'DR'])
            with self.assertRaises(FileExistsError):
                prepare(source, root / 'binary')

    def test_rejects_patient_leakage_and_invalid_grades(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = self.fixture(root)
            frame = pd.read_csv(source / 'test.csv')
            frame.loc[0, 'patient'] = 'train-0'
            frame.to_csv(source / 'test.csv', index=False)
            with self.assertRaisesRegex(ValueError, 'leakage'):
                prepare(source, root / 'binary')
            frame.loc[0, 'patient'] = 'test-0'
            frame.loc[0, 'level'] = 5
            frame.to_csv(source / 'test.csv', index=False)
            with self.assertRaisesRegex(ValueError, 'Invalid original'):
                prepare(source, root / 'binary')


if __name__ == '__main__':
    unittest.main()
