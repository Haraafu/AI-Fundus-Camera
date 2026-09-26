# Product Requirements Document (PRD)
## AI Fundus Camera Software System

**Desain Proyek 2 - Kelompok 06**  
**Versi:** 1.0  
**PIC Software/AI:** Falah Andhesryo  
**Status awal:** Setelah Laporan Pekan 2

PRD ini disusun untuk menerjemahkan ekspektasi pada Desain Proyek 1 menjadi kebutuhan software yang dapat diimplementasikan dan diuji pada Desain Proyek 2.

Pada Despro 1, software dirancang modular dan terdiri dari frontend, backend/API, AI engine, database, serta reporting module. Inferensi AI dilakukan di server, bukan pada mikrokontroler. Pada akhir Pekan 2, environment lokal, Git, repository GitHub, dan kode preprocessing awal sudah disiapkan sehingga tahap berikutnya masuk ke dataset dan implementasi AI.

---

## 1. Product Overview

### 1.1 Nama Produk

**AI Fundus Camera Software Platform**

Software ini merupakan bagian dari sistem:

**“Perancangan dan Implementasi Sistem Kamera Fundus Berbasis AI untuk Deteksi Multi-Penyakit dengan 9 Kategori Risiko Kesehatan.”**

Tujuan software adalah menerima citra dari kamera fundus, memvalidasi dan melakukan preprocessing citra, menjalankan model AI, menyimpan hasil analisis, kemudian menampilkan hasil kepada operator melalui dashboard serta menghasilkan laporan PDF.

Alur utama sistem:

```text
Fundus Camera → Backend → Preprocessing → AI → Database → Dashboard → PDF Report
```

---

## 2. Product Problem

Produk kamera fundus komersial seperti AirDoc dapat menghasilkan analisis kesehatan berbasis fundus, tetapi sistemnya proprietary sehingga raw image, model, data internal, dan mekanisme analisis tidak dapat diakses secara penuh.

Dari sisi software, masalah yang ingin diselesaikan adalah:

| Masalah | Solusi Software |
|---|---|
| Raw image sulit diakses pada sistem proprietary | Semua original fundus image dapat disimpan dan diakses |
| Kualitas image dari prototype kamera dapat tidak konsisten | Automated preprocessing dan image quality validation |
| Interpretasi manual membutuhkan tenaga medis | AI memberikan preliminary screening |
| Output AI sulit dipahami | Probability, risk level dan Grad-CAM |
| Data pemeriksaan tidak terstruktur | Database pasien dan examination |
| Komponen hardware dan AI terpisah | Backend sebagai system orchestrator |
| Hasil pemeriksaan sulit didokumentasikan | Dashboard dan PDF report |
| AI proprietary bersifat black-box | Model, preprocessing dan hasil model dapat diaudit |

---

## 3. Product Goal

### Primary Goal

Membangun pipeline software end-to-end yang dapat:

```text
Fundus Camera → Backend → Preprocessing → AI → Database → Dashboard → PDF Report
```

sehingga citra yang diperoleh hardware dapat diproses menjadi informasi skrining yang dapat diperiksa oleh tenaga medis.

Software **bukan alat diagnosis**. Hasil AI diposisikan sebagai informasi pendukung skrining, bukan diagnosis final.

---

## 4. Scope Decision untuk Despro 2

Judul proyek menyebut **9 kategori risiko kesehatan**, tetapi implementasi AI yang dijabarkan dalam Despro 1 secara lebih konkret menggunakan EfficientNetB3 dan terutama mengarah ke diabetic retinopathy. Rancangan training juga menyebut output **5 kelas tingkat keparahan**.

Karena itu, scope Despro 2 ditetapkan sebagai berikut:

| Scope | Despro 2 |
|---|---|
| Arsitektur mendukung multi-disease | Ya |
| Implementasi 9 disease model sekaligus | Bukan MVP |
| Diabetic Retinopathy classification | MVP utama |
| DR 5 severity classes | Ya |
| Konversi hasil ke Low/Medium/High risk | Ya |
| Grad-CAM | Ya |
| Vascular biomarker | Tahap lanjutan |
| Dashboard | Ya |
| PDF report | Ya |
| Integrasi hardware | Ya |
| Clinical diagnosis | Tidak |

