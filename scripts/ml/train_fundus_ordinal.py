"""Train an ordinal DR classifier on cached EfficientNetB3 embeddings.

The model learns four cumulative decisions (grade > 0, ..., grade > 3),
which reflects the clinical ordering of diabetic-retinopathy grades.
"""

import json
from pathlib import Path

import joblib
import numpy as np
import tensorflow as tf
from PIL import Image
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from train_fundus_baseline import CLASSES, DATA, OUT, ROOT, SEED, SEVERITY, metrics


def ordinal_probabilities(models, features):
    cumulative = np.column_stack([model.predict_proba(features)[:, 1] for model in models])
    cumulative = np.minimum.accumulate(cumulative, axis=1)
    severity_probabilities = np.column_stack(
        [
            1.0 - cumulative[:, 0],
            cumulative[:, 0] - cumulative[:, 1],
            cumulative[:, 1] - cumulative[:, 2],
            cumulative[:, 2] - cumulative[:, 3],
            cumulative[:, 3],
        ]
    )
    # Convert severity order [No_DR, Mild, Moderate, Severe, PDR] to CLASSES.
    return severity_probabilities[:, [1, 2, 0, 4, 3]]


def fit_models(features, grades, c):
    models = []
    for threshold in range(4):
        target = (grades > threshold).astype("int32")
        counts = np.bincount(target, minlength=2)
        weights = np.sqrt(len(target) / (2 * counts))[target]
        model = LogisticRegression(C=c, max_iter=600, solver="lbfgs")
        model.fit(features, target, sample_weight=weights)
        models.append(model)
    return models


def export_keras(models, scaler, path):
    backbone = tf.keras.applications.EfficientNetB3(
        include_top=False, pooling="avg", weights="imagenet", input_shape=(300, 300, 3)
    )
    backbone.trainable = False
    normalizer = tf.keras.layers.Normalization(
        mean=scaler.mean_.astype("float32"), variance=scaler.var_.astype("float32")
    )
    image_input = tf.keras.Input((300, 300, 3), name="fundus_image")
    features = normalizer(backbone(image_input, training=False))
    raw = [tf.keras.layers.Dense(1, activation="sigmoid", name=f"grade_gt_{i}")(features) for i in range(4)]
    cumulative = [raw[0]]
    for value in raw[1:]:
        cumulative.append(tf.keras.layers.Minimum()([cumulative[-1], value]))
    severity = [
        tf.keras.layers.Rescaling(-1.0, offset=1.0)(cumulative[0]),
        tf.keras.layers.Subtract()([cumulative[0], cumulative[1]]),
        tf.keras.layers.Subtract()([cumulative[1], cumulative[2]]),
        tf.keras.layers.Subtract()([cumulative[2], cumulative[3]]),
        cumulative[3],
    ]
    output = tf.keras.layers.Concatenate(name="classification_output")(
        [severity[1], severity[2], severity[0], severity[4], severity[3]]
    )
    keras_model = tf.keras.Model(image_input, output)
    for index, model in enumerate(models):
        keras_model.get_layer(f"grade_gt_{index}").set_weights(
            [model.coef_.T.astype("float32"), model.intercept_.astype("float32")]
        )
    keras_model.save(path)
    return keras_model


def main():
    tf.keras.utils.set_random_seed(SEED)
    paths = [path for name in CLASSES for path in sorted((DATA / name).glob("*.png"))]
    labels = np.array([CLASSES.index(path.parent.name) for path in paths])
    grades = SEVERITY[labels]
    lookup = {str(path.relative_to(ROOT)): index for index, path in enumerate(paths)}
    split = json.loads((OUT / "baseline_split.json").read_text(encoding="utf-8"))["files"]
    indices = {name: np.array([lookup[path] for path in files]) for name, files in split.items()}
    with np.load(OUT / "imagenet_b3_embeddings.npz") as saved:
        if saved["paths"].tolist() != [str(path) for path in paths]:
            raise ValueError("Cached embeddings do not match current images")
        embeddings = saved["features"]

    scaler = StandardScaler().fit(embeddings[indices["train"]])
    features = {name: scaler.transform(embeddings[index]) for name, index in indices.items()}
    split_labels = {name: labels[index] for name, index in indices.items()}
    split_grades = {name: grades[index] for name, index in indices.items()}

    trials = []
    selected = None
    for c in (3e-5, 1e-4, 3e-4, 1e-3, 3e-3, 1e-2):
        models = fit_models(features["train"], split_grades["train"], c)
        train_result = metrics(split_labels["train"], ordinal_probabilities(models, features["train"]))
        validation_result = metrics(
            split_labels["validation"], ordinal_probabilities(models, features["validation"])
        )
        trial = {"C": c, "train": train_result, "validation": validation_result}
        trials.append(trial)
        score = (validation_result["macro_f1"], validation_result["quadratic_kappa"])
        print(
            f"C={c:g} train F1={train_result['macro_f1']:.3f} "
            f"validation F1={validation_result['macro_f1']:.3f} QWK={validation_result['quadratic_kappa']:.3f}",
            flush=True,
        )
        if selected is None or score > selected[0]:
            selected = (score, models, trial)

    _, models, chosen = selected
    test_result = metrics(split_labels["test"], ordinal_probabilities(models, features["test"]))
    print("Held-out test:", {key: test_result[key] for key in ("accuracy", "macro_f1", "quadratic_kappa")})

    keras_path = OUT / "fundus_b3_ordinal.keras"
    keras_model = export_keras(models, scaler, keras_path)
    joblib.dump({"models": models, "scaler": scaler, "class_order": CLASSES}, OUT / "fundus_b3_ordinal.joblib")
    sample = np.asarray(Image.open(paths[indices["test"][0]]).convert("RGB"), dtype=np.float32)[None]
    expected = ordinal_probabilities(models, features["test"][:1])[0]
    actual = keras_model(sample, training=False).numpy()[0]
    if not np.allclose(expected, actual, atol=1e-4):
        raise AssertionError("Keras export does not reproduce the ordinal classifier")
    report = {
        "class_order": CLASSES,
        "method": "four cumulative logistic models on frozen EfficientNetB3 embeddings",
        "selection_metric": "validation macro F1, then quadratic weighted kappa",
        "chosen_C": chosen["C"],
        "trials": trials,
        "test": test_result,
        "model_path": str(keras_path),
    }
    (OUT / "fundus_b3_ordinal_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("Saved", keras_path)


if __name__ == "__main__":
    main()
