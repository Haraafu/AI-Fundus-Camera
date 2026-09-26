"""Fit a strongly regularized linear head on cached ImageNet features.

Uses the deduplicated split made by train_fundus_baseline.py. Selects the
regularization strength on validation data, then evaluates the test split once.
"""

import json
from pathlib import Path

import numpy as np
import tensorflow as tf
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from train_fundus_baseline import CLASSES, DATA, OUT, ROOT, SEED, metrics


def main():
    tf.keras.utils.set_random_seed(SEED)
    paths = [p for name in CLASSES for p in sorted((DATA / name).glob("*.png"))]
    labels = np.array([CLASSES.index(p.parent.name) for p in paths])
    lookup = {str(p.relative_to(ROOT)): i for i, p in enumerate(paths)}
    split = json.loads((OUT / "baseline_split.json").read_text(encoding="utf-8"))["files"]
    ids = {name: np.array([lookup[p] for p in files]) for name, files in split.items()}
    with np.load(OUT / "imagenet_b3_embeddings.npz") as saved:
        if saved["paths"].tolist() != [str(p) for p in paths]:
            raise ValueError("Cached feature paths do not match current images")
        features = saved["features"]
    scaler = StandardScaler().fit(features[ids["train"]])
    x = {name: scaler.transform(features[index]) for name, index in ids.items()}
    y = {name: labels[index] for name, index in ids.items()}
    counts = np.bincount(y["train"], minlength=5)
    weights = np.sqrt(len(y["train"]) / (5 * counts))[y["train"]]
    trials = []
    best = None
    for c in (1e-5, 3e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2):
        model = LogisticRegression(C=c, max_iter=500, solver="lbfgs")
        model.fit(x["train"], y["train"], sample_weight=weights)
        train_result = metrics(y["train"], model.predict_proba(x["train"]))
        val_result = metrics(y["validation"], model.predict_proba(x["validation"]))
        trial = {"C": c, "train": train_result, "validation": val_result}
        trials.append(trial)
        print(f"C={c:g} train macro F1={train_result['macro_f1']:.3f} validation macro F1={val_result['macro_f1']:.3f}", flush=True)
        if best is None or val_result["macro_f1"] > best[0]:
            best = (val_result["macro_f1"], model, trial)

    _, selected, chosen = best
    test_result = metrics(y["test"], selected.predict_proba(x["test"]))
    print("Selected C", chosen["C"], "test", {k: test_result[k] for k in ("accuracy", "macro_f1", "quadratic_kappa")}, flush=True)
    backbone = tf.keras.applications.EfficientNetB3(include_top=False, pooling="avg", weights="imagenet", input_shape=(300, 300, 3))
    backbone.trainable = False
    normalization = tf.keras.layers.Normalization(mean=scaler.mean_.astype("float32"), variance=scaler.var_.astype("float32"))
    classifier = tf.keras.layers.Dense(5, activation="softmax")
    inp = tf.keras.Input((300, 300, 3))
    output = classifier(normalization(backbone(inp, training=False)))
    full_model = tf.keras.Model(inp, output)
    classifier.set_weights([selected.coef_.T.astype("float32"), selected.intercept_.astype("float32")])
    path = OUT / "fundus_b3_regularized.keras"
    full_model.save(path)
    report = {"class_order": CLASSES, "selection_metric": "validation macro F1", "chosen_C": chosen["C"],
              "trials": trials, "test": test_result, "model_path": str(path)}
    (OUT / "fundus_b3_regularized_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    # Confirm the saved Keras model reproduces the chosen sklearn head.
    image = np.asarray(__import__("PIL.Image", fromlist=["Image"]).open(paths[ids["test"][0]]).convert("RGB"), dtype=np.float32)[None]
    keras_prediction = full_model(image, training=False).numpy()[0]
    sklearn_prediction = selected.predict_proba(x["test"][:1])[0]
    if not np.allclose(keras_prediction, sklearn_prediction, atol=1e-4):
        raise AssertionError("Saved Keras model does not reproduce selected classifier")
    print("Saved", path, flush=True)


if __name__ == "__main__":
    main()
