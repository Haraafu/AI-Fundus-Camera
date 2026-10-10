"""Self-contained EyePACS EfficientNetB3 training job for Kaggle GPU."""

from __future__ import annotations

import bisect
import csv
import io
import json
import os
import zipfile
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
import tensorflow as tf
from sklearn.metrics import accuracy_score, classification_report, cohen_kappa_score, confusion_matrix
from sklearn.model_selection import train_test_split

INPUT_ROOT = Path("/kaggle/input")
PROCESSED = Path("/kaggle/working/processed")
OUTPUT = Path("/kaggle/working/eyepacs_b3")
SEED = 20261003
CLASS_NAMES = ["Mild", "Moderate", "No_DR", "Proliferate_DR", "Severe"]
GRADE_TO_CLASS = np.array([2, 0, 1, 4, 3], dtype=np.int32)
CLASS_TO_GRADE = np.array([1, 2, 0, 4, 3], dtype=np.int32)


class SplitFile(io.RawIOBase):
    """Expose numbered ZIP chunks as one seekable binary stream."""

    def __init__(self, parts):
        self.parts = parts
        self.sizes = [part.stat().st_size for part in parts]
        self.starts = []
        total = 0
        for size in self.sizes:
            self.starts.append(total)
            total += size
        self.total = total
        self.position = 0
        self.handle = None
        self.handle_index = -1

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_CUR:
            offset += self.position
        elif whence == io.SEEK_END:
            offset += self.total
        if offset < 0:
            raise ValueError("negative seek")
        self.position = min(offset, self.total)
        return self.position

    def _open_part(self, index):
        if index != self.handle_index:
            if self.handle:
                self.handle.close()
            self.handle = self.parts[index].open("rb")
            self.handle_index = index

    def readinto(self, buffer):
        if self.position >= self.total:
            return 0
        target = memoryview(buffer)
        written = 0
        while written < len(target) and self.position < self.total:
            index = bisect.bisect_right(self.starts, self.position) - 1
            self._open_part(index)
            local = self.position - self.starts[index]
            self.handle.seek(local)
            count = min(len(target) - written, self.sizes[index] - local)
            got = self.handle.readinto(target[written : written + count])
            if not got:
                break
            self.position += got
            written += got
        return written

    def close(self):
        if self.handle:
            self.handle.close()
        super().close()


def patient_id(image_id):
    return image_id.rsplit("_", 1)[0]


def preprocess(content):
    image = cv2.imdecode(np.frombuffer(content, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("image decode failed")
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    mask = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY) > 10
    if mask.any():
        coordinates = np.argwhere(mask)
        y_min, x_min = coordinates.min(axis=0)
        y_max, x_max = coordinates.max(axis=0)
        image = image[y_min : y_max + 1, x_min : x_max + 1]
    image = cv2.resize(image, (300, 300), interpolation=cv2.INTER_AREA)
    luminance, a, b = cv2.split(cv2.cvtColor(image, cv2.COLOR_RGB2LAB))
    luminance = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(luminance)
    image = cv2.cvtColor(cv2.merge((luminance, a, b)), cv2.COLOR_LAB2RGB)
    return cv2.GaussianBlur(image, (3, 3), 0)


def prepare(source):
    PROCESSED.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source / "trainLabels.csv.zip") as labels_zip:
        with labels_zip.open("trainLabels.csv") as handle:
            labels = pd.read_csv(handle, dtype={"image": str, "level": np.int8})
    patients = labels.assign(patient=labels.image.map(patient_id)).groupby("patient")["level"].max()
    train_patients, remainder = train_test_split(
        patients.index, test_size=0.30, random_state=SEED, stratify=patients.values
    )
    validation_patients, test_patients = train_test_split(
        remainder, test_size=0.50, random_state=SEED, stratify=patients.loc[remainder].values
    )
    groups = {
        "train": set(train_patients),
        "validation": set(validation_patients),
        "test": set(test_patients),
    }
    image_to_split = {
        row.image: name
        for row in labels.itertuples()
        for name, patient_set in groups.items()
        if patient_id(row.image) in patient_set
    }
    label_lookup = dict(zip(labels.image, labels["level"]))
    rows = {name: [] for name in groups}
    parts = sorted(source.glob("train.zip.[0-9][0-9][0-9]"))
    if len(parts) != 5:
        raise FileNotFoundError(f"Expected five train ZIP parts, found {parts}")
    with zipfile.ZipFile(SplitFile(parts)) as archive:
        members = {Path(info.filename).stem: info for info in archive.infolist() if not info.is_dir()}
        for number, image_id in enumerate(sorted(image_to_split), 1):
            split_name = image_to_split[image_id]
            destination = PROCESSED / split_name / f"{image_id}.jpg"
            destination.parent.mkdir(parents=True, exist_ok=True)
            image = preprocess(archive.read(members[image_id]))
            ok, encoded = cv2.imencode(
                ".jpg", cv2.cvtColor(image, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95]
            )
            if not ok:
                raise ValueError(f"JPEG encoding failed for {image_id}")
            destination.write_bytes(encoded.tobytes())
            rows[split_name].append(
                {
                    "path": str(destination),
                    "image": image_id,
                    "patient": patient_id(image_id),
                    "level": int(label_lookup[image_id]),
                }
            )
            if number % 250 == 0 or number == len(image_to_split):
                print(f"Prepared {number:,}/{len(image_to_split):,}", flush=True)
    for name, split_rows in rows.items():
        with (PROCESSED / f"{name}.csv").open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=["path", "image", "patient", "level"])
            writer.writeheader()
            writer.writerows(split_rows)
        print(name, len(split_rows), dict(sorted(Counter(row["level"] for row in split_rows).items())))
    return {name: pd.DataFrame(split_rows) for name, split_rows in rows.items()}


