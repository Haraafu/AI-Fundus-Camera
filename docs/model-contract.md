# Kontrak integrasi model

Model aktif lokal adalah EfficientNetB3 biner dari Kaggle versi 3. Konfigurasi: `MODEL_PATH=./models/kaggle-binary/combined_dr_binary_b3_v1/best.keras`, `MODEL_VERSION=combined-dr-binary-b3-v1-kaggle-v3`, dan `MODEL_CLASS_NAMES=No DR,DR`. API mengembalikan `No_DR` dan `DR`. Model memakai argmax pada dua probabilitas dan tidak menilai tingkat keparahan atau risiko klinis. Hasil biner menyimpan `riskLevel=NOT_ASSESSED`.

Checkpoint berasal dari output `combined_dr_binary_b3_v1/best.keras` pada kernel privat `falahandhesryo/combined-dr-efficientnetb3-binary-v1` versi 3. Versi inferensi berukuran 44.497.131 byte disertakan dalam Git; state optimizer training dikeluarkan tanpa mengubah bobot. Seluruh 499 bobot dan prediksi tiga citra lokal diverifikasi identik dengan checkpoint training. Lihat [evaluasi model biner](combined-training.md#hasil-evaluasi-model-biner) untuk batas kinerjanya. Grad-CAM dapat berstatus `UNAVAILABLE` jika tidak ada aktivasi positif pada citra yang diprediksi.

Checkpoint model lama sudah dihapus dari folder `models/`. Pembacaan riwayat hasil lima kelas tetap didukung. Checkpoint training biner lengkap hanya diarsipkan lokal pada `data/model-archives/` yang di-ignore.

## Input dan preprocessing

Backend menerima satu PNG/JPEG melalui multipart field `image`, maksimum 10 MiB dan 40 juta piksel. Original disimpan tanpa mengubah byte. AI service menjalankan `fundus/preprocessing.py` dan mengembalikan PNG hasil preprocessing ke backend untuk disimpan dengan nama terpisah.

| Tahap | Kontrak `fundus-prep-v1` |
|---|---|
| Decode | OpenCV BGR → RGB; mengikuti perilaku decoder pada pipeline existing |
| Crop | Bounding box piksel grayscale > 10; citra seluruhnya hitam dipertahankan untuk kompatibilitas pipeline lama |
| Resize | 300 × 300, `INTER_AREA` |
| CLAHE | Luminance LAB, clip limit 2.0, tile grid 8 × 8 |
| Denoise | Gaussian blur kernel 3 × 3, sigma 0 |
| Artefak | RGB uint8 0–255, disimpan sebagai PNG |
| Input model | NHWC `[1,300,300,3]`, float32, rentang 0–255 |
| Normalisasi eksternal | Tidak dibagi 255; script training existing menggunakan rescaling di dalam EfficientNetB3 |

Spesifikasi ini dipakai oleh checkpoint yang terintegrasi. Model pengganti harus memakai transformasi yang sama. Jika berubah, ubah versi preprocessing dan ulangi uji kecocokan sebelum inference. Citra hitam/blur/terang belum memiliki quality gate klinis; pemeriksaan format tidak membuktikan kelayakan citra fundus.

Jalankan satu citra dan bandingkan dengan referensi yang dipakai training:

```powershell
.\.venv\Scripts\python.exe -m fundus.preprocessing colored_images/Moderate/000c1434d8d7.png --output data/preprocessing/processed.png --reference preprocessed_images/Moderate/000c1434d8d7.png
```

Perintah membuat PNG terpisah dan JSON metadata/checksum. Exit code 1 berarti piksel tidak identik dengan referensi. CLI menolak output yang menimpa original atau referensi. Script batch `preprocess.py` memakai fungsi yang sama; import tidak menjalankan batch dan tidak membuat folder output.

## Urutan kelas

Urutan kanonis API untuk model aktif adalah `No_DR`, `DR`. Urutan neuron checkpoint aktif dikonfigurasi melalui `MODEL_CLASS_NAMES=No DR,DR`. Riwayat model lama menggunakan `No_DR`, `Mild`, `Moderate`, `Severe`, `Proliferative_DR`.

`fundus/contract.py::map_probabilities` menerima probabilitas beserta daftar kelas model dan memetakan berdasarkan nama. Alias yang didukung adalah `No DR` → `No_DR` dan `Proliferate_DR` → `Proliferative_DR`. Setiap kelas dalam skema biner atau lima kelas harus muncul tepat sekali, probabilitas finite dalam [0,1], dan jumlahnya 1 dengan toleransi 0.0001. Predicted class adalah argmax dan confidence adalah probabilitas kelas tersebut. Tidak ada softmax kedua atau pengubahan urutan berdasarkan tebakan.

## Mode dan kesiapan

| Konfigurasi | `/health` | `/ready` | `/predict` |
|---|---|---|---|
| `AI_MODE=mock` | 200, mode mock, ready true, modelLoaded false, isMock true, modelVersion mock-v0 | 200 | Preprocessing nyata dan prediksi dummy tetap |
| `AI_MODE=model`, checkpoint valid | 200, mode model, ready true, modelLoaded true, isMock false, modelVersion sesuai konfigurasi | 200 | Preprocessing nyata dan inference TensorFlow |
| `AI_MODE=model`, checkpoint hilang/gagal | 200, mode model, ready false, modelLoaded false, isMock false, errorCode terisi | 503 | 503 MODEL_NOT_READY atau MODEL_LOAD_FAILED |
| Nilai mode lain | Startup ditolak | — | — |

`/health` menunjukkan proses hidup. `/ready` menunjukkan adapter yang dipilih siap menerima prediksi; readiness pada mode mock tidak berarti model aktual tersedia. `TensorFlowModelAdapter` memuat checkpoint satu kali saat startup, memvalidasi shape input/output, lalu menyinkronkan pemanggilan inference. Backend harus memakai `AI_MODE` yang sama dengan service; respons dengan flag mock yang tidak cocok ditolak. Tidak ada fallback otomatis.

## Output dan persistensi

Respons `/predict` mempertahankan `success`, `prediction.class`, `prediction.confidence`, lima `probabilities`, `riskLevel`, `modelVersion`, dan `isMock`, serta metadata preprocessing berikut:

```json
{
  "preprocessingVersion": "fundus-prep-v1",
  "preprocessing": {
    "version": "fundus-prep-v1",
    "outputResolution": [300, 300],
    "parameters": { "colorSpace": "RGB", "externalNormalization": "none" },
    "mimeType": "image/png",
    "imageBase64": "<PNG-base64>"
  }
}
```

Contoh `parameters` di atas diringkas; parameter lengkap dihasilkan oleh `fundus.preprocessing.parameters()`. Backend memvalidasi PNG 300 × 300 dan versi sebelum menyimpan. Base64 hanya transport antar-service dan tidak disimpan dalam JSON database. Examination menyimpan `image.originalPath`, `image.processedPath`, `image.preprocessingVersion`, `image.preprocessingParameters`, `image.processedResolution`, serta `result.preprocessingVersion`. Original dan processed image disimpan di `UPLOAD_DIR`; path bersifat relatif dan tidak disajikan sebagai direktori publik.

Pada mode model, `riskLevel` diturunkan dari kelas prediksi: `No_DR` → `LOW`, `Mild`/`Moderate` → `MEDIUM`, dan `Severe`/`Proliferative_DR` → `HIGH`. Nilai ini adalah kategori aplikasi riset, bukan keputusan klinis. Hasil evaluasi checkpoint aktif tersedia di [training.md](training.md).

## Error

AI service: 400 `INVALID_IMAGE`, 413 `UPLOAD_TOO_LARGE`, 422 untuk field multipart yang hilang, 503 `MODEL_NOT_READY` atau `MODEL_LOAD_FAILED`. Backend: 502 `AI_UNAVAILABLE`, `AI_TIMEOUT`, `INVALID_AI_RESPONSE`, atau `INFERENCE_FAILED`. `MODEL_NOT_READY` dan `MODEL_LOAD_FAILED` dari service diteruskan sebagai kode aman dengan HTTP 502.

Kegagalan setelah original tersimpan membuat examination `FAILED`, result null, dan original tetap tersedia. Input invalid sebelum penyimpanan tetap `CREATED`. Restart/pengambilan hasil menggunakan SQLite yang sama.

## Serah terima model pengganti

Catat metadata berikut saat checkpoint aktif akan diganti. Metadata operasional internal tidak dibaca otomatis oleh adapter.

- [ ] Model final, nama versi, SHA-256, tanggal serah terima, nama pemilik, dan pihak yang menyetujui.
- [ ] Daftar kelas sesuai urutan output training, termasuk ejaan label.
- [ ] Input shape/dtype/rentang piksel, preprocessing dan normalisasi yang benar.
- [ ] Versi Python/TensorFlow/Keras dan kebutuhan custom layer/custom object.
- [ ] Citra contoh yang boleh dipakai tim dan output probabilitas yang diharapkan beserta toleransi perbandingan.
- [ ] Metrik evaluasi, confusion matrix, identitas split data, dan keterbatasan yang diketahui.
- [ ] Nama layer/struktur yang dapat dipakai Grad-CAM.

Sebelum mengganti checkpoint, verifikasi checksum, urutan kelas, preprocessing, versi TensorFlow/Keras, contoh input-output, dan hasil evaluasinya. Setelah itu ubah `MODEL_PATH`, `MODEL_VERSION`, dan `MODEL_CLASS_NAMES`, lalu jalankan readiness dan smoke test end-to-end.

## Grad-CAM mixed-precision compatibility

The active checkpoint uses mixed precision. Grad-CAM reuses its trained head
and casts gradients and convolutional activations to float32 before weighted
spatial accumulation and OpenCV resizing. Model weights, prediction logic,
class order, and probabilities are unchanged. A genuine absence of positive
activation still returns `UNAVAILABLE / NO_POSITIVE_ACTIVATION`; no heatmap is
fabricated. Allow up to 90 seconds for CPU inference with Grad-CAM via
`AI_TIMEOUT_MS`. Older stored examinations can request explanation generation
through the owner-authenticated API documented in `api.md`.

`gradcam-v2` differentiates the requested class logit before softmax to avoid
vanishing explanation gradients on very confident predictions. Only the final
explanation Dense layer is copied with linear activation; prediction weights
and the original softmax head are not modified. Metadata includes
`scoreType=logit`. Stored v1 overlays remain readable. This follows the
[official Keras Grad-CAM example](https://keras.io/examples/vision/grad_cam/)
which also removes softmax for explanation scoring.
