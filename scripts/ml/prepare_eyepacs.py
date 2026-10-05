"""Prepare EyePACS directly from Kaggle's numbered ZIP parts.

The script crops black borders, applies the application's CLAHE pipeline, writes
300x300 JPEG files, and creates patient-level train/validation/test manifests.
It never materializes the 35 GiB uncompressed source archive.
"""

from __future__ import annotations

import argparse
import csv
import io
import random
import sys
import zipfile
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from fundus.preprocessing import preprocess_bytes  # noqa: E402
from inspect_split_zip import SplitFile, numbered_parts  # noqa: E402

SEED = 20261003


def patient_id(image_id: str) -> str:
    return image_id.rsplit("_", 1)[0]


def split_patients(labels: pd.DataFrame, seed: int):
    patients = labels.assign(patient=labels.image.map(patient_id)).groupby("patient")["level"].max()
    train_patients, remainder = train_test_split(
        patients.index, test_size=0.30, random_state=seed, stratify=patients.values
    )
    remainder_levels = patients.loc[remainder]
    validation_patients, test_patients = train_test_split(
        remainder, test_size=0.50, random_state=seed, stratify=remainder_levels.values
    )
    groups = {
        "train": set(train_patients),
        "validation": set(validation_patients),
        "test": set(test_patients),
    }
    overlap = (groups["train"] & groups["validation"]) | (groups["train"] & groups["test"]) | (
        groups["validation"] & groups["test"]
    )
    if overlap:
        raise AssertionError("Patient leakage detected")
    return groups


def choose_pilot(labels: pd.DataFrame, groups, patients_per_split: int, seed: int):
    if not patients_per_split:
        return groups
    patient_levels = labels.assign(patient=labels.image.map(patient_id)).groupby("patient")["level"].max()
    selected = {}
    for index, (name, members) in enumerate(groups.items()):
        frame = patient_levels.loc[sorted(members)]
        count = min(patients_per_split, len(frame))
        if count == len(frame):
            selected[name] = set(frame.index)
            continue
        chosen, _ = train_test_split(
            frame.index, train_size=count, random_state=seed + index, stratify=frame.values
        )
        selected[name] = set(chosen)
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=ROOT / "data" / "eyepacs")
    parser.add_argument("--output", type=Path, default=ROOT / "data" / "eyepacs" / "processed")
    parser.add_argument("--pilot-patients", type=int, default=0, help="Patients per split; 0 prepares all data")
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.source / "trainLabels.csv.zip") as archive:
        with archive.open("trainLabels.csv") as handle:
            labels = pd.read_csv(handle, dtype={"image": str, "level": np.int8})
    if labels.image.duplicated().any() or not set(labels["level"]).issubset(range(5)):
        raise ValueError("Unexpected EyePACS label file")

    groups = choose_pilot(labels, split_patients(labels, args.seed), args.pilot_patients, args.seed)
    image_to_split = {
        row.image: split_name
        for row in labels.itertuples()
        for split_name, patients in groups.items()
        if patient_id(row.image) in patients
    }
    wanted = set(image_to_split)
    label_lookup = dict(zip(labels.image, labels["level"]))
    rows = {name: [] for name in groups}
    failures = []

    stream = SplitFile(numbered_parts(args.source / "train.zip.001"))
    with zipfile.ZipFile(stream) as archive:
        members = {Path(info.filename).stem: info for info in archive.infolist() if not info.is_dir()}
        missing = wanted - members.keys()
        if missing:
            raise ValueError(f"Archive is missing {len(missing)} labelled images")
        for number, image_id in enumerate(sorted(wanted), start=1):
            split_name = image_to_split[image_id]
            destination = args.output / split_name / f"{image_id}.jpg"
            destination.parent.mkdir(parents=True, exist_ok=True)
            try:
                if not destination.exists():
                    processed = preprocess_bytes(archive.read(members[image_id]))
                    ok, encoded = cv2.imencode(".jpg", cv2.cvtColor(processed, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 95])
                    if not ok:
                        raise ValueError("JPEG encoding failed")
                    destination.write_bytes(encoded.tobytes())
                rows[split_name].append(
                    {"path": str(destination.resolve()), "image": image_id, "patient": patient_id(image_id), "level": label_lookup[image_id]}
                )
            except Exception as exc:  # continue to report every damaged image
                failures.append({"image": image_id, "error": repr(exc)})
            if number % 250 == 0 or number == len(wanted):
                print(f"Prepared {number:,}/{len(wanted):,} images", flush=True)

    for split_name, split_rows in rows.items():
        manifest = args.output / f"{split_name}.csv"
        with manifest.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=["path", "image", "patient", "level"])
            writer.writeheader()
            writer.writerows(split_rows)
        print(split_name, len(split_rows), dict(sorted(Counter(r["level"] for r in split_rows).items())))
    if failures:
        pd.DataFrame(failures).to_csv(args.output / "failures.csv", index=False)
        raise SystemExit(f"Failed to prepare {len(failures)} images; see failures.csv")
    print("EyePACS preparation complete:", args.output)


if __name__ == "__main__":
    main()