---

## 5. Target Users

### 5.1 Operator / Tenaga Medis

User utama software.

Mereka harus dapat:
- mendaftarkan pasien,
- memulai pemeriksaan,
- melihat status kamera,
- melihat citra fundus,
- menjalankan analisis,
- membaca risk score,
- melihat laporan.

### 5.2 Administrator

Mengelola:
- sistem,
- database,
- user account,
- server,
- monitoring.

### 5.3 Researcher / Developer

Mengakses:
- raw image,
- preprocessing output,
- AI result,
- model version,
- metadata eksperimen.

### 5.4 Patient

Bukan user langsung dashboard pada versi MVP. Pasien merupakan penerima manfaat pemeriksaan.

---

## 6. Core User Journey

```text
Operator login
      ↓
Create / select patient
      ↓
Create examination session
      ↓
Check camera connection
      ↓
Position patient
      ↓
Eye position validation
      ↓
Capture fundus image
      ↓
Image uploaded
      ↓
Image quality validation
      ↓
Preprocessing
      ↓
AI inference
      ↓
Prediction + probability
      ↓
Risk scoring
      ↓
Generate Grad-CAM
      ↓
Save examination
      ↓
Display result
      ↓
Generate PDF report
```

---

## 7. Software Architecture

```text
                     ┌────────────────────┐
                     │   Fundus Camera    │
                     │     ESP32-S3       │
                     └────────┬───────────┘
                              │
            MQTT              │       HTTPS Image Upload
       Device Status          │
                              ▼
                     ┌────────────────────┐
                     │    Backend API     │
                     │ Node.js + Express  │
                     └───────┬────────────┘
                             │
              ┌──────────────┼───────────────┐
              │              │               │
              ▼              ▼               ▼
        ┌───────────┐ ┌──────────────┐ ┌───────────┐
        │ AI Service│ │   MongoDB    │ │File Store │
        │  Python   │ │    Atlas     │ │  Images   │
        └─────┬─────┘ └──────────────┘ └───────────┘
              │
              ▼
     ┌───────────────────┐
     │ Preprocessing     │
     │ EfficientNetB3    │
     │ Grad-CAM          │
     │ Risk Scoring      │
     └──────────┬────────┘
                │
                ▼
         Backend Response
                │
        ┌───────┴────────┐
        ▼                ▼
┌───────────────┐ ┌───────────────┐
│ Next.js       │ │ PDF Generator │
│ Dashboard     │ │ Examination   │
└───────────────┘ └───────────────┘
```

---

## 8. Technology Stack

| Komponen | Teknologi Target |
|---|---|
| Frontend | Next.js |
| Backend | Node.js + Express.js |
| AI Service | Python |
| AI Framework | TensorFlow/Keras |
| Image Processing | OpenCV |
| AI Model | EfficientNetB3 |
| Explainability | Grad-CAM |
| Eye positioning | MediaPipe |
| Database | MongoDB Atlas |
| Device realtime messaging | MQTT |
| Image upload | HTTPS multipart/form-data |
| Backend ↔ AI | REST API |
| Frontend ↔ Backend | REST + optional WebSocket |
| Version control | Git + GitHub |
| Configuration | `.env` |
| Report | PDF generator |

---

## 9. Functional Requirements

### FR-01 Authentication

Sistem menyediakan login minimal untuk operator/admin.

**Acceptance criteria:**

```text
Given user memiliki account
When credential valid
Then user masuk ke dashboard

Given credential salah
Then akses ditolak
And pesan error ditampilkan
```

---

### FR-02 Patient Management

Operator dapat membuat dan memilih pasien.

Minimal field:

```text
patient_id
patient_code
age / birth_year
sex (optional)
created_at
```

Untuk prototype sebaiknya menggunakan **patient code**, bukan nama lengkap, kecuali memang dibutuhkan oleh skenario demo.

---

### FR-03 Examination Session

Setiap proses pemeriksaan harus memiliki examination tersendiri.

```text
examination_id
patient_id
eye
capture_type
timestamp
status
```

`eye`:

```text
LEFT
RIGHT
```

`capture_type`:

```text
MACULA_CENTERED
OPTIC_DISC_CENTERED
```

---

## 10. Device Communication

