# Utilitas Machine Learning

Jalankan seluruh perintah dari root repository.

| Script | Fungsi |
|---|---|
| `train_fundus_baseline.py` | Audit duplikat, membuat split, mengekstrak embedding, dan melatih dense baseline. |
| `train_fundus_regularized.py` | Melatih linear softmax head dengan regularisasi kuat. |
| `train_fundus_ordinal.py` | Melatih ordinal cumulative head yang dipakai checkpoint aktif. |
| `evaluate_existing_models.py` | Mengevaluasi checkpoint lama pada split validasi lama. |
| `compare_models.py` | Membandingkan checkpoint pada held-out test yang sama. |
| `train_efficientnetb3_legacy.py` | Workflow fine-tuning lama untuk reproduksi dan perbandingan. |

Dataset, cache embedding, laporan JSON, dan checkpoint disimpan di folder yang sudah diabaikan Git. Ringkasan hasil ada di [docs/training.md](../../docs/training.md).
