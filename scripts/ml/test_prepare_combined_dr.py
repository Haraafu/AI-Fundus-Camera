import io
import tempfile
import unittest
import zipfile
from pathlib import Path
import numpy as np
from PIL import Image
from prepare_combined_dr import mendeley_grade,identity,prepare

class CombinedTests(unittest.TestCase):
    def test_label_mapping_excludes_other_diseases_and_ambiguous_grades(self):
        for folder,grade in [('11.Normal Fundus',0),('3.Mild DR',1),('4.Moderate DR',2),('5.Severe DR',3),('6.Proliferate DR',4)]:
            self.assertEqual(mendeley_grade(folder+'/image.png'),grade)
        for folder in ['10.Glaucoma','1.Dry AMD','12. Advanced PDR','13. Very Severe NPDR']:
            self.assertIsNone(mendeley_grade(folder+'/image.png'))
        self.assertEqual(identity('copy_000c1434d8d7_2.png'),'aptos:000c1434d8d7')
        self.assertEqual(identity('10003_left.jpg'),'eyepacs:10003_left')
        self.assertEqual(identity('Severe DR1002_left_0_4903.jpeg'),'eyepacs:1002_left')
    def test_duplicate_stays_in_holdout_and_conflicting_labels_are_excluded(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);raw=root/'raw.png'
            image=Image.fromarray(np.random.default_rng(1).integers(20,230,(80,80,3),dtype=np.uint8));image.save(raw)
            mem=io.BytesIO();image.save(mem,format='PNG',compress_level=0)
            archive=root/'data.zip'
            with zipfile.ZipFile(archive,'w') as z:z.writestr('4.Moderate DR/copy.png',mem.getvalue())
            rows=[{'source':'APTOS','source_id':'original','raw_path':str(raw),'level':2,'anchor':'test','known_patient':None,'prepared':False},
                  {'source':'Mendeley','source_id':'4.Moderate DR/copy.png','raw_path':None,'level':2,'anchor':None,'known_patient':None,'prepared':False}]
            splits=prepare(rows,archive,root/'out',{})
            self.assertEqual(len(splits['test']),1);self.assertFalse(splits['train']);self.assertFalse(splits['validation'])
            self.assertEqual(splits['test'][0]['sources'],'APTOS|Mendeley')
            rows[1]['level']=1
            splits=prepare(rows,archive,root/'conflicting',{})
            self.assertEqual(sum(map(len,splits.values())),0)
            import json
            self.assertEqual(json.loads((root/'conflicting/audit.json').read_text())['conflicting_groups_excluded'],1)

if __name__=='__main__':unittest.main()
