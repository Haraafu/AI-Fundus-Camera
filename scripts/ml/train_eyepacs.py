"""Train an EyePACS EfficientNetB3 model with patient-level splits."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import accuracy_score, classification_report, cohen_kappa_score, confusion_matrix

ROOT = Path(__file__).resolve().parents[2]
CLASS_NAMES = ["Mild", "Moderate", "No_DR", "Proliferate_DR", "Severe"]
GRADE_TO_CLASS = np.array([2, 0, 1, 4, 3], dtype=np.int32)
CLASS_TO_GRADE = np.array([1, 2, 0, 4, 3], dtype=np.int32)
SEED = 20261003


def dataset(frame, batch_size, training):
    paths = frame.path.astype(str).to_numpy()
    labels = GRADE_TO_CLASS[frame["level"].to_numpy(dtype=np.int32)]
    data = tf.data.Dataset.from_tensor_slices((paths, labels))
    if training:
        data = data.shuffle(len(frame), seed=SEED, reshuffle_each_iteration=True)

    def load(path, label):
        image = tf.io.decode_jpeg(tf.io.read_file(path), channels=3)
        image = tf.ensure_shape(image, (300, 300, 3))
        return tf.cast(image, tf.float32), label

    options = tf.data.Options()
    options.experimental_deterministic = not training
    return data.map(load, num_parallel_calls=tf.data.AUTOTUNE).batch(batch_size).prefetch(tf.data.AUTOTUNE).with_options(options)


def build_model():
    augmentation = tf.keras.Sequential(
        [
            tf.keras.layers.RandomFlip("horizontal"),
            tf.keras.layers.RandomRotation(0.04, fill_mode="reflect"),
            tf.keras.layers.RandomZoom(0.08, fill_mode="reflect"),
            tf.keras.layers.RandomContrast(0.10),
        ],
        name="augmentation",
    )
    backbone = tf.keras.applications.EfficientNetB3(
        include_top=False, weights="imagenet", pooling="avg", input_shape=(300, 300, 3)
    )
    backbone.trainable = False
    inputs = tf.keras.Input((300, 300, 3), name="fundus_image")
    features = backbone(augmentation(inputs), training=False)
    features = tf.keras.layers.Dropout(0.4)(features)
    outputs = tf.keras.layers.Dense(5, activation="softmax", dtype="float32", name="classification_output")(features)
    return tf.keras.Model(inputs, outputs), backbone


def evaluate(model, frame, batch_size):
    probabilities = model.predict(dataset(frame, batch_size, False), verbose=1)
    truth = GRADE_TO_CLASS[frame["level"].to_numpy(dtype=np.int32)]
    predicted = probabilities.argmax(axis=1)
    truth_grade = CLASS_TO_GRADE[truth]
    predicted_grade = CLASS_TO_GRADE[predicted]
    return {
        "accuracy": float(accuracy_score(truth, predicted)),
        "macro_f1": float(classification_report(truth, predicted, output_dict=True, zero_division=0)["macro avg"]["f1-score"]),
        "quadratic_kappa": float(cohen_kappa_score(truth_grade, predicted_grade, weights="quadratic")),
        "classification_report": classification_report(truth, predicted, labels=range(5), target_names=CLASS_NAMES, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(truth, predicted, labels=range(5)).tolist(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "data" / "eyepacs" / "processed")
    parser.add_argument("--output", type=Path, default=ROOT / "models" / "eyepacs_b3")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--head-epochs", type=int, default=12)
    parser.add_argument("--fine-tune-epochs", type=int, default=10)
    parser.add_argument("--skip-fine-tune", action="store_true", help="Useful for a CPU pilot run")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    tf.keras.utils.set_random_seed(SEED)
    if tf.config.list_physical_devices("GPU"):
        tf.keras.mixed_precision.set_global_policy("mixed_float16")
    frames = {name: pd.read_csv(args.data / f"{name}.csv") for name in ("train", "validation", "test")}
    for left, right in (("train", "validation"), ("train", "test"), ("validation", "test")):
        if set(frames[left].patient.astype(str)) & set(frames[right].patient.astype(str)):
            raise ValueError(f"Patient leakage between {left} and {right}")

    counts = np.bincount(GRADE_TO_CLASS[frames["train"]["level"].to_numpy(dtype=np.int32)], minlength=5)
    class_weight = {
        index: float(np.sqrt(len(frames["train"]) / (5 * count)))
        for index, count in enumerate(counts)
        if count > 0
    }
    model, backbone = build_model()
    checkpoint = args.output / "best.keras"
    callbacks = [
        tf.keras.callbacks.ModelCheckpoint(checkpoint, monitor="val_loss", save_best_only=True),
        tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=4, restore_best_weights=True),
        tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", factor=0.3, patience=2, min_lr=1e-7),
        tf.keras.callbacks.CSVLogger(args.output / "history.csv", append=True),
    ]
    model.compile(optimizer=tf.keras.optimizers.Adam(3e-4), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    model.fit(
        dataset(frames["train"], args.batch_size, True),
        validation_data=dataset(frames["validation"], args.batch_size, False),
        epochs=args.head_epochs,
        class_weight=class_weight,
        callbacks=callbacks,
    )

    if not args.skip_fine_tune:
        backbone.trainable = True
        for layer in backbone.layers[:-60]:
            layer.trainable = False
        model.compile(optimizer=tf.keras.optimizers.Adam(1e-5), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
        model.fit(
            dataset(frames["train"], args.batch_size, True),
            validation_data=dataset(frames["validation"], args.batch_size, False),
            initial_epoch=args.head_epochs,
            epochs=args.head_epochs + args.fine_tune_epochs,
            class_weight=class_weight,
            callbacks=callbacks,
        )

    best = tf.keras.models.load_model(checkpoint)
    results = {name: evaluate(best, frame, args.batch_size) for name, frame in frames.items()}
    report = {
        "class_names": CLASS_NAMES,
        "grade_to_class_index": GRADE_TO_CLASS.tolist(),
        "seed": SEED,
        "split_sizes": {name: len(frame) for name, frame in frames.items()},
        "patient_counts": {name: int(frame.patient.nunique()) for name, frame in frames.items()},
        "tensorflow": tf.__version__,
        "gpu": [device.name for device in tf.config.list_physical_devices("GPU")],
        "metrics": results,
    }
    (args.output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({name: {key: value for key, value in result.items() if key in ("accuracy", "macro_f1", "quadratic_kappa")} for name, result in results.items()}, indent=2))
    print("Saved", checkpoint)


if __name__ == "__main__":
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "1")
    main()
