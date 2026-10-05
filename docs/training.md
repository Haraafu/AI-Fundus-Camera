# Fundus model training run (2026-09-26)

## Data and split

The source contains 3,662 preprocessed images. Exact SHA-256 checks found 123 duplicate-image groups (251 files). Thirty groups (62 files) have conflicting diagnosis labels. Training excludes those ambiguous groups and uses one representative per remaining hash, leaving 3,504 unique consistently labelled images.

The new split is stratified by class with a fixed seed (`20260926`): 2,452 train, 526 validation, and 526 test images. Exact duplicate images cannot cross split boundaries. Patient identity is not available, so this is **not** a patient-level split. Perceptually similar images can still occur across splits.

The full split and conflicting-label image IDs are in `models/baseline_split.json` and `models/conflicting_label_duplicates.json` (generated files, ignored by Git).

## Training

`scripts/ml/train_fundus_baseline.py` caches ImageNet EfficientNetB3 embeddings, then trains three dense classification heads with dropout, weight decay, class weighting, and validation-loss early stopping. The best validation macro F1 candidate was overfitted: train macro F1 0.994 versus validation 0.630. It is kept as a comparison artifact, not the recommended model.

`scripts/ml/train_fundus_regularized.py` fits a linear softmax head on the same frozen embeddings. L2 strength is selected using validation macro F1. The selected `C=0.0003` produces train macro F1 0.729 and validation macro F1 0.606, with a smaller generalization gap. Run the scripts with the system Python environment that has TensorFlow 2.21, scikit-learn, and Pillow installed:

```powershell
python scripts/ml/train_fundus_baseline.py
python scripts/ml/train_fundus_regularized.py
python scripts/ml/train_fundus_ordinal.py
```

The lower-gap checkpoint is `models/fundus_b3_regularized.keras`. The integrated checkpoint is `models/fundus_b3_ordinal.keras`, selected for the application prototype because it achieved the highest held-out quadratic weighted kappa and Proliferate_DR recall among the new runs. Both expect 300×300 RGB float32 images in the 0–255 range, preprocessed with `fundus/preprocessing.py`. Class order is `Mild`, `Moderate`, `No_DR`, `Proliferate_DR`, `Severe`.

## Held-out test results

| Model | Accuracy | Macro F1 | Quadratic weighted kappa | Train macro F1 | Validation macro F1 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Dense head | 0.812 | 0.627 | 0.842 | 0.994 | 0.630 |
| Regularized linear head | 0.812 | 0.612 | 0.827 | 0.729 | 0.606 |
| Ordinal cumulative head | 0.804 | 0.616 | 0.846 | 0.697 | 0.600 |

For the regularized model, test recall was: No_DR 0.996, Mild 0.569, Moderate 0.783, Severe 0.231, Proliferate_DR 0.366. The rare, clinically important severe classes remain weak. Detailed confusion matrices and metrics are in `models/fundus_b3_regularized_report.json`.

The ordinal model reflects the ordered grades through four cumulative decisions. It improves test quadratic weighted kappa and Proliferate_DR recall compared with the regularized linear head, but reduces Mild and Severe recall. Its checkpoint is integrated as the current research model while larger patient-level data are collected; this choice does not make it clinically final.

These are internal research results. The older checkpoints used a separate validation split for selection and are not directly comparable to the new held-out test. This run does not establish clinical performance. Before clinical use, the model needs label review, patient-level splitting, external validation, and evaluation of sensitivity at a prespecified screening threshold. The checked-in environment template defaults to mock mode; setting `AI_MODE=model` loads the configured checkpoint through the FastAPI TensorFlow adapter.

## EyePACS training

The Kaggle EyePACS download is stored as numbered ZIP chunks. Prepare it without creating a second 35 GiB copy of the raw images:

```powershell
# Small end-to-end check: 100 patients in each split
python scripts/ml/prepare_eyepacs.py --pilot-patients 100 --output data/eyepacs/pilot
python scripts/ml/train_eyepacs.py --data data/eyepacs/pilot --output models/eyepacs_b3_pilot --skip-fine-tune --head-epochs 2

# Full patient-level dataset
python scripts/ml/prepare_eyepacs.py
python scripts/ml/train_eyepacs.py
```

After the full run, the best checkpoint is `models/eyepacs_b3/best.keras`, the epoch log is `models/eyepacs_b3/history.csv`, and the held-out metrics are in `models/eyepacs_b3/report.json`. Do not use the pilot score to judge quality; it only checks that every pipeline stage works.

The full run contains 35,126 images from 17,563 patients. The split is made by patient ID, so left and right eyes from one patient stay in one split. The preparation uses the same crop, CLAHE, resize, and blur operations as production inference. Training uses ImageNet EfficientNetB3, class weighting, augmentation, checkpointing, learning-rate reduction, and early stopping. The final report includes accuracy, macro F1, per-class metrics, confusion matrices, and quadratic weighted kappa for train, validation, and the untouched test split.

Native Windows TensorFlow 2.21 cannot use a GPU. A full fine-tuning run should use a Kaggle GPU notebook, Google Colab, Linux, or WSL2 with a supported NVIDIA GPU. A local CPU run is suitable for the pilot and frozen-head checks; it is not practical for repeated full fine-tuning.
