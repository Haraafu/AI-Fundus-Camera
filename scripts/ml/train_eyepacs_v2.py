"""Improved EyePACS training. Select on validation macro F1, evaluate test once."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import accuracy_score, classification_report, cohen_kappa_score, confusion_matrix
from train_eyepacs import ROOT, CLASS_NAMES, GRADE_TO_CLASS, CLASS_TO_GRADE, SEED, dataset, build_model


def metrics(truth, probabilities):
    predicted = np.asarray(probabilities).argmax(axis=1)
    report = classification_report(truth, predicted, labels=range(5), target_names=CLASS_NAMES,
                                   output_dict=True, zero_division=0)
    matrix = confusion_matrix(truth, predicted, labels=range(5))
    support = matrix.sum(axis=1, keepdims=True)
    normalized = np.divide(matrix, support, out=np.zeros_like(matrix, dtype=float), where=support != 0)
    values = {"accuracy": float(accuracy_score(truth, predicted)),
              "macro_precision": float(report["macro avg"]["precision"]),
              "macro_recall": float(report["macro avg"]["recall"]),
              "macro_f1": float(report["macro avg"]["f1-score"])}
    return {**values,
            "quadratic_kappa": float(cohen_kappa_score(CLASS_TO_GRADE[np.asarray(truth)], CLASS_TO_GRADE[predicted], weights="quadratic")),
            "classification_report": report, "confusion_matrix": matrix.tolist(),
            "confusion_matrix_row_normalized": normalized.tolist(),
            "target_above_90_macro": all(value > .90 for value in values.values()),
            "target_above_90_every_class": all(report[name][key] > .90 for name in CLASS_NAMES
                                                for key in ("precision", "recall", "f1-score"))}


def validate_frames(frames):
    for name, frame in frames.items():
        if frame.empty or frame[["path", "image", "patient", "level"]].isnull().any().any():
            raise ValueError(f"Empty or invalid {name} manifest")
        if frame.image.duplicated().any() or not frame.level.isin(range(5)).all():
            raise ValueError(f"Invalid image IDs or labels in {name}")
        if set(frame.level) != set(range(5)):
            raise ValueError(f"All five grades required in {name}")
    for left, right in (("train", "validation"), ("train", "test"), ("validation", "test")):
        for field in ("patient", "image"):
            if set(frames[left][field].astype(str)) & set(frames[right][field].astype(str)):
                raise ValueError(f"{field} leakage between {left} and {right}")


def sampling_weights(frame, balance):
    counts = frame.level.value_counts().reindex(range(5), fill_value=0).to_numpy(dtype=float)
    if np.any(counts == 0):
        raise ValueError("All five grades required for balanced sampling")
    # Mix natural prevalence and uniform sampling, without extra class weights.
    return ((1 - balance) * counts / counts.sum() + balance / 5).tolist()


def training_dataset(frame, batch_size, balance):
    subsets = []
    for grade in range(5):
        part = frame[frame.level == grade]
        subsets.append(dataset(part, batch_size, True).unbatch().repeat())
    stream = tf.data.Dataset.sample_from_datasets(subsets, weights=sampling_weights(frame, balance), seed=SEED)
    return stream.batch(batch_size).prefetch(tf.data.AUTOTUNE)


class ValidationScore(tf.keras.callbacks.Callback):
    """One owner for the best checkpoint across both fit phases."""
    def __init__(self, frame, batch_size, checkpoint):
        super().__init__()
        self.data = dataset(frame, batch_size, False)
        self.truth = GRADE_TO_CLASS[frame.level.to_numpy(dtype=np.int32)]
        self.checkpoint = Path(checkpoint)
        self.best = -1.0

    def on_epoch_end(self, epoch, logs=None):
        values = metrics(self.truth, self.model.predict(self.data, verbose=0))
        for key in ("macro_f1", "macro_precision", "macro_recall", "quadratic_kappa"):
            logs[f"val_{key}"] = values[key]
        print(f"Validation macro F1={values['macro_f1']:.4f}, macro recall={values['macro_recall']:.4f}", flush=True)
        if values["macro_f1"] > self.best:
            self.best = values["macro_f1"]
            self.model.save(self.checkpoint)


def train(frames, output, batch_size=16, head_epochs=8, fine_tune_epochs=20, balance=.5, weights="imagenet"):
    validate_frames(frames)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    checkpoint = output / "best.keras"
    if checkpoint.exists():
        raise ValueError("Use a new output directory to preserve previous experiments")
    tf.keras.utils.set_random_seed(SEED)
    if tf.config.list_physical_devices("GPU"):
        tf.keras.mixed_precision.set_global_policy("mixed_float16")
    model, backbone = build_model(weights=weights)
    stream = training_dataset(frames["train"], batch_size, balance)
    validation = dataset(frames["validation"], batch_size, False)
    steps = math.ceil(len(frames["train"]) / batch_size)
    scorer = ValidationScore(frames["validation"], batch_size, checkpoint)

    def callbacks(phase):
        # Score callback precedes callbacks consuming its log values.
        return [scorer,
                tf.keras.callbacks.EarlyStopping(monitor="val_macro_f1", mode="max", patience=5),
                tf.keras.callbacks.ReduceLROnPlateau(monitor="val_macro_f1", mode="max", factor=.5, patience=2, min_lr=1e-7),
                tf.keras.callbacks.CSVLogger(output / f"history-{phase}.csv"),
                tf.keras.callbacks.TerminateOnNaN()]

    model.compile(optimizer=tf.keras.optimizers.Adam(3e-4), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    model.fit(stream, steps_per_epoch=steps, validation_data=validation, epochs=head_epochs, callbacks=callbacks("head"))
    # Load best head weights before fine tuning, retaining the same backbone object.
    model.load_weights(checkpoint)
    if fine_tune_epochs:
        backbone.trainable = True
        for layer in backbone.layers:
            layer.trainable = layer in backbone.layers[-120:] and not isinstance(layer, tf.keras.layers.BatchNormalization)
        model.compile(optimizer=tf.keras.optimizers.Adam(1e-5), loss="sparse_categorical_crossentropy", metrics=["accuracy"])
        model.fit(stream, steps_per_epoch=steps, validation_data=validation, epochs=fine_tune_epochs, callbacks=callbacks("finetune"))
    best = tf.keras.models.load_model(checkpoint)
    results = {}
    for name, frame in frames.items():
        probabilities = best.predict(dataset(frame, batch_size, False), verbose=1)
        truth = GRADE_TO_CLASS[frame.level.to_numpy(dtype=np.int32)]
        results[name] = metrics(truth, probabilities)
        np.savez_compressed(output / f"predictions-{name}.npz", image=frame.image.astype(str).to_numpy(dtype=str),
                            patient=frame.patient.astype(str).to_numpy(dtype=str), truth=truth, probabilities=probabilities)
    report = {"experiment": "eyepacs-b3-balanced-v2", "seed": SEED, "class_names": CLASS_NAMES,
              "grade_to_class_index": GRADE_TO_CLASS.tolist(), "selection_metric": "validation macro F1",
              "balance_mix": balance, "head_epochs_max": head_epochs, "fine_tune_epochs_max": fine_tune_epochs,
              "split_sizes": {name: len(frame) for name, frame in frames.items()},
              "patient_counts": {name: int(frame.patient.nunique()) for name, frame in frames.items()},
              "split_id_sha256": {name: hashlib.sha256('\n'.join(sorted(frame.image.astype(str))).encode()).hexdigest() for name, frame in frames.items()},
              "tensorflow": tf.__version__, "gpu": [d.name for d in tf.config.list_physical_devices("GPU")],
              "test_policy": "Historical test has been inspected. Retained for benchmark continuity, not a fresh external validation set.",
              "metrics": results}
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({name: {k: v for k, v in value.items() if k.startswith('macro_') or k in ('accuracy', 'target_above_90_macro', 'target_above_90_every_class')} for name, value in results.items()}, indent=2))
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data', type=Path, default=ROOT / 'data/eyepacs/processed')
    parser.add_argument('--output', type=Path, default=ROOT / 'models/eyepacs_b3_v2')
    parser.add_argument('--batch-size', type=int, default=16)
    parser.add_argument('--head-epochs', type=int, default=8)
    parser.add_argument('--fine-tune-epochs', type=int, default=20)
    parser.add_argument('--balance', type=float, default=.5)
    args = parser.parse_args()
    if not 0 <= args.balance <= 1 or args.batch_size < 1 or args.head_epochs < 1 or args.fine_tune_epochs < 0:
        parser.error('Invalid training settings')
    frames = {name: pd.read_csv(args.data / f'{name}.csv', dtype={'patient': str, 'image': str}) for name in ('train','validation','test')}
    train(frames, args.output, args.batch_size, args.head_epochs, args.fine_tune_epochs, args.balance)


if __name__ == '__main__':
    main()
