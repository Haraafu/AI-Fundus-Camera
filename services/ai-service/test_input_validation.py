"""Input rejection is fail-closed and happens before disease inference."""
import importlib.util
import io
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from fundus.input_validation import FundusInputValidator, InputValidationError
from test_fixture_server import TestImageValidator

spec = importlib.util.spec_from_file_location('input_test_app', Path(__file__).with_name('app.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def png(image):
    output = io.BytesIO()
    image.save(output, format='PNG')
    return output.getvalue()


class RejectedValidator:
    ready = True

    def require_fundus(self, content, content_type=None):
        raise InputValidationError('NON_FUNDUS_IMAGE', 'Image type check: map. Upload a retinal fundus photograph instead.')


class InputValidationTests(unittest.TestCase):
    def setUp(self):
        self.image = png(Image.new('RGB', (300, 300), 'orange'))

    def test_direct_predict_and_preflight_reject_before_any_disease_inference(self):
        adapter = SimpleNamespace(ready=True, mode='model', model_loaded=True, model_version='test', error_code=None, predict=Mock())
        with patch.object(module, 'create_adapter', return_value=adapter):
            app = module.create_app('model', image_validator=RejectedValidator())
        with TestClient(app) as client:
            for route in ['/validate-image', '/predict']:
                response = client.post(route, files={'image': ('fundus.png', self.image, 'image/png')})
                self.assertEqual(response.status_code, 422)
                self.assertEqual(response.json()['error']['code'], 'NON_FUNDUS_IMAGE')
                self.assertNotIn('prediction', response.json())
        adapter.predict.assert_not_called()

    def test_missing_validator_blocks_readiness_and_requests(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertLogs('fundus.input_validation', level='ERROR'):
                validator = FundusInputValidator(Path(directory))
        self.assertFalse(validator.ready)
        with TestClient(module.create_app('mock', image_validator=validator)) as client:
            self.assertEqual(client.get('/ready').status_code, 503)
            for route in ['/validate-image', '/predict']:
                response = client.post(route, files={'image': ('fundus.png', self.image, 'image/png')})
                self.assertEqual(response.status_code, 503)
                self.assertEqual(response.json()['error']['code'], 'IMAGE_VALIDATOR_UNAVAILABLE')
                self.assertNotIn('prediction', response.json())

    def test_service_errors_do_not_fall_through_to_dr_prediction(self):
        validator = TestImageValidator()
        validator.require_fundus = Mock(side_effect=RuntimeError('internal validator failure'))
        with TestClient(module.create_app('mock', image_validator=validator)) as client:
            response = client.post('/predict', files={'image': ('retina.png', self.image, 'image/png')})
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('prediction', response.json())
            self.assertNotIn('internal validator failure', response.text)

    def test_accepted_input_is_bound_to_original_bytes(self):
        with TestClient(module.create_app('mock', image_validator=TestImageValidator())) as client:
            response = client.post('/validate-image', files={'image': ('retina.png', self.image, 'image/png')})
            import hashlib
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['inputValidation']['sourceSha256'], hashlib.sha256(self.image).hexdigest())


@unittest.skipUnless(os.getenv('LUXORA_TEST_INPUT_VALIDATOR') == '1', 'Opt in to real local model checks')
class RealInputValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.validator = FundusInputValidator()
        if not cls.validator.ready:
            raise RuntimeError('Run scripts/setup_input_validator.py before real model checks')

    def test_blank_images_and_geographic_diagram_are_rejected(self):
        images = [Image.new('RGB', (300, 300), color) for color in ['white', 'black', 'red', 'orange']]
        diagram = Image.new('RGB', (500, 350), '#85cce0')
        draw = ImageDraw.Draw(diagram)
        draw.polygon([(20, 180), (80, 60), (240, 80), (410, 200), (220, 310)], fill='#b9dda9', outline='black', width=2)
        for x in range(60, 350, 60):
            draw.line([(x, 100), (x + 60, 260)], fill='white', width=5)
            draw.text((x, 130), 'ROAD MAP', fill='black')
        images.append(diagram)
        for image in images:
            decision = self.validator.inspect(png(image))
            self.assertEqual(decision['decision'], 'Not eye')
            self.assertEqual(decision['detectedLabel'], 'Not eye')
            self.assertEqual(decision['imageType'], 'not_eye')
            with self.subTest(size=image.size), self.assertRaises(InputValidationError):
                self.validator.require_fundus(png(image))

    def test_actual_fundus_examples_are_accepted(self):
        for name in ['No_DR/002c21358ce6.png', 'Proliferate_DR/001639a390f0.png']:
            image = ROOT / 'colored_images' / name
            if not image.exists():
                self.skipTest('Dataset fixture not present')
            result = self.validator.require_fundus(image.read_bytes(), 'image/png')
            self.assertEqual(result['status'], 'ACCEPTED')
            self.assertEqual(result['imageType'], 'retinal_fundus')
            self.assertEqual(result['decision'], 'Eye')


if __name__ == '__main__':
    unittest.main(verbosity=2)
