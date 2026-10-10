"""Class-specific Grad-CAM for a nested EfficientNet backbone and its trained head."""
import base64

import cv2
import numpy as np

from .preprocessing import encode_png

VERSION = "gradcam-v1"


class GradCAM:
    def __init__(self, model):
        import tensorflow as tf

        # The exported ordinal checkpoint contains a nested EfficientNetB3.
        # Split at its pooled output so the original trained head is reused.
        backbone = next(layer for layer in model.layers
                        if isinstance(layer, tf.keras.Model) and any(x.name == "top_conv" for x in layer.layers))
        self.layer_name = f"{backbone.name}/top_conv"
        self.features = tf.keras.Model(backbone.input,
                                       [backbone.get_layer("top_conv").output, backbone.output])
        self.head = tf.keras.Model(backbone._inbound_nodes[-1].output_tensors, model.output)

    def explain(self, batch, processed, target_index, target_class):
        import tensorflow as tf

        inputs = tf.convert_to_tensor(batch)
        with tf.GradientTape() as tape:
            # Watching inputs is necessary when the backbone is frozen.
            tape.watch(inputs)
            activations, pooled = self.features(inputs, training=False)
            output = self.head(pooled, training=False)
            score = output[:, target_index]
        gradients = tape.gradient(score, activations)
        if gradients is None:
            raise ValueError("Target class is disconnected from convolutional activations")
        weights = tf.reduce_mean(gradients, axis=(1, 2), keepdims=True)
        heatmap = tf.maximum(tf.reduce_sum(weights * activations, axis=-1)[0], 0).numpy()
        if not np.isfinite(heatmap).all():
            raise ValueError("Non-finite Grad-CAM")
        peak = float(heatmap.max())
        if peak <= 0:
            return {"status": "UNAVAILABLE", "method": "Grad-CAM", "version": VERSION,
                    "reason": "NO_POSITIVE_ACTIVATION", "targetClass": target_class,
                    "layer": self.layer_name}
        heatmap = cv2.resize(heatmap / peak, (300, 300), interpolation=cv2.INTER_LINEAR)
        colored = cv2.cvtColor(cv2.applyColorMap(np.uint8(heatmap * 255), cv2.COLORMAP_JET), cv2.COLOR_BGR2RGB)
        # Keep zero-activation areas unchanged rather than tinting every pixel.
        alpha = (0.45 * heatmap[..., None]).astype(np.float32)
        overlay = np.uint8(np.clip(processed * (1 - alpha) + colored * alpha, 0, 255))
        return {"status": "AVAILABLE", "method": "Grad-CAM", "version": VERSION,
                "targetClass": target_class, "layer": self.layer_name,
                "coordinateSpace": "processed", "outputResolution": [300, 300],
                "mimeType": "image/png", "imageBase64": base64.b64encode(encode_png(overlay)).decode("ascii"),
                "heatmapBase64": base64.b64encode(encode_png(colored)).decode("ascii")}