### FR-04 Device Status

Backend menerima status:

```json
{
  "deviceId": "fundus-001",
  "status": "READY",
  "battery": 85,
  "timestamp": "..."
}
```

Status minimal:

```text
OFFLINE
IDLE
POSITIONING
READY
CAPTURING
UPLOADING
PROCESSING
ERROR
```

MQTT dipakai untuk komunikasi status perangkat, sedangkan citra dikirim melalui HTTP/HTTPS `multipart/form-data`.

---

## 11. Image Upload

### FR-05 Fundus Image Upload

Hardware harus dapat mengirim citra:

```http
POST /api/examinations/:id/images
Content-Type: multipart/form-data
```

Metadata:

```text
image
eye
capture_type
device_id
capture_timestamp
```

Backend kemudian:

```text
1. Validate request
2. Validate image
3. Store original image
4. Create image record
5. Queue/start analysis
```

Raw image **tidak boleh ditimpa preprocessing image**.

Harus tersedia minimal:

```text
original image
processed image
Grad-CAM image
```

---

## 12. Preprocessing Pipeline

### FR-06 Image Preprocessing

Pipeline minimum:

```text
Input image
   ↓
Image validation
   ↓
Fundus ROI detection/cropping
   ↓
Resize
   ↓
Color normalization
   ↓
CLAHE
   ↓
Noise reduction
   ↓
Model normalization
   ↓
Output model-ready image
```

Target preprocessing:

```text
crop area gelap
resize 300x300
CLAHE
Gaussian Blur
normalisasi input model
```

Yang harus disimpan untuk reproducibility:

```text
preprocessing_version
original_resolution
output_resolution
CLAHE parameters
normalization
timestamp
```

---

## 13. Image Quality Control

### FR-07 Image Quality Gate

Sebelum inferensi:

```text
Is image readable?
        │
  ┌─────┴─────┐
  NO          YES
  │            │
Reject       Infer
  │
Retake image
```

Minimal mendeteksi:

```text
file corrupt
resolution terlalu kecil
underexposure
overexposure
blur ekstrem
fundus ROI tidak ditemukan
```

Jika gagal:

```json
{
  "processable": false,
  "reason": "IMAGE_TOO_BLURRY"
}
```

Model tidak boleh secara diam-diam memberikan prediksi terhadap image yang jelas tidak layak.

---

## 14. AI Classification

### FR-08 EfficientNetB3 Inference

Input:

```text
300 × 300 fundus image
```

MVP classification:

```text
0 = No DR
1 = Mild
2 = Moderate
3 = Severe
4 = Proliferative DR
```

Contoh output:

```json
{
  "predictedClass": "Moderate",
  "classIndex": 2,
  "confidence": 0.81,
  "probabilities": {
    "No_DR": 0.02,
    "Mild": 0.07,
    "Moderate": 0.81,
    "Severe": 0.08,
    "Proliferative_DR": 0.02
  },
  "modelVersion": "efficientnetb3-dr-v1"
}
```

---

## 15. Risk Scoring

### FR-09 Risk Conversion

Risk score harus menjadi **layer terpisah dari AI prediction**.

```text
AI Class ≠ Risk Category
```

Contoh MVP mapping:

```text
No DR         → LOW
Mild          → LOW / MEDIUM
Moderate      → MEDIUM
Severe        → HIGH
Proliferative → HIGH
```

Sistem menyimpan keduanya:

```json
{
  "prediction": "Moderate",
  "riskLevel": "MEDIUM"
}
```

Dengan begitu jika aturan risk scoring berubah, model tidak perlu dilatih ulang.

---

## 16. Explainable AI

### FR-10 Grad-CAM

Untuk setiap inference sukses, AI engine menghasilkan:

```text
original fundus
processed fundus
Grad-CAM heatmap
overlay
```

Dashboard harus memberi disclaimer:

> Heatmap merupakan visualisasi pendukung interpretasi model dan bukan bukti diagnosis klinis.

---

## 17. AI Evaluation Module

Artefak evaluasi minimum:

```text
Accuracy
Precision
Recall / Sensitivity
F1-score
Confusion Matrix
PR Curve
ROC-AUC (optional/complementary)
```

Output training minimal:

