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

### Completed Kaggle run, reviewed 10 October 2026

The private kernel `falahandhesryo/eyepacs-efficientnetb3-patient-level-training` completed. Its `eyepacs_b3/report.json` and `history.csv` were retrieved to `data/kaggle-results/eyepacs/eyepacs_b3/`. These are the full run, not the local 20-image pipeline check. The checkpoint was not installed as the application's active model.

| Split | Images | Patients | Accuracy | Macro F1 | Quadratic kappa |
| --- | ---: | ---: | ---: | ---: | ---: |
| Train | 24,588 | 12,294 | 76.41% | 45.68% | 0.5744 |
| Validation | 5,268 | 2,634 | 75.78% | 43.82% | 0.5537 |
| Test | 5,270 | 2,635 | 75.24% | 43.36% | 0.5378 |

Test recall by class: No_DR 93.30%, Mild 0.27% (1/372), Moderate 30.09%, Severe 41.84%, and Proliferate_DR 56.48%. A majority-class classifier would obtain 73.40% accuracy on this test set, so accuracy alone obscures the weak minority-class performance. The small train/test accuracy gap does not establish adequate generalization or absence of overfitting.

The CSV contains six frozen-head epochs and seven fine-tuning epochs. Early stopping ended the requested phases before their maximum epochs. The lowest logged validation loss is 0.7483 at epoch label 14. The run used TensorFlow 2.20.0 on Kaggle.

The active APTOS ordinal model has accuracy 80.42%, macro F1 61.58%, and kappa 0.8464 on its own 526-image held-out test. These numbers use a different dataset and split, so they do not establish a fair ranking against EyePACS. Keep `fundus-b3-ordinal-aptos-v1` for continuity of the research demo while improving minority-class learning and evaluating both checkpoints on a common patient-level test set. Neither model is clinically validated. A comparison on common held-out patients has not yet been run.

## Balanced EyePACS experiment V2

The target is held-out accuracy, macro precision, macro recall, and macro F1 above 0.90. Confusion matrices have no single percentage score. Reports contain raw and row-normalized matrices plus an explicit separate check for precision, recall, and F1 above 0.90 in every class. These are research targets, not achieved results.

`train_eyepacs_v2.py` mixes natural-prevalence sampling and uniform class sampling equally. It does not combine resampling with class weights. The best checkpoint is selected by validation macro F1 across frozen-head and fine-tuning phases. Fine tuning opens the final 120 backbone layers while BatchNormalization remains frozen. Learning-rate reduction and early stopping use validation macro F1. Saved per-image predictions allow paired error review after the run.

```powershell
python scripts/ml/train_eyepacs_v2.py --output models/eyepacs_b3_v2
python scripts/ml/test_train_eyepacs_v2.py
```

`scripts/ml/kaggle_eyepacs_v2.py` is the self-contained GPU entry point for a separate private kernel, `falahandhesryo/eyepacs-efficientnetb3-balanced-v2`. It preserves the earlier patient split and preprocessing, checks split image-ID hashes against the local manifests, and compares the four metrics with the previous EyePACS report. The old checkpoint and the active application model are not overwritten. Generated preprocessing files are removed on Kaggle only after successful export to avoid retaining 35,126 temporary images as notebook outputs.

The historical test results have already been inspected. Retaining the same split supports benchmark continuity, but it does not provide a fresh external validation set. Any eventual claim of generalization needs a separate, previously unexamined dataset. Local contract tests use a tiny synthetic model and do not establish model quality. Full GPU training is required to measure the new experiment.

## Three-source five-class DR pipeline

See [combined training](combined-training.md) for the EyePACS, APTOS, and Mendeley V1 integration. Scripts preserve source provenance, exclude unsupported disease labels, group duplicate/derived images before splitting, quarantine conflicting grades, and emit overall plus per-source metrics. The combined model has not been trained or installed merely by adding this pipeline.
