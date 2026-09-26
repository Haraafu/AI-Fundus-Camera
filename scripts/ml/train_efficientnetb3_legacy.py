from pathlib import Path
import tensorflow as tf
from tensorflow.keras import layers, models
from tensorflow.keras.applications import EfficientNetB3
from tensorflow.keras.callbacks import ModelCheckpoint, EarlyStopping, ReduceLROnPlateau
from sklearn.utils.class_weight import compute_class_weight
import numpy as np
import matplotlib.pyplot as plt


# =========================
# KONFIGURASI
# =========================

BASE_DIR = Path(__file__).resolve().parents[2]

DATA_DIR = BASE_DIR / "preprocessed_images"
MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

IMG_SIZE = 300
BATCH_SIZE = 16
SEED = 42
NUM_CLASSES = 5

EPOCHS_HEAD = 10
EPOCHS_FINE_TUNE = 20


# =========================
# LOAD DATASET
# =========================

train_ds = tf.keras.utils.image_dataset_from_directory(
    DATA_DIR,
    validation_split=0.2,
    subset="training",
    seed=SEED,
    image_size=(IMG_SIZE, IMG_SIZE),
    batch_size=BATCH_SIZE,
    label_mode="categorical"
)

val_ds = tf.keras.utils.image_dataset_from_directory(
    DATA_DIR,
    validation_split=0.2,
    subset="validation",
    seed=SEED,
    image_size=(IMG_SIZE, IMG_SIZE),
    batch_size=BATCH_SIZE,
    label_mode="categorical"
)

class_names = train_ds.class_names
print("Class names:", class_names)


# =========================
# OPTIMASI PIPELINE DATA
# =========================

AUTOTUNE = tf.data.AUTOTUNE

train_ds = train_ds.shuffle(1000).prefetch(buffer_size=AUTOTUNE)
val_ds = val_ds.prefetch(buffer_size=AUTOTUNE)


# =========================
# HITUNG CLASS WEIGHT
# =========================
# Penting karena dataset diabetic retinopathy biasanya tidak seimbang.

def get_labels_from_dataset(dataset):
    labels = []

    for _, batch_labels in dataset:
        labels.extend(np.argmax(batch_labels.numpy(), axis=1))

    return np.array(labels)


train_labels = get_labels_from_dataset(train_ds)

class_weights_array = compute_class_weight(
    class_weight="balanced",
    classes=np.unique(train_labels),
    y=train_labels
)

class_weights = {
    i: class_weights_array[i]
    for i in range(len(class_weights_array))
}

print("Class weights:", class_weights)


# =========================
# DATA AUGMENTATION
# =========================

data_augmentation = tf.keras.Sequential([
    layers.RandomFlip("horizontal"),
    layers.RandomRotation(0.05),
    layers.RandomZoom(0.1),
    layers.RandomContrast(0.1),
], name="data_augmentation")


# =========================
# BANGUN MODEL EFFICIENTNET-B3
# =========================

base_model = EfficientNetB3(
    include_top=False,
    weights="imagenet",
    input_shape=(IMG_SIZE, IMG_SIZE, 3)
)

# Tahap awal: freeze backbone
base_model.trainable = False

inputs = layers.Input(shape=(IMG_SIZE, IMG_SIZE, 3))

x = data_augmentation(inputs)

# EfficientNet dari tf.keras sudah punya preprocessing internal.
# Jadi tidak perlu manual dibagi 255.
x = base_model(x, training=False)

x = layers.GlobalAveragePooling2D()(x)
x = layers.Dropout(0.4)(x)

outputs = layers.Dense(
    NUM_CLASSES,
    activation="softmax",
    name="classification_output"
)(x)

model = models.Model(inputs, outputs)

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
    loss="categorical_crossentropy",
    metrics=[
        "accuracy",
        tf.keras.metrics.Precision(name="precision"),
        tf.keras.metrics.Recall(name="recall")
    ]
)

model.summary()


# =========================
# CALLBACKS
# =========================

checkpoint_path = MODEL_DIR / "best_efficientnetb3.keras"

callbacks = [
    ModelCheckpoint(
        filepath=str(checkpoint_path),
        monitor="val_accuracy",
        save_best_only=True,
        mode="max",
        verbose=1
    ),
    EarlyStopping(
        monitor="val_loss",
        patience=5,
        restore_best_weights=True,
        verbose=1
    ),
    ReduceLROnPlateau(
        monitor="val_loss",
        factor=0.3,
        patience=3,
        min_lr=1e-7,
        verbose=1
    )
]


# =========================
# TRAINING TAHAP 1
# =========================

print("\nTraining tahap 1: melatih classification head...\n")

history_head = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=EPOCHS_HEAD,
    class_weight=class_weights,
    callbacks=callbacks
)


# =========================
# FINE-TUNING
# =========================
# Buka sebagian layer belakang EfficientNet-B3 agar model lebih adaptif ke citra fundus.

print("\nTraining tahap 2: fine-tuning EfficientNet-B3...\n")

base_model.trainable = True

# Freeze sebagian besar layer awal, buka layer-layer akhir saja
fine_tune_at = int(len(base_model.layers) * 0.7)

for layer in base_model.layers[:fine_tune_at]:
    layer.trainable = False

for layer in base_model.layers[fine_tune_at:]:
    layer.trainable = True

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-5),
    loss="categorical_crossentropy",
    metrics=[
        "accuracy",
        tf.keras.metrics.Precision(name="precision"),
        tf.keras.metrics.Recall(name="recall")
    ]
)

history_fine = model.fit(
    train_ds,
    validation_data=val_ds,
    epochs=EPOCHS_FINE_TUNE,
    class_weight=class_weights,
    callbacks=callbacks
)


# =========================
# SIMPAN MODEL FINAL
# =========================

final_model_path = MODEL_DIR / "final_efficientnetb3_dr.keras"
model.save(str(final_model_path))

print(f"\nModel final disimpan di: {final_model_path}")
print(f"Model terbaik disimpan di: {checkpoint_path}")


# =========================
# PLOT HASIL TRAINING
# =========================

def plot_history(history, title):
    acc = history.history["accuracy"]
    val_acc = history.history["val_accuracy"]
    loss = history.history["loss"]
    val_loss = history.history["val_loss"]

    epochs_range = range(len(acc))

    plt.figure(figsize=(12, 5))

    plt.subplot(1, 2, 1)
    plt.plot(epochs_range, acc, label="Training Accuracy")
    plt.plot(epochs_range, val_acc, label="Validation Accuracy")
    plt.legend()
    plt.title(f"{title} - Accuracy")

    plt.subplot(1, 2, 2)
    plt.plot(epochs_range, loss, label="Training Loss")
    plt.plot(epochs_range, val_loss, label="Validation Loss")
    plt.legend()
    plt.title(f"{title} - Loss")

    plt.show()


plot_history(history_head, "Head Training")
plot_history(history_fine, "Fine Tuning")
