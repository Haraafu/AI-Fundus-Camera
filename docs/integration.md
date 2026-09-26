# Integrasi dan Validasi Model

Dokumen ini menjelaskan checkpoint yang sedang dipakai aplikasi, alur inference, bukti pengujian, dan cara menggantinya. Status teknis saat ini adalah **lulus untuk prototipe riset**. Persetujuan formal model klinis belum tersedia.

## Model aktif

| Item | Nilai |
|---|---|
| Model | `models/fundus_b3_ordinal.keras` |
| Versi | `fundus-b3-ordinal-aptos-v1` |
| Ukuran | 44,606,662 byte (42.54 MiB) |
| SHA-256 | `9300a18216d4972c17475770a36552fcd51219753a4151ff2339b11ccc7620e5` |
| Input | `[batch, 300, 300, 3]`, RGB float32, rentang 0–255 |
| Output | `[batch, 5]`, probabilitas berjumlah satu |
| Urutan output | `Mild`, `Moderate`, `No_DR`, `Proliferate_DR`, `Severe` |
| Runtime terverifikasi | Python 3.11.0, TensorFlow 2.21.0, Keras 3.14.1 |
| Parameter | 10,789,683 |

Label training `Proliferate_DR` dipetakan secara eksplisit menjadi label API `Proliferative_DR`.

## Alur aplikasi

```text
PNG/JPEG
  → backend Express
  → validasi dan penyimpanan original
  → preprocessing fundus-prep-v1
  → TensorFlow model
  → validasi lima probabilitas
  → processed PNG + hasil AI disimpan di SQLite
  → endpoint examination mengembalikan hasil
```

Mode dipilih melalui `AI_MODE`. Mode `model` tidak pernah beralih diam-diam ke mock ketika checkpoint hilang, gagal dimuat, atau menghasilkan output yang tidak valid.

## Contoh hasil aktual

Input referensi: `colored_images/Moderate/000c1434d8d7.png`

```json
{
  "status": "COMPLETED",
  "processedResolution": [300, 300],
  "result": {
    "predictedClass": "Moderate",
    "confidence": 0.5792074799537659,
    "probabilities": {
      "No_DR": 0.003601372241973877,
      "Mild": 0.014766335487365723,
      "Moderate": 0.5792074799537659,
      "Severe": 0.052445173263549805,
      "Proliferative_DR": 0.3499796390533447
    },
    "riskLevel": "MEDIUM",
    "modelVersion": "fundus-b3-ordinal-aptos-v1",
    "isMock": false,
    "preprocessingVersion": "fundus-prep-v1"
  }
}
```

Original dan processed image disimpan dengan nama berbeda. Hasil dapat dibaca kembali dari SQLite melalui endpoint examination.

## Validasi otomatis

| Area | Hasil |
|---|---|
| Load checkpoint dan shape | Lulus |
| Preprocessing dan pemetaan kelas | 10/10 tes Python lulus |
| Backend dan persistensi | 8/8 tes Node lulus |
| Alur model aktual | Smoke test lulus |
| Model hilang | `MODEL_NOT_READY` |
| Model gagal dimuat | `MODEL_LOAD_FAILED` |
| Output probabilitas invalid | `INFERENCE_FAILED` |
| Citra rusak | `INVALID_IMAGE` |
| AI mati atau timeout | Examination menjadi `FAILED` |
| Respons upstream invalid | `INVALID_AI_RESPONSE` |

## Evaluasi model

Pada held-out test 526 citra, checkpoint menghasilkan accuracy 0.8042, macro F1 0.6158, dan quadratic weighted kappa 0.8464. Split mencegah duplikat identik melintasi subset, tetapi bukan patient-level split karena identitas pasien tidak tersedia. Recall kelas Severe masih 0.269. Rincian tersedia di [training.md](training.md).

## Menjalankan sistem

Jalankan dari root repository pada tiga terminal terpisah:

```powershell
.\.venv\Scripts\python.exe -m pip install -r services/ai-service/requirements.txt
.\.venv\Scripts\python.exe services/ai-service/app.py
npm run backend
npm run smoke -- "colored_images/Moderate/000c1434d8d7.png"
```

## Mengganti checkpoint

1. Verifikasi checksum, input shape, output shape, urutan kelas, preprocessing, dan versi runtime model baru.
2. Ubah `MODEL_PATH`, `MODEL_VERSION`, dan `MODEL_CLASS_NAMES` di `.env`.
3. Jalankan tes Python, tes backend, dan smoke test aktual.
4. Perbarui tabel model aktif dan hasil evaluasi pada dokumentasi ini.

Checkpoint aktif masih merupakan artefak riset. Penggunaan klinis membutuhkan review label, patient-level split, validasi eksternal, quality gate citra, kalibrasi threshold, dan persetujuan pihak yang berwenang.
