"""Prediction adapters for explicit mock and TensorFlow model modes."""
import os
from pathlib import Path
from threading import Lock

import numpy as np

from .contract import CLASSES, canonical_label, map_probabilities
from .preprocessing import model_input


DEFAULT_MODEL_CLASSES = ("Mild", "Moderate", "No_DR", "Proliferate_DR", "Severe")


class ModelNotReadyError(RuntimeError):
    pass


def _load_model(path):
    # TensorFlow remains optional in mock mode and is imported only when needed.
    import tensorflow as tf

    return tf.keras.models.load_model(path, compile=False)


def _risk_level(predicted_class):
    if predicted_class == "No_DR":
        return "LOW"
    if predicted_class in ("Mild", "Moderate"):
        return "MEDIUM"
    return "HIGH"


class MockAdapter:
    mode = "mock"
    ready = True
    model_loaded = False
    model_version = "mock-v0"
    error_code = None

    def predict(self, processed):
        model_input(processed)
        prediction, probabilities = map_probabilities([0.02, 0.07, 0.81, 0.08, 0.02], CLASSES)
        return {"success": True, "isMock": True, "prediction": prediction,
                "probabilities": probabilities, "riskLevel": "MEDIUM", "modelVersion": self.model_version}


class TensorFlowModelAdapter:
    mode = "model"

    def __init__(self, model_path, model_version=None, model_class_names=None):
        self.ready = False
        self.model_loaded = False
        self.error_code = "MODEL_NOT_READY"
        self.model_version = None
        self.model = None
        self.lock = Lock()
        self.model_path = Path(model_path).expanduser().resolve()
        self.model_class_names = tuple(model_class_names or DEFAULT_MODEL_CLASSES)
        canonical = [canonical_label(name) for name in self.model_class_names]
        if len(canonical) != 5 or set(canonical) != set(CLASSES):
            raise ValueError("MODEL_CLASS_NAMES must contain each API class exactly once")
        if not self.model_path.is_file():
            return
        try:
            self.model = _load_model(str(self.model_path))
            if tuple(self.model.input_shape) != (None, 300, 300, 3):
                raise ValueError(f"Unexpected model input shape: {self.model.input_shape}")
            if tuple(self.model.output_shape) != (None, 5):
                raise ValueError(f"Unexpected model output shape: {self.model.output_shape}")
            self.model_version = model_version or self.model_path.stem
            self.ready = True
            self.model_loaded = True
            self.error_code = None
        except Exception:
            self.model = None
            self.error_code = "MODEL_LOAD_FAILED"

    def predict(self, processed):
        if not self.ready or self.model is None:
            raise ModelNotReadyError(self.error_code)
        batch = model_input(processed)
        with self.lock:
            output = self.model(batch, training=False)
        values = np.asarray(output, dtype=np.float64).reshape(-1).tolist()
        prediction, probabilities = map_probabilities(values, self.model_class_names)
        return {"success": True, "isMock": False, "prediction": prediction,
                "probabilities": probabilities, "riskLevel": _risk_level(prediction["class"]),
                "modelVersion": self.model_version}


def create_adapter(mode, model_path=None, model_version=None, model_class_names=None):
    if mode == "mock":
        return MockAdapter()
    if mode == "model":
        path = model_path or os.getenv("MODEL_PATH", "models/fundus_b3_ordinal.keras")
        version = model_version or os.getenv("MODEL_VERSION")
        names = model_class_names
        if names is None:
            configured = os.getenv("MODEL_CLASS_NAMES")
            names = tuple(part.strip() for part in configured.split(",")) if configured else DEFAULT_MODEL_CLASSES
        return TensorFlowModelAdapter(path, version, names)
    raise ValueError("AI_MODE must be mock or model")
