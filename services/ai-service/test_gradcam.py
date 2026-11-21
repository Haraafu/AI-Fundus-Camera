"""Verify gradients target the requested class, including a frozen nested backbone."""
import base64
from pathlib import Path
import sys
import unittest

import cv2
import numpy as np
import tensorflow as tf

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fundus.gradcam import GradCAM


class GradCAMTests(unittest.TestCase):
    def setUp(self):
        inputs = tf.keras.Input((300, 300, 3))
        conv = tf.keras.layers.Conv2D(2, 1, use_bias=False, name="top_conv")(inputs)
        pooled = tf.keras.layers.GlobalAveragePooling2D()(conv)
        backbone = tf.keras.Model(inputs, pooled, name="test_backbone")
        kernel = np.zeros((1, 1, 3, 2), np.float32)
        kernel[0, 0, 0, 0] = 1
        kernel[0, 0, 1, 1] = 1
        backbone.get_layer("top_conv").set_weights([kernel])
        backbone.trainable = False
        outer = tf.keras.Input((300, 300, 3))
        head = tf.keras.layers.Dense(2, use_bias=False)
        self.model = tf.keras.Model(outer, head(backbone(outer)))
        head.set_weights([np.eye(2, dtype=np.float32)])
        self.head = head
        self.image = np.zeros((300, 300, 3), np.uint8)
        self.image[:, :150, 0] = 200
        self.image[:, 150:, 1] = 200
        self.batch = self.image[None].astype(np.float32)

    def test_class_target_changes_heatmap_and_reuses_exact_head(self):
        cam = GradCAM(self.model)
        _, features = cam.features(self.batch, training=False)
        np.testing.assert_allclose(cam.head(features).numpy(), self.model(self.batch).numpy())
        maps = []
        for index in (0, 1):
            result = cam.explain(self.batch, self.image, index, str(index))
            self.assertEqual(result['status'], 'AVAILABLE')
            decoded = cv2.imdecode(np.frombuffer(base64.b64decode(result['heatmapBase64']), np.uint8), cv2.IMREAD_COLOR)
            self.assertEqual(decoded.shape, (300, 300, 3))
            maps.append(decoded)
        self.assertGreater(maps[0][:, :140, 2].mean(), maps[0][:, 160:, 2].mean())
        self.assertGreater(maps[1][:, 160:, 2].mean(), maps[1][:, :140, 2].mean())
        self.assertFalse(np.array_equal(maps[0], maps[1]))

    def test_zero_gradient_does_not_fabricate_heatmap(self):
        self.head.set_weights([np.zeros((2, 2), np.float32)])
        result = GradCAM(self.model).explain(self.batch, self.image, 0, '0')
        self.assertEqual(result['status'], 'UNAVAILABLE')
        self.assertEqual(result['reason'], 'NO_POSITIVE_ACTIVATION')
        self.assertNotIn('imageBase64', result)

    def test_mixed_float16_checkpoint_generates_valid_class_specific_images(self):
        previous = tf.keras.mixed_precision.global_policy()
        try:
            tf.keras.mixed_precision.set_global_policy('mixed_float16')
            self.setUp()
        finally:
            tf.keras.mixed_precision.set_global_policy(previous)
        cam = GradCAM(self.model)
        activations, _ = cam.features(self.batch, training=False)
        self.assertEqual(activations.dtype, tf.float16)
        maps = []
        for index in (0, 1):
            result = cam.explain(self.batch, self.image, index, str(index))
            self.assertEqual(result['status'], 'AVAILABLE')
            self.assertEqual(result['targetClass'], str(index))
            for key in ('imageBase64', 'heatmapBase64'):
                decoded = cv2.imdecode(np.frombuffer(base64.b64decode(result[key]), np.uint8), cv2.IMREAD_COLOR)
                self.assertEqual(decoded.shape, (300, 300, 3))
            maps.append(decoded)
        self.assertGreater(maps[0][:, :140, 2].mean(), maps[0][:, 160:, 2].mean())
        self.assertGreater(maps[1][:, 160:, 2].mean(), maps[1][:, :140, 2].mean())

    def test_saturated_softmax_uses_logits_without_mutating_prediction_model(self):
        # A confident half-precision head can have zero probability gradients.
        # Logit Grad-CAM retains a class-specific signal and preserves softmax.
        features = self.model.layers[1]
        inputs = tf.keras.Input((300, 300, 3))
        final = tf.keras.layers.Dense(2, activation='softmax', dtype='float32')
        model = tf.keras.Model(inputs, final(features(inputs)))
        final.set_weights([np.eye(2, dtype=np.float32) * 10, np.zeros(2, dtype=np.float32)])
        image = self.image.copy()
        image[:, 150:, 1] = 20
        batch = image[None].astype(np.float32)
        before = model(batch).numpy()
        self.assertEqual(before[0, 0], 1.0)
        cam = GradCAM(model)
        self.assertEqual(cam.score_type, 'logit')
        result = cam.explain(batch, image, 0, 'No_DR')
        self.assertEqual(result['status'], 'AVAILABLE')
        np.testing.assert_array_equal(before, model(batch).numpy())
        self.assertEqual(tf.keras.activations.serialize(final.activation), 'softmax')


if __name__ == '__main__':
    unittest.main(verbosity=2)
