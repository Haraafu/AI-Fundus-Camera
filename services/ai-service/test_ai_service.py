import base64
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import cv2
import numpy as np
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from fundus import adapters
from fundus.contract import map_probabilities
from fundus.preprocessing import VERSION, crop_black_border, encode_png, model_input, preprocess_bytes

spec = importlib.util.spec_from_file_location("ai_app", Path(__file__).with_name("app.py"))
ai_app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ai_app)


class AiServiceTests(unittest.TestCase):
    def setUp(self):
        self.rgb = np.zeros((400, 500, 3), dtype=np.uint8)
        self.rgb[50:350, 100:400] = [185, 95, 35]
        self.png = encode_png(self.rgb)

    def test_crop_retains_roi_and_handles_all_black_image(self):
        np.testing.assert_array_equal(crop_black_border(self.rgb), self.rgb[50:350, 100:400])
        black = np.zeros((20, 30, 3), dtype=np.uint8)
        np.testing.assert_array_equal(crop_black_border(black), black)

    def test_preprocessing_produces_rgb_png_and_unscaled_model_input(self):
        processed = preprocess_bytes(self.png)
        self.assertEqual(processed.shape, (300, 300, 3))
        decoded = cv2.imdecode(np.frombuffer(encode_png(processed), dtype=np.uint8), cv2.IMREAD_COLOR)
        np.testing.assert_array_equal(cv2.cvtColor(decoded, cv2.COLOR_BGR2RGB), processed)
        tensor = model_input(np.full((300, 300, 3), 255, dtype=np.uint8))
        self.assertEqual(tensor.shape, (1, 300, 300, 3))
        self.assertEqual(tensor.dtype, np.float32)
        self.assertEqual(float(tensor.max()), 255.0)

    def test_explicit_training_order_and_legacy_label_map_to_api(self):
        prediction, probabilities = map_probabilities([.05, .1, .15, .6, .1],
            ['Mild', 'Moderate', 'No_DR', 'Proliferate_DR', 'Severe'])
        self.assertEqual(prediction, {'class': 'Proliferative_DR', 'confidence': .6})
        self.assertEqual(probabilities['No_DR'], .15)
        self.assertEqual(list(probabilities), ['No_DR', 'Mild', 'Moderate', 'Severe', 'Proliferative_DR'])

    def test_invalid_model_outputs_and_class_lists_are_rejected(self):
        names = ['Mild', 'Moderate', 'No_DR', 'Proliferate_DR', 'Severe']
        for values in ([.1] * 5, [float('nan'), .1, .1, .1, .6], [0, 0, 0, 0, 2]):
            with self.subTest(values=values), self.assertRaises(ValueError):
                map_probabilities(values, names)
        with self.assertRaises(ValueError):
            map_probabilities([.2] * 5, ['Mild'] * 5)

    def test_mock_preprocesses_but_still_marks_prediction_as_mock(self):
        with TestClient(ai_app.create_app('mock')) as client:
            health = client.get('/ready')
            self.assertEqual(health.status_code, 200)
            self.assertFalse(health.json()['modelLoaded'])
            response = client.post('/predict', files={'image': ('fundus.png', self.png, 'image/png')})
            self.assertEqual(response.status_code, 200)
            result = response.json()
            self.assertTrue(result['isMock'])
            self.assertEqual(result['modelVersion'], 'mock-v0')
            self.assertEqual(result['preprocessingVersion'], VERSION)
            actual = cv2.imdecode(np.frombuffer(base64.b64decode(result['preprocessing']['imageBase64']), dtype=np.uint8), cv2.IMREAD_COLOR)
            np.testing.assert_array_equal(cv2.cvtColor(actual, cv2.COLOR_BGR2RGB), preprocess_bytes(self.png))

    def test_corrupt_and_mislabeled_uploads_are_rejected(self):
        with TestClient(ai_app.create_app('mock')) as client:
            for content, mime in [(b'not an image', 'image/png'), (self.png, 'image/jpeg')]:
                response = client.post('/predict', files={'image': ('fundus.png', content, mime)})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()['error']['code'], 'INVALID_IMAGE')

    def test_missing_model_is_not_ready_and_never_returns_mock(self):
        missing = ROOT / 'models' / 'does-not-exist.keras'
        with TestClient(ai_app.create_app('model', model_path=missing)) as client:
            health = client.get('/health')
            self.assertEqual(health.status_code, 200)
            self.assertEqual(health.json()['mode'], 'model')
            self.assertFalse(health.json()['isMock'])
            self.assertFalse(health.json()['ready'])
            self.assertIsNone(health.json()['modelVersion'])
            self.assertEqual(client.get('/ready').status_code, 503)
            response = client.post('/predict', files={'image': ('fundus.png', self.png, 'image/png')})
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()['error']['code'], 'MODEL_NOT_READY')
            self.assertNotIn('prediction', response.json())

    def test_model_load_failure_is_reported_without_mock_fallback(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / 'broken.keras'
            model_path.write_bytes(b'not a model')
            with patch.object(adapters, '_load_model', side_effect=RuntimeError('load failed')):
                with TestClient(ai_app.create_app('model', model_path=model_path)) as client:
                    health = client.get('/ready')
                    self.assertEqual(health.status_code, 503)
                    self.assertEqual(health.json()['errorCode'], 'MODEL_LOAD_FAILED')
                    response = client.post('/predict', files={'image': ('fundus.png', self.png, 'image/png')})
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json()['error']['code'], 'MODEL_LOAD_FAILED')
                    self.assertNotIn('prediction', response.json())

    def test_invalid_model_output_returns_structured_inference_error(self):
        class InvalidOutputModel:
            input_shape = (None, 300, 300, 3)
            output_shape = (None, 5)

            def __call__(self, batch, training=False):
                return np.zeros((1, 5), dtype=np.float32)

        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / 'invalid-output.keras'
            model_path.write_bytes(b'test fixture')
            with patch.object(adapters, '_load_model', return_value=InvalidOutputModel()):
                with TestClient(ai_app.create_app('model', model_path=model_path,
                                                   model_version='invalid-output-test')) as client:
                    self.assertEqual(client.get('/ready').status_code, 200)
                    response = client.post('/predict', files={'image': ('fundus.png', self.png, 'image/png')})
                    self.assertEqual(response.status_code, 500)
                    self.assertEqual(response.json()['error']['code'], 'INFERENCE_FAILED')
                    self.assertNotIn('prediction', response.json())

    def test_invalid_mode_cannot_silently_select_mock(self):
        with self.assertRaises(ValueError):
            ai_app.create_app('typo')


if __name__ == '__main__':
    unittest.main(verbosity=2)
