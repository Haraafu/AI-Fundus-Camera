"""Train a regularized EfficientNetB3 classifier with a held-out test split.

The ImageNet backbone is frozen and its embeddings are cached. This makes a
reproducible CPU training run practical; it is a baseline, not clinical validation.
"""

import json
import hashlib
from collections import defaultdict
from pathlib import Path

import numpy as np
import tensorflow as tf
from PIL import Image
from sklearn.metrics import accuracy_score, classification_report, cohen_kappa_score, confusion_matrix
from sklearn.model_selection import train_test_split


ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "preprocessed_images"
OUT = ROOT / "models"
CLASSES = ["Mild", "Moderate", "No_DR", "Proliferate_DR", "Severe"]
SEVERITY = np.array([1, 2, 0, 4, 3])
SEED = 20260926
BATCH = 16


def metrics(y, probability):
    predicted = probability.argmax(axis=1)
    return {
        "accuracy": float(accuracy_score(y, predicted)),
        "macro_f1": float(classification_report(y, predicted, output_dict=True, zero_division=0)["macro avg"]["f1-score"]),
        "quadratic_kappa": float(cohen_kappa_score(SEVERITY[y], SEVERITY[predicted], weights="quadratic")),
        "classification_report": classification_report(y, predicted, target_names=CLASSES, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(y, predicted, labels=range(5)).tolist(),
    }


def embeddings(backbone, paths, cache):
    if cache.exists():
        with np.load(cache) as saved:
            if saved["paths"].tolist() == [str(p) for p in paths]:
                return saved["features"]
    chunks = []
    for start in range(0, len(paths), BATCH):
        batch = np.stack([np.asarray(Image.open(p).convert("RGB"), dtype=np.float32) for p in paths[start:start + BATCH]])
        chunks.append(backbone(batch, training=False).numpy())
        if start % 320 == 0:
            print(f"Extracted {start}/{len(paths)} embeddings", flush=True)
    features = np.concatenate(chunks).astype("float32")
    np.savez_compressed(cache, paths=np.array([str(p) for p in paths]), features=features)
    return features


def build_head(train_features, dropout, weight_decay):
    normalizer = tf.keras.layers.Normalization()
    normalizer.adapt(train_features)
    inp = tf.keras.Input((train_features.shape[1],))
    x = normalizer(inp)
    x = tf.keras.layers.Dense(128, activation="relu", kernel_regularizer=tf.keras.regularizers.l2(weight_decay))(x)
    x = tf.keras.layers.Dropout(dropout)(x)
    output = tf.keras.layers.Dense(5, activation="softmax")(x)
    model = tf.keras.Model(inp, output)
    model.compile(optimizer=tf.keras.optimizers.Adam(2e-4), loss="sparse_categorical_crossentropy")
    return model


def main():
    OUT.mkdir(exist_ok=True)
    tf.keras.utils.set_random_seed(SEED)
    paths = [p for name in CLASSES for p in sorted((DATA / name).glob("*.png"))]
    if len(paths) != 3662:
        raise ValueError(f"Expected 3662 preprocessed images; found {len(paths)}")
    labels = np.array([CLASSES.index(p.parent.name) for p in paths])
    by_hash = defaultdict(list)
    for i, path in enumerate(paths):
        by_hash[hashlib.sha256(path.read_bytes()).hexdigest()].append(i)
    ambiguous = [ids for ids in by_hash.values() if len(set(labels[ids])) > 1]
    unique_indices = np.array([ids[0] for ids in by_hash.values() if len(set(labels[ids])) == 1])
    audit = {"raw_images": len(paths), "unique_hashes": len(by_hash),
             "duplicate_groups": sum(len(ids) > 1 for ids in by_hash.values()),
             "conflicting_label_groups_excluded": len(ambiguous),
             "images_in_conflicting_groups_excluded": sum(map(len, ambiguous)),
             "unique_consistent_images_used": len(unique_indices)}
    (OUT / "baseline_data_audit.json").write_text(json.dumps(audit, indent=2), encoding="utf-8")
    conflicts = [
        {"sha256": digest, "files": [{"path": str(paths[i].relative_to(ROOT)), "class": CLASSES[labels[i]]} for i in ids]}
        for digest, ids in by_hash.items() if len(set(labels[ids])) > 1
    ]
    (OUT / "conflicting_label_duplicates.json").write_text(json.dumps(conflicts, indent=2), encoding="utf-8")
    print("Data audit:", audit, flush=True)
    train_val, test = train_test_split(unique_indices, test_size=0.15, stratify=labels[unique_indices], random_state=SEED)
    train, val = train_test_split(train_val, test_size=0.15 / 0.85, stratify=labels[train_val], random_state=SEED)
    split = {name: [str(paths[i].relative_to(ROOT)) for i in ids] for name, ids in (("train", train), ("validation", val), ("test", test))}
    (OUT / "baseline_split.json").write_text(json.dumps({"seed": SEED, "classes": CLASSES, "files": split}, indent=2), encoding="utf-8")
    print("Split sizes:", len(train), len(val), len(test), flush=True)

    backbone = tf.keras.applications.EfficientNetB3(include_top=False, pooling="avg", weights="imagenet", input_shape=(300, 300, 3))
    backbone.trainable = False
    features = embeddings(backbone, paths, OUT / "imagenet_b3_embeddings.npz")
    counts = np.bincount(labels[train], minlength=5)
    # Square-root balancing limits the influence of the rarest class.
    class_weights = np.sqrt(len(train) / (5 * counts))
    sample_weights = class_weights[labels[train]]
    print("Training class counts:", counts.tolist(), flush=True)

    candidates = []
    best = None
    for dropout, decay in ((0.3, 1e-3), (0.5, 1e-2), (0.6, 3e-2)):
        tf.keras.utils.set_random_seed(SEED)
        head = build_head(features[train], dropout, decay)
        history = head.fit(
            features[train], labels[train], sample_weight=sample_weights,
            validation_data=(features[val], labels[val]), epochs=80, batch_size=64,
            callbacks=[tf.keras.callbacks.EarlyStopping(monitor="val_loss", patience=8, restore_best_weights=True),
                       tf.keras.callbacks.ReduceLROnPlateau(monitor="val_loss", patience=4, factor=0.5, min_lr=1e-6)],
            verbose=0,
        )
        val_metrics = metrics(labels[val], head.predict(features[val], verbose=0))
        train_metrics = metrics(labels[train], head.predict(features[train], verbose=0))
        candidate = {"dropout": dropout, "weight_decay": decay, "epochs": len(history.history["loss"]),
                     "train": train_metrics, "validation": val_metrics}
        candidates.append(candidate)
        print("Candidate:", dropout, decay, "epochs", candidate["epochs"], "val macro F1", val_metrics["macro_f1"], flush=True)
        score = (val_metrics["macro_f1"], val_metrics["quadratic_kappa"])
        if best is None or score > best[0]:
            best = (score, head, candidate)

    _, head, chosen = best
    test_metrics = metrics(labels[test], head.predict(features[test], verbose=0))
    print("Held-out test:", {k: test_metrics[k] for k in ("accuracy", "macro_f1", "quadratic_kappa")}, flush=True)
    inp = tf.keras.Input((300, 300, 3))
    output = head(backbone(inp, training=False))
    full_model = tf.keras.Model(inp, output)
    model_path = OUT / "fundus_b3_frozen_baseline.keras"
    full_model.save(model_path)
    report = {"classes": CLASSES, "severity_order": ["No_DR", "Mild", "Moderate", "Severe", "Proliferate_DR"],
              "split_sizes": {k: len(v) for k, v in split.items()}, "data_audit": audit,
              "train_class_counts": counts.tolist(),
              "candidates": candidates, "chosen": {k: chosen[k] for k in ("dropout", "weight_decay", "epochs")},
              "test": test_metrics, "model_path": str(model_path)}
    (OUT / "fundus_b3_baseline_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("Saved", model_path, flush=True)


if __name__ == "__main__":
    main()
