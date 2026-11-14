# Training gabungan EyePACS, APTOS, dan Mendeley

## Cakupan

Eksperimen berikutnya memakai satu backbone EfficientNetB3 dengan keluaran softmax dua kelas, berurutan `No DR`, `DR`. Grade 0 (No DR) menjadi No DR, sedangkan grade 1 sampai 4 menjadi DR. No DR berarti tidak ada DR menurut label dataset, bukan jaminan tidak ada penyakit mata lain. Dataset penyakit selain DR tetap dikeluarkan.

Manifest biner diturunkan dari audit lima kelas yang sudah ada. Identitas citra, pembagian subset, dan pengecualian konflik tetap dipertahankan. Grade awal disimpan dalam kolom `dr_grade`. Tidak ada data yang dipindahkan antar-subset atau citra konflik yang dimasukkan kembali.

Checkpoint aplikasi saat ini masih lima kelas. Model biner yang dihasilkan memerlukan penyesuaian kontrak layanan AI, aturan risiko, dashboard, dan PDF sebelum integrasi. Persiapan ini tidak mengganti checkpoint aplikasi secara otomatis.

## Sumber Mendeley

Islam, Md Samiul; Jahan, Israt (2025), *Diabetic Retinopathy and Retinal Diseases Fundus Image Dataset*, Mendeley Data, V1, DOI `10.17632/6ry9n79gb4.1`, CC BY 4.0. Halaman sumber: https://data.mendeley.com/datasets/6ry9n79gb4/1

Indeks ZIP resmi memiliki 22.453 entri gambar. Deskripsi publik menyebut 22.454. Lima folder yang dipilih berisi 14.292 gambar sebelum audit:

| Folder | Grade | Jumlah |
|---|---:|---:|
| 11.Normal Fundus | 0 | 3.061 |
| 3.Mild DR | 1 | 2.441 |
| 4.Moderate DR | 2 | 5.368 |
| 5.Severe DR | 3 | 1.918 |
| 6.Proliferate DR | 4 | 1.504 |

Penyakit selain DR dikeluarkan. Advanced PDR dan Very Severe NPDR juga dikeluarkan sampai kebijakan pemetaan label disepakati dan ditinjau. Normal Fundus menjadi kelas No_DR untuk eksperimen DR ini, bukan bukti bahwa seluruh penyakit retina dapat disaring.

## Audit asal gambar

Sebanyak 12.030 nama dalam lima folder tersebut cocok dengan ID EyePACS lokal, termasuk nama turunan augmentasi. Pada 296 file, grade folder berbeda dari label EyePACS dengan ID yang sama. Ini merupakan kandidat tumpang tindih berdasarkan nama. Kesamaan visual masih harus diperiksa.

Pipeline mengelompokkan ID sumber, SHA-256 file, hash piksel terdekode, hash piksel preprocessing, dan perceptual hash dengan jarak Hamming maksimal 4. Kelompok dengan label bertentangan dikeluarkan. Duplikat konsisten hanya dipakai satu kali. Pendekatan perceptual hash bersifat konservatif, dapat menggabungkan citra yang mirip, dan tidak menjamin semua transformasi terdeteksi.

Holdout EyePACS dan APTOS yang sudah tersedia dipertahankan sejauh memungkinkan. Jika suatu kelompok menyentuh holdout, prioritasnya test, kemudian validation, lalu train. Pasien EyePACS dikelompokkan menggunakan ID pasien. ID dari nama turunan Mendeley digunakan sebagai petunjuk konservatif untuk mencegah pemisahan mata atau augmentasi terkait. Identitas pasien APTOS dan citra Mendeley lain belum terverifikasi. Pemisahan ini tidak boleh disebut patient-level penuh untuk ketiga sumber.

## Menjalankan

Dari root proyek, memakai Python sistem yang memiliki dependensi AI, pandas, dan scikit-learn:

```powershell
python scripts/ml/download_mendeley.py
python scripts/ml/prepare_combined_dr.py
python scripts/ml/prepare_binary_dr.py
python scripts/ml/train_combined_binary.py
```

Unduhan dan persiapan lokal memerlukan laptop tetap menyala. Training penuh sebaiknya dijalankan pada GPU, bukan TensorFlow CPU native Windows. Perintah training lokal di atas adalah entry point, bukan rekomendasi menjalankan fine tuning penuh pada CPU.