import math
import hashlib

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


def build_model(weights="imagenet"):
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
        include_top=False, weights=weights, pooling="avg", input_shape=(300, 300, 3)
    )
    backbone.trainable = False
    inputs = tf.keras.Input((300, 300, 3), name="fundus_image")
    features = backbone(augmentation(inputs), training=False)
    features = tf.keras.layers.Dropout(0.4)(features)
    outputs = tf.keras.layers.Dense(5, activation="softmax", dtype="float32", name="classification_output")(features)
    return tf.keras.Model(inputs, outputs), backbone


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


BASELINE_BENCHMARK = {'source': 'previous EyePACS run, reviewed 10 October 2026', 'expected_split_sha256': {'train': '1153d4d392189a389061d1d0cf776a44cf96905e6042882a3ef2d5746261c82a', 'validation': 'b778a6697ae9f77c78fc70b04478769eb9655865ceb0ec01e0e21ab3d7108470', 'test': '2b6736f8563abeda94ecf6cee62b257cf1926fa10192f1c059272a7e8ba4075d'}, 'metrics': {'train': {'accuracy': 0.7641125752399545, 'macro_precision': 0.5060546760244715, 'macro_recall': 0.47608385945058995, 'macro_f1': 0.45676731564233963}, 'validation': {'accuracy': 0.7577828397873956, 'macro_precision': 0.5003910179930791, 'macro_recall': 0.45821124326951057, 'macro_f1': 0.43817448067541453}, 'test': {'accuracy': 0.7523719165085389, 'macro_precision': 0.4466568325754225, 'macro_recall': 0.4439758641804068, 'macro_f1': 0.4335812433783026}}}

def main():
    if not tf.config.list_physical_devices("GPU"):
        raise RuntimeError("GPU required for full EyePACS experiment")
    candidates = list(INPUT_ROOT.rglob("train.zip.001"))
    if len(candidates) != 1:
        raise FileNotFoundError("Expected one competition train archive")
    frames = prepare(candidates[0].parent)
    actual = {name: hashlib.sha256('\n'.join(sorted(frame.image.astype(str))).encode()).hexdigest() for name, frame in frames.items()}
    if actual != BASELINE_BENCHMARK["expected_split_sha256"]:
        raise ValueError("Split IDs differ from the previous experiment benchmark")
    output = Path("/kaggle/working/eyepacs_b3_v2")
    report = train(frames, output)
    report["comparison_to_previous_eyepacs"] = {name: {
        key: {"previous": old, "current": report["metrics"][name][key],
              "delta_percentage_points": 100 * (report["metrics"][name][key] - old)}
        for key, old in values.items()}
        for name, values in BASELINE_BENCHMARK["metrics"].items()}
    (output / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    # Remove only generated preprocessing files after successful model/report export.
    import shutil
    if PROCESSED.resolve() != Path("/kaggle/working/processed"):
        raise RuntimeError("Unexpected preprocessing cleanup directory")
    shutil.rmtree(PROCESSED)


if __name__ == "__main__":
    main()
