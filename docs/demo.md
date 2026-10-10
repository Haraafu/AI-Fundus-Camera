# Menjalankan dan merekam demo

Demo menunjukkan alur perangkat lunak dengan citra dataset. Klien ESP32-SIM adalah simulasi pengirim kamera, bukan bukti pengambilan citra dari hardware fisik. Modul PDF dari branch Report telah terintegrasi. Pada hasil pemeriksaan yang selesai, klik Unduh PDF untuk mengekspor hasil dan overlay Grad-CAM yang tersedia.

## Menjalankan layanan

Jalankan dari root repository. Python yang dipilih harus memiliki TensorFlow dan seluruh dependensi layanan AI. Pada komputer pengembangan saat ini, TensorFlow tersedia pada Python sistem, bukan `.venv`.

### MongoDB Atlas

Pastikan IP jaringan yang sedang dipakai sudah diizinkan di Atlas. Jangan mengubah atau menampilkan kredensial saat merekam.

Terminal pertama:

```powershell
python services/ai-service/app.py
```

Terminal kedua:

```powershell
npm run backend
```

Periksa `http://127.0.0.1:8000/ready`. Nilai `ready` dan `modelLoaded` harus `true`, dengan `isMock=false`. Dashboard berada di `http://127.0.0.1:3001/dashboard` dan menampilkan `MONGODB · Model aktual` ketika konfigurasi Atlas digunakan.

### Demo tanpa jaringan

Jika Atlas tidak dapat diakses, hentikan layanan yang memakai port 3001 dan 8000, kemudian jalankan:

```powershell
npm run demo
```

Perintah ini secara eksplisit menggunakan model aktual dan database SQLite terpisah di `data/demo/`. Konfigurasi Atlas dalam `.env` tetap tersimpan. UI akan menampilkan `SQLITE`, sehingga pilihan penyimpanan terlihat jelas. Set variabel `PYTHON` jika executable Python perlu dipilih secara khusus. Jangan menjalankan mode ini bersamaan dengan layanan pada port yang sama.

## Urutan rekaman, sekitar 3–5 menit

1. Buka dashboard dan jelaskan bahwa sistem merupakan prototipe skrining DR lima kelas.
2. Tunjukkan halaman pasien dan riwayat pemeriksaan. Gunakan kode anonim demonstrasi.
3. Pada halaman pemeriksaan baru, unggah citra fundus dataset. Setelah selesai, perlihatkan citra asli, hasil prapemrosesan, probabilitas, dan versi model.
4. Gulir ke Grad-CAM. Jelaskan bahwa warna menunjukkan kontribusi relatif area citra terhadap kelas yang diprediksi. Peta ini bukan segmentasi lesi.
5. Buka halaman Perangkat. Pada terminal terpisah, jalankan perintah berikut, lalu kembali ke halaman perangkat.

```powershell
npm run device:mock -- "colored_images/Severe/299086c6d1b5.png" DEMO-RECORDING ESP32-SIM-01 --watch
```

6. Tunjukkan riwayat `IDLE`, `READY`, `CAPTURING`, `UPLOADING`, lalu `READY`. Klik **Lihat pemeriksaan** untuk membuka hasil yang berasal dari simulasi pengirim. Metadata hasil menampilkan device ID.
7. Jika diperlukan, perlihatkan dokumen hasil di Atlas. Tampilkan data demonstrasi saja, tanpa URL koneksi, token, atau halaman kredensial.

Pada contoh `299086c6d1b5.png`, model aktif memprediksi Severe dengan confidence sekitar 36,8%. Jelaskan keterbatasan tersebut apa adanya. Confidence bukan akurasi keseluruhan model. Kategori HIGH mengikuti aturan kelas DR prototipe, bukan sembilan kategori risiko klinis yang telah tervalidasi.

## Pemeriksaan sebelum merekam

- Layanan AI siap dan dashboard dapat dibuka.
- Model aktual terlihat jelas pada indikator penyimpanan di header.
- Pada pemeriksaan baru, status COMPLETED dan Grad-CAM AVAILABLE berhasil diperoleh.
- Citra asli, processed, dan Grad-CAM dapat dimuat setelah halaman dibuka ulang.
- Klien simulasi tetap berjalan dengan `--watch` jika status online ingin ditampilkan.
- Perbesar jendela peramban, tutup halaman kredensial, dan gunakan kode pasien demonstrasi.

Pemeriksaan lama sebelum penambahan Grad-CAM tidak memiliki visualisasi. Buat pemeriksaan baru untuk demo. Jika Grad-CAM tidak tersedia, sistem memberi status UNAVAILABLE tanpa membuat visualisasi palsu atau mengganti prediksi dengan mock.

## Ekspor PDF

Pasang dependensi dengan `python -m pip install -r services/pdf_generator/requirement.txt`. Backend menjalankan CLI milik modul pelaporan secara otomatis. `REPORT_PYTHON` dapat menunjuk interpreter lain yang sudah memiliki ReportLab, dengan fallback ke `PYTHON` atau `python` pada PATH.

Laporan memuat kode pasien, mata, tanggal, citra hasil prapemrosesan, overlay Grad-CAM, probabilitas lima kelas, versi model, dan aturan risiko. Pemeriksaan lama tanpa Grad-CAM tetap dapat diekspor dengan placeholder. Hasil mock ditandai secara eksplisit. Sembilan biomarker belum dihitung. PDF dibuat saat diminta tanpa mengubah hasil atau menambah salinan laporan ke MongoDB.