Hasil persiapan berada di `data/combined-dr-v1/`: train.csv, validation.csv, test.csv, audit.json, conflicts.json, dan gambar hasil preprocessing. Gunakan direktori output baru saat mengulang persiapan agar audit tidak tertimpa.

Manifest biner berada di `data/combined-dr-binary-v1/` dan merujuk berkas citra yang sudah tersedia. Hasil training biner berada di `models/combined_dr_binary_b3_v1/`, termasuk best.keras, report.json, riwayat, prediksi per gambar, metrik keseluruhan, dan metrik per sumber. Skrip `train_combined_dr.py` tetap tersedia untuk eksperimen lama lima kelas, bukan entry point eksperimen biner.

Kelas positif adalah DR dengan batas keputusan 0,5. Evaluasi mencakup akurasi, precision dan F1 kelas positif, sensitivitas, spesifisitas, macro F1, ROC-AUC, average precision, serta confusion matrix. Batas keputusan tidak ditentukan dari data test. Checkpoint dipilih berdasarkan macro F1 validasi. Target di atas 90% tidak dijamin oleh perubahan jumlah kelas.

Metrik per sumber dapat memiliki anggota tumpang tindih ketika gambar memiliki lebih dari satu asal, sehingga bukan tiga evaluasi independen.

Training menggunakan sampling kelas campuran serta checkpoint berdasarkan validation macro F1 dari pipeline V2. Belum ada penyeimbangan berdasarkan sumber. Distribusi sumber dan performa per sumber harus ditinjau untuk memastikan EyePACS tidak mendominasi semua kesimpulan.

## Job GPU Kaggle privat

`python scripts/ml/package_binary_kaggle.py` menyiapkan arsip citra dan manifest dengan path relatif di `data/kaggle-combined-binary-dataset/`, serta kode mandiri dan metadata kernel di `data/kaggle-combined-binary-training/`. Tidak ada kredensial aplikasi yang dikemas.

Dataset Kaggle privat: `falahandhesryo/combined-dr-binary-audited-v1`. Kernel privat: `falahandhesryo/combined-dr-efficientnetb3-binary-v1`. Dataset harus selesai diproses sebelum kernel dijalankan. Job menolak berjalan tanpa GPU dan mempertahankan kelas keluaran `No DR`, `DR`. Maksimum pelatihan adalah 8 epoch head dan 20 epoch fine tuning, dengan early stopping berdasarkan macro F1 validasi. Hasil tersimpan di output kernel pada direktori `combined_dr_binary_b3_v1/`.

## Batas evaluasi

Test historis sudah pernah diperiksa dan tidak merupakan test eksternal yang baru. Audit duplikat atau konflik dapat mengubah anggota holdout gabungan, sehingga skor gabungan tidak boleh langsung dibandingkan dengan skor lama tanpa menyamakan daftar gambar evaluasi. Target di atas 90% masih target penelitian, bukan hasil. Model aplikasi tidak diganti otomatis oleh script training.

## Hasil evaluasi model biner

Job Kaggle versi 3 selesai. Pada 5.553 citra uji gabungan dengan ambang 0,5, hasilnya sebagai berikut.

| Metrik | Nilai |
| --- | ---: |
| Akurasi | 83,94% |
| Precision kelas DR | 73,56% |
| Sensitivitas DR | 60,54% |
| Spesifisitas | 92,26% |
| F1 kelas DR | 66,42% |
| Macro F1 | 77,93% |
| ROC-AUC | 0,853 |

| Label acuan | Prediksi No DR | Prediksi DR |
| --- | ---: | ---: |
| No DR | 3.779 | 317 |
| DR | 575 | 882 |

Sensitivitas bervariasi menurut asal citra: EyePACS 52,14%, APTOS 95,97%, dan Mendeley 53,20%. Kelompok asal dapat tumpang tindih, sehingga angka tersebut tidak mewakili tiga set uji independen. Akurasi latih 87,72% dan validasi 83,86%, tetapi selisih itu saja tidak cukup untuk menilai generalisasi pada citra kamera prototipe.

Checkpoint biner dipasang pada aplikasi lokal untuk pengujian prototipe. Pada ambang saat ini, 575 dari 1.457 citra DR terlewat dan hasil belum memenuhi target penelitian. Langkah berikutnya adalah menilai pertukaran sensitivitas dan spesifisitas pada data validasi sebelum menguji ambang yang dikunci pada data evaluasi terpisah. Hasil sumber berasal dari `data/kaggle-results/combined-binary-v1/completed/combined_dr_binary_b3_v1/report.json`.
