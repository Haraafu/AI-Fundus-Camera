# Training gabungan EyePACS, APTOS, dan Mendeley

## Cakupan

Satu backbone EfficientNetB3 dengan satu keluaran softmax lima kelas DR. Urutan keluaran tetap `Mild,Moderate,No_DR,Proliferate_DR,Severe`, sama dengan kontrak aplikasi. Penambahan sumber dataset tidak otomatis membuat model mengenali penyakit lain.

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
python scripts/ml/train_combined_dr.py
```

Unduhan dan persiapan lokal memerlukan laptop tetap menyala. Training penuh sebaiknya dijalankan pada GPU, bukan TensorFlow CPU native Windows. Perintah training lokal di atas adalah entry point, bukan rekomendasi menjalankan fine tuning penuh pada CPU.

Hasil persiapan berada di `data/combined-dr-v1/`: train.csv, validation.csv, test.csv, audit.json, conflicts.json, dan gambar hasil preprocessing. Gunakan direktori output baru saat mengulang persiapan agar audit tidak tertimpa.

Hasil training berada di `models/combined_dr_b3_v1/`, termasuk best.keras, report.json, riwayat, prediksi per gambar, metrik keseluruhan, dan metrik per sumber. Metrik per sumber dapat memiliki anggota tumpang tindih ketika gambar memiliki lebih dari satu asal, sehingga bukan tiga evaluasi independen.

Training menggunakan sampling kelas campuran serta checkpoint berdasarkan validation macro F1 dari pipeline V2. Belum ada penyeimbangan berdasarkan sumber. Distribusi sumber dan performa per sumber harus ditinjau untuk memastikan EyePACS tidak mendominasi semua kesimpulan.

## Batas evaluasi

Test historis sudah pernah diperiksa dan tidak merupakan test eksternal yang baru. Audit duplikat atau konflik dapat mengubah anggota holdout gabungan, sehingga skor gabungan tidak boleh langsung dibandingkan dengan skor lama tanpa menyamakan daftar gambar evaluasi. Target di atas 90% masih target penelitian, bukan hasil. Model aplikasi tidak diganti otomatis oleh script training.