```text
model.keras
training_history.json
metrics.json
confusion_matrix.png
classification_report.txt
config.json
```

---

## 18. Model Versioning

### FR-11 Reproducibility

Setiap inference harus mengetahui model yang digunakan.

Contoh:

```text
efficientnetb3-dr-v0.1
efficientnetb3-dr-v0.2
efficientnetb3-dr-v1.0
```

Database menyimpan:

```json
{
  "modelName": "EfficientNetB3",
  "modelVersion": "dr-v0.2",
  "preprocessingVersion": "prep-v1.0"
}
```

---

## 19. AI Service API

Health check:

```http
GET /health
```

Response:

```json
{
  "status": "healthy",
  "modelLoaded": true,
  "modelVersion": "dr-v0.1"
}
```

Inference:

```http
POST /predict
```

Response:

```json
{
  "success": true,
  "prediction": {
    "class": "Moderate",
    "confidence": 0.81
  },
  "risk": "MEDIUM",
  "gradcamPath": "...",
  "processingTimeMs": 1320
}
```

---

## 20. Backend Requirements

Backend harus bertindak sebagai **orchestrator**, bukan melakukan AI computation sendiri.

```text
Upload image
       ↓
Validate
       ↓
Create DB record
       ↓
Call AI Service
       ↓
Receive prediction
       ↓
Save prediction
       ↓
Update examination status
       ↓
Notify frontend
```

Suggested states:

```text
CREATED
IMAGE_RECEIVED
PREPROCESSING
INFERENCE
COMPLETED
FAILED
```

---

## 21. Database Model

### User

```javascript
{
  _id,
  email,
  passwordHash,
  role,
  createdAt
}
```

### Patient

```javascript
{
  _id,
  patientCode,
  demographics,
  createdAt
}
```

### Examination

```javascript
{
  _id,
  patientId,
  operatorId,
  deviceId,
  status,
  startedAt,
  completedAt
}
```

### FundusImage

```javascript
{
  _id,
  examinationId,
  eye,
  captureType,

  originalPath,
  processedPath,
  gradcamPath,

  qualityStatus,
  preprocessingVersion
}
```

### AIResult

```javascript
{
  examinationId,
  imageId,

  modelName,
  modelVersion,

  predictedClass,
  confidence,
  probabilities,

  riskLevel,

  inferenceTime,

  createdAt
}
```

---

## 22. Frontend Requirements

### FR-12 Dashboard

Minimal screens:

```text
/login
/dashboard
/patients
/patients/[patientId]
/examinations/new
/examinations/[id]
/devices
/reports
```

Dashboard utama menampilkan:

```text
Total examination
Recent examinations
Completed / failed scans
Device status
Recent high-risk result
```

---

## 23. Examination Result Screen

Contoh:

```text
Patient ID     : PT-00027
Eye            : Right
Date           : 11 Sep 2026
Status         : Completed

┌──────────────────────────────────────────────┐
│                                             │
│             FUNDUS IMAGE                    │
│                                             │
└──────────────────────────────────────────────┘

AI Screening
──────────────────────────
Prediction     Moderate DR
Confidence     81%
Risk           MEDIUM

No DR              2%
Mild               7%
Moderate          81%
Severe             8%
Proliferative      2%

┌──────────────────────────────────────────────┐
│               GRAD-CAM                      │
└──────────────────────────────────────────────┘

[ Generate Report ]
```

Disclaimer:

> Hasil merupakan skrining awal berbasis AI dan tidak menggantikan diagnosis tenaga medis.

---

## 24. PDF Report

### FR-13 Generate Report

PDF minimal berisi:

```text
Examination ID
Anonymous patient ID
Date/time
Eye
Fundus image
Processed image
AI prediction
Confidence
Risk level
Probability distribution
Grad-CAM
Model version
Disclaimer
```

---

## 25. Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-01 | End-to-end processing latency | `< 15 s/image` |
| NFR-02 | Backend API communication | HTTPS |
| NFR-03 | Credentials | Tidak di-hardcode |
| NFR-04 | Environment config | `.env` |
| NFR-05 | Accessibility | WCAG AA target |
| NFR-06 | Responsive UI | Desktop/tablet minimum |
| NFR-07 | Fault handling | AI/server failure menghasilkan error state |
| NFR-08 | Reproducibility | Model + preprocessing version tersimpan |
| NFR-09 | Sensitive data | Minimum personally identifiable information |
| NFR-10 | Raw image retention | Original file tidak dimodifikasi |
| NFR-11 | Modular architecture | AI/backend/frontend terpisah |
| NFR-12 | Auditability | Prediction dan model version dapat dilacak |

