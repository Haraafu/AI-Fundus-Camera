"""Evaluate the existing checkpoints on the original seeded validation split.

This split was used for checkpoint selection during earlier training, so its
metrics are diagnostic and are not an independent test estimate.
"""

import json
from pathlib import Path

import numpy as np
import tensorflow as tf
from PIL import Image
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, cohen_kappa_score


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "preprocessed_images"
MODEL_DIR = ROOT / "models"
CLASSES = ["Mild", "Moderate", "No_DR", "Proliferate_DR", "Severe"]
SEVERITY = np.array([1, 2, 0, 4, 3])


def main():
    tf.keras.utils.set_random_seed(42)
    paths = [p for name in CLASSES for p in sorted((DATA / name).glob("*.png"))]
    rng = np.random.RandomState(42)
    rng.shuffle(paths)
    paths = paths[-int(0.2 * len(paths)):]
    labels = np.array([CLASSES.index(p.parent.name) for p in paths])
    report = {"note": "Original validation split; not an independent test set", "class_order": CLASSES}
    for filename in ("best_efficientnetb3.keras", "final_efficientnetb3_dr.keras"):
        model = tf.keras.models.load_model(MODEL_DIR / filename, compile=False)
        outputs = []
        for start in range(0, len(paths), 16):
            batch = np.stack([np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) for p in paths[start:start + 16]])
            outputs.append(model(batch, training=False).numpy())
            if start % 160 == 0:
                print(filename, f"{start}/{len(paths)}", flush=True)
        probabilities = np.concatenate(outputs)
        predictions = probabilities.argmax(axis=1)
        result = {
            "accuracy": accuracy_score(labels, predictions),
            "quadratic_kappa": cohen_kappa_score(SEVERITY[labels], SEVERITY[predictions], weights="quadratic"),
            "classification_report": classification_report(labels, predictions, target_names=CLASSES, output_dict=True, zero_division=0),
            "confusion_matrix": confusion_matrix(labels, predictions).tolist(),
        }
        report[filename] = result
        print(filename, "accuracy", result["accuracy"], "macro_f1", result["classification_report"]["macro avg"]["f1-score"], "qwk", result["quadratic_kappa"], flush=True)
    path = MODEL_DIR / "existing_model_validation.json"
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("Saved", path)


if __name__ == "__main__":
    main()
