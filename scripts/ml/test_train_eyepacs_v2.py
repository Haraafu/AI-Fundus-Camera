"""Contract and two-phase smoke checks for the revised training experiment."""
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
import tensorflow as tf
from PIL import Image
import train_eyepacs_v2 as training

class TrainingTests(unittest.TestCase):
    def test_metrics_do_not_hide_missing_class_recall(self):
        truth = np.array([0,1,2,3,4] * 2)
        perfect = training.metrics(truth, np.eye(5)[truth])
        self.assertTrue(perfect['target_above_90_macro'])
        self.assertTrue(perfect['target_above_90_every_class'])
        failed = training.metrics(truth, np.tile([0,0,1,0,0], (10,1)))
        self.assertAlmostEqual(failed['accuracy'], .2)
        self.assertAlmostEqual(failed['macro_recall'], .2)
        self.assertFalse(failed['target_above_90_macro'])
        np.testing.assert_allclose(np.sum(failed['confusion_matrix_row_normalized'],axis=1), 1)

    def test_sampling_mix(self):
        frame = pd.DataFrame({'level':[0]*70+[1]*10+[2]*10+[3]*5+[4]*5})
        weights = training.sampling_weights(frame, .5)
        np.testing.assert_allclose(weights, [.45,.15,.15,.125,.125])
        self.assertAlmostEqual(sum(weights), 1)

    def test_two_phase_checkpoint_and_patient_leakage(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); frames={}
            for split in ['train','validation','test']:
                rows=[]
                for grade in range(5):
                    path=root/f'{split}-{grade}.jpg'
                    Image.new('RGB',(300,300),(30+grade*40,50,100)).save(path)
                    rows.append({'path':str(path),'image':f'{split}-{grade}','patient':f'{split}-{grade}','level':grade})
                frames[split]=pd.DataFrame(rows)
            leaking={k:v.copy() for k,v in frames.items()}
            leaking['test'].loc[0,'patient']=leaking['train'].loc[0,'patient']
            with self.assertRaisesRegex(ValueError,'patient leakage'):
                training.validate_frames(leaking)
            original=training.build_model
            def tiny(weights=None):
                inputs=tf.keras.Input((300,300,3))
                inner_input=tf.keras.Input((300,300,3))
                features=tf.keras.layers.GlobalAveragePooling2D()(inner_input)
                backbone=tf.keras.Model(inner_input,features,name='tiny_backbone')
                backbone.trainable=False
                out=tf.keras.layers.Dense(5,activation='softmax')(backbone(inputs))
                return tf.keras.Model(inputs,out),backbone
            training.build_model=tiny
            try:
                result=training.train(frames,root/'out',batch_size=5,head_epochs=1,fine_tune_epochs=1,weights=None)
            finally:
                training.build_model=original
            self.assertEqual(result['split_sizes']['test'],5)
            self.assertEqual(result['selection_metric'],'validation macro F1')
            self.assertTrue((root/'out/best.keras').exists())
            self.assertTrue((root/'out/predictions-test.npz').exists())
            self.assertIn('val_macro_f1',(root/'out/history-finetune.csv').read_text())
            loaded=tf.keras.models.load_model(root/'out/best.keras')
            self.assertEqual(loaded.output_shape,(None,5))

if __name__=='__main__':
    unittest.main()