---

## 26. Error Handling

| Code | Kondisi |
|---|---|
| `INVALID_IMAGE` | Format tidak didukung |
| `IMAGE_TOO_SMALL` | Resolusi tidak cukup |
| `IMAGE_TOO_BLURRY` | Blur melewati batas |
| `FUNDUS_NOT_FOUND` | ROI fundus gagal |
| `AI_UNAVAILABLE` | AI service mati |
| `MODEL_LOAD_FAILED` | Model gagal load |
| `INFERENCE_FAILED` | Prediction error |
| `DEVICE_OFFLINE` | Kamera tidak terhubung |
| `UPLOAD_FAILED` | Image gagal terkirim |
| `REPORT_FAILED` | PDF gagal dibuat |

Contoh user-facing message:

> Citra tidak dapat dianalisis karena kualitas gambar terlalu rendah. Silakan lakukan pengambilan gambar ulang.

---

## 27. Repository Structure

```text
AI-Fundus-Camera-Despro-6-DTE-FTUI/
│
├── apps/
│   ├── frontend/
│   │   └── Next.js
│   │
│   └── backend/
│       └── Node.js + Express
│
├── services/
│   └── ai-service/
│       ├── app/
│       │   ├── api/
│       │   ├── inference/
│       │   ├── preprocessing/
│       │   └── gradcam/
│       │
│       ├── training/
│       ├── evaluation/
│       ├── models/
│       └── tests/
│
├── firmware/
│   └── esp32/
│
├── shared/
│   └── schemas/
│
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── model/
│   └── testing/
│
├── scripts/
│
├── .env.example
├── .gitignore
├── README.md
└── docker-compose.yml
```

Fokus PIC software/AI:

```text
services/ai-service/
```

---

## 28. Dataset Architecture

Dataset tidak disarankan di-commit seluruhnya ke GitHub.

Struktur lokal:

```text
data/
├── raw/
├── interim/
├── processed/
└── splits/
    ├── train.csv
    ├── validation.csv
    └── test.csv
```

`.gitignore`:

```text
data/raw/
data/interim/
data/processed/
*.keras
*.h5
.env
```

Yang masuk Git:

```text
dataset preparation script
split script
preprocessing code
requirements
training config
evaluation code
README dataset
```

---

## 29. Training Pipeline

```text
Acquire dataset
      ↓
Validate labels
      ↓
Remove corrupted images
      ↓
EDA
      ↓
Train / Validation / Test split
      ↓
Preprocessing
      ↓
Class weighting / balancing
      ↓
EfficientNetB3
      ↓
Head training
      ↓
Fine tuning
      ↓
Evaluation
      ↓
Grad-CAM validation
      ↓
Export best model
```

Catatan penting: dataset open-source seperti DRIVE, STARE, HRF, dan Messidor tidak otomatis memiliki fungsi dan label yang sama. Dataset tidak boleh digabung begitu saja hanya karena semuanya berisi citra fundus.

---

## 30. Definition of MVP

Software MVP dianggap selesai apabila demonstrasi berikut bisa dilakukan:

```text
1. Operator membuka dashboard.
2. Pasien dummy dibuat.
3. Examination baru dibuat.
4. Sebuah fundus image dikirim ke backend.
5. Backend menyimpan original image.
6. AI service menerima image.
7. Preprocessing berjalan otomatis.
8. EfficientNetB3 melakukan inference.
9. Probability dan predicted class dikembalikan.
10. Risk level dihitung.
11. Grad-CAM dihasilkan.
12. Semua hasil masuk database.
13. Result muncul di dashboard.
14. PDF dapat dibuat.
```

---

## 31. Out of Scope MVP

```text
Full clinical validation
Diagnosis otomatis tanpa dokter
9 model penyakit sekaligus
Mobile application
Integration ke SIMRS
DICOM/PACS production integration
Multi-hospital architecture
Production-grade cloud scaling
Automated treatment recommendation
```

