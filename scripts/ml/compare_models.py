"""Compare legacy and new checkpoints on the same deduplicated held-out test set."""

import json
from pathlib import Path

import numpy as np
import tensorflow as tf
from PIL import Image

from train_fundus_baseline import CLASSES, OUT, ROOT, metrics


MODELS = [
    "best_efficientnetb3.keras",
    "final_efficientnetb3_dr.keras",
    "fundus_b3_frozen_baseline.keras",
    "fundus_b3_regularized.keras",
]


def main():
    split = json.loads((OUT / "baseline_split.json").read_text(encoding="utf-8"))["files"]
    paths = [ROOT / path for path in split["test"]]
    labels = np.array([CLASSES.index(path.parent.name) for path in paths])
    # Reconstruct the legacy script's seeded 80/20 split. Most images in the
    # new test set belonged to the legacy training partition, so legacy scores
    # below are diagnostic rather than a clean out-of-sample comparison.
    all_paths = [p for name in CLASSES for p in sorted((ROOT / "preprocessed_images" / name).glob("*.png"))]
    legacy_rng = np.random.RandomState(42)
    legacy_rng.shuffle(all_paths)
    legacy_validation = {str(path.relative_to(ROOT)) for path in all_paths[-int(0.2 * len(all_paths)): ]}
    new_test = set(split["test"])
    overlap = len(new_test & legacy_validation)
    report = {
        "dataset": "deduplicated held-out test for new models",
        "images": len(paths),
        "class_order": CLASSES,
        "legacy_comparison_warning": (
            f"Only {overlap} test images were outside the legacy training partition; "
            f"the other {len(paths) - overlap} likely appeared in legacy training."
        ),
        "models": {},
    }

    for filename in MODELS:
        model = tf.keras.models.load_model(OUT / filename, compile=False)
        probabilities = []
        for start in range(0, len(paths), 16):
            batch = np.stack([
                np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
                for path in paths[start:start + 16]
            ])
            probabilities.append(model(batch, training=False).numpy())
        result = metrics(labels, np.concatenate(probabilities))
        report["models"][filename] = result
        print(filename, {key: round(result[key], 4) for key in ("accuracy", "macro_f1", "quadratic_kappa")}, flush=True)

    output = OUT / "model_comparison_same_test.json"
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("Saved", output)


if __name__ == "__main__":
    main()
