"""Class-specific Grad-CAM for a nested EfficientNet backbone and its trained head."""
import base64

import cv2
import numpy as np

from .preprocessing import encode_png

VERSION = "gradcam-v2"


class GradCAM:
    def __init__(self, model):
        import tensorflow as tf

        # The exported checkpoint contains a nested EfficientNetB3.
        # Split at its pooled output so the original trained head is reused.
        backbone = next(layer for layer in model.layers
                        if isinstance(layer, tf.keras.Model) and any(x.name == "top_conv" for x in layer.layers))
        self.layer_name = f"{backbone.name}/top_conv"
        self.features = tf.keras.Model(backbone.input,
                                       [backbone.get_layer("top_conv").output, backbone.output])
        head_inputs = backbone._inbound_nodes[-1].output_tensors
        self.head = tf.keras.Model(head_inputs, model.output)
        self.scores = self.head
        self.score_type = "model_output"
        final = self.head.layers[-1]
        # Explain the class logit rather than a saturated softmax probability.
        # Clone only the final Dense layer: never mutate the prediction model's
        # activation, dtype, or weights (the original head remains reusable).
        if isinstance(final, tf.keras.layers.Dense) and tf.keras.activations.serialize(final.activation) == "softmax":
            config = final.get_config()
            config.update(activation="linear", dtype="float32", name=f"{final.name}_gradcam_logits")
            logits = tf.keras.layers.Dense.from_config(config)
            score_output = logits(final.input)
            logits.set_weights(final.get_weights())
            self.scores = tf.keras.Model(head_inputs, score_output)
            self.score_type = "logit"
        elif isinstance(final, tf.keras.layers.Softmax) or (
                isinstance(final, tf.keras.layers.Activation)
                and tf.keras.activations.serialize(final.activation) == "softmax"):
            self.scores = tf.keras.Model(head_inputs, final.input)
            self.score_type = "logit"

    def explain(self, batch, processed, target_index, target_class):
        import tensorflow as tf

        inputs = tf.convert_to_tensor(batch)
        with tf.GradientTape() as tape:
            # Watching inputs is necessary when the backbone is frozen.
            tape.watch(inputs)
            activations, pooled = self.features(inputs, training=False)
            output = self.scores(pooled, training=False)
            score = output[:, target_index]
        gradients = tape.gradient(score, activations)
        if gradients is None:
            raise ValueError("Target class is disconnected from convolutional activations")
        # Mixed-precision checkpoints produce float16 activations/gradients.
        # Accumulate in float32 (avoids half-precision reduction overflow),
        # which is also a supported OpenCV resize input dtype.
        gradients = tf.cast(gradients, tf.float32)
        activations = tf.cast(activations, tf.float32)
        weights = tf.reduce_mean(gradients, axis=(1, 2), keepdims=True)
        heatmap = tf.maximum(tf.reduce_sum(weights * activations, axis=-1)[0], 0).numpy()
        if not np.isfinite(heatmap).all():
            raise ValueError("Non-finite Grad-CAM")
        peak = float(heatmap.max())
        if peak <= 0:
            return {"status": "UNAVAILABLE", "method": "Grad-CAM", "version": VERSION,
                    "reason": "NO_POSITIVE_ACTIVATION", "targetClass": target_class,
                    "layer": self.layer_name, "scoreType": self.score_type}
        heatmap = cv2.resize(np.asarray(heatmap / peak, dtype=np.float32),
                             (300, 300), interpolation=cv2.INTER_LINEAR)
        colored = cv2.cvtColor(cv2.applyColorMap(np.uint8(heatmap * 255), cv2.COLORMAP_JET), cv2.COLOR_BGR2RGB)
        # Keep zero-activation areas unchanged rather than tinting every pixel.
        alpha = (0.45 * heatmap[..., None]).astype(np.float32)
        overlay = np.uint8(np.clip(processed * (1 - alpha) + colored * alpha, 0, 255))
        return {"status": "AVAILABLE", "method": "Grad-CAM", "version": VERSION,
                "targetClass": target_class, "layer": self.layer_name, "scoreType": self.score_type,
                "coordinateSpace": "processed", "outputResolution": [300, 300],
                "mimeType": "image/png", "imageBase64": base64.b64encode(encode_png(overlay)).decode("ascii"),
                "heatmapBase64": base64.b64encode(encode_png(colored)).decode("ascii")}