---

## 32. Software Success Metrics

### System

```text
Image upload success      ≥ 95% pada test environment
Valid request success     100%
Corrupted image rejected  100%
Inference pipeline        berjalan tanpa manual preprocessing
Report generation         berhasil untuk completed examination
```

### AI

```text
Accuracy
Macro Precision
Macro Recall
Macro F1
Per-class Recall
Confusion Matrix
```

Karena aplikasi screening, **recall/sensitivity terutama pada kelas penyakit lebih penting untuk diperhatikan daripada mengejar accuracy saja**.

### Performance

```text
Target E2E:
Capture/upload → dashboard result ≤ 15 s
```

### UX

```text
Operator dapat melakukan:
Create patient
→ create examination
→ capture/upload
→ view result
→ generate PDF

tanpa terminal/manual database modification
```

---

## 33. Prioritas Product Backlog

| Priority | Feature | Deliverable |
|---|---|---|
| **P0** | Dataset preparation | Dataset siap train |
| **P0** | Preprocessing pipeline | Script modular |
| **P0** | EfficientNetB3 baseline | Baseline model |
| **P0** | Evaluation | Metrics + confusion matrix |
| **P0** | AI inference service | `/predict` |
| **P0** | Backend image upload | Upload endpoint |
| **P0** | Database examination | Data tersimpan |
| **P0** | Basic dashboard | Result terlihat |
| **P1** | Grad-CAM | Heatmap |
| **P1** | PDF report | Automatic report |
| **P1** | Device status | MQTT |
| **P1** | Image quality gate | Reject poor image |
| **P1** | Authentication | Operator login |
| **P2** | MediaPipe positioning | Acquisition assistant |
| **P2** | Vascular analysis | CRAE/CRVE etc. |
| **P3** | 9-category architecture | Multi-model expansion |

---

## 34. Development Sequence Setelah Pekan 2

Urutan implementasi:

| Pekan | Fokus Software | Output Minimum |
|---|---|---|
| **Pekan 3** | Dataset + preprocessing | Dataset terstruktur + preprocessing reproducible |
| **Pekan 4** | EfficientNetB3 baseline | Model dapat training dan predict |
| **Pekan 5** | Fine-tuning + evaluation | Metrics + confusion matrix + best model |
| **Pekan 6** | Grad-CAM + inference pipeline | `predict.py` lengkap |
| **Pekan 7** | AI REST service | FastAPI/service endpoint |
| **Pekan 8** | Backend integration | Node → AI berjalan |
| **Pekan 9** | MongoDB + examination flow | Prediction tersimpan |
| **Pekan 10** | Dashboard | Examination/result UI |
| **Pekan 11** | Hardware upload + MQTT | ESP32 → backend |
| **Pekan 12** | PDF + system integration | Full E2E |
| **Pekan 13+** | Testing & optimization | Test evidence + final metrics |

Jadwal persisnya perlu diselaraskan kembali dengan SAP Despro 2 terbaru.

---

## 35. Definition of Done Despro 2 Software

Bagian software dianggap selesai apabila:

> **Prototype kamera dapat mengirim sebuah fundus image ke sistem, backend menerima image tersebut, AI melakukan preprocessing dan klasifikasi menggunakan EfficientNetB3, sistem menghasilkan prediction, confidence, risk score dan Grad-CAM, hasil disimpan ke database, ditampilkan pada dashboard dan dapat diekspor menjadi PDF, dengan keseluruhan proses terdokumentasi dan dapat direproduksi.**

---

## 36. Target Paling Dekat

Karena posisi saat ini baru selesai **Pekan 2**, milestone berikutnya adalah:

### Pekan 3: Dataset & AI Baseline Preparation

Output akhir pekan:

```text
- struktur dataset sudah ada
- distribusi kelas diketahui
- script preprocessing dapat dijalankan
- output before/after preprocessing tersedia
- requirements.txt selesai
- satu notebook/script dapat memuat satu batch citra
- baseline pipeline siap digunakan untuk EfficientNetB3
```

Target ini menjadi fondasi agar Pekan 4 dapat langsung masuk ke training model tanpa kehilangan waktu untuk mencari arah pengembangan.
