const main = document.querySelector('#main');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const labels = { No_DR: 'Tidak terdeteksi DR', Mild: 'Mild DR', Moderate: 'Moderate DR', Severe: 'Severe DR', Proliferative_DR: 'Proliferative DR' };
const badge = value => `<span class="badge ${escape(value)}">${escape(value)}</span>`;
async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${body.error?.code || response.status}: ${body.error?.message || 'Request gagal'}`);
  return body;
}
function errorBox(error) { return `<div class="error" role="alert">${escape(error.message)}</div>`; }
function heading(title, subtitle, action = '') { return `<div class="page-head"><div><div class="eyebrow">FUNDUS SCREENING</div><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></div>${action}</div>`; }
function examTable(exams) {
  if (!exams.length) return '<div class="empty">Belum ada pemeriksaan. Mulai dengan menambahkan pasien atau pemeriksaan baru.</div>';
  return `<div class="scroll"><table><thead><tr><th>PASIEN</th><th>WAKTU</th><th>MATA</th><th>STATUS</th><th>HASIL / RISIKO</th><th></th></tr></thead><tbody>${exams.map(e => `<tr><td><a href="/patients/${encodeURIComponent(e.patientId)}">${escape(e.patientId)}</a></td><td>${escape(date(e.createdAt))}</td><td>${e.eye === 'LEFT' ? 'Kiri' : 'Kanan'}</td><td>${badge(e.status)}</td><td>${e.result ? `${escape(labels[e.result.predictedClass])} ${badge(e.result.riskLevel)}${e.result.isMock ? ' · MOCK' : ''}` : '—'}</td><td><div class="row-actions"><a href="/examinations/${encodeURIComponent(e.examinationId)}">Lihat →</a><button type="button" class="danger compact" data-delete-exam="${escape(e.examinationId)}" data-patient="${escape(e.patientId)}" ${["IMAGE_RECEIVED", "PROCESSING"].includes(e.status) ? "disabled" : ""}>Hapus</button></div></td></tr>`).join('')}</tbody></table></div>`;
}
async function dashboard() {
  const exams = await api('/api/examinations');
  const patients = await api('/api/patients');
  main.innerHTML = heading('Overview', 'Pantau pemeriksaan retina dan hasil skrining terbaru.', '<a class="button" href="/examinations/new">+ Pemeriksaan baru</a>') +
    `<div class="cards"><div class="card"><div class="label">Total pemeriksaan</div><strong>${exams.length}</strong><small>Seluruh pemeriksaan tersimpan</small></div><div class="card highlight"><div class="label">Selesai</div><strong>${exams.filter(e => e.status === 'COMPLETED').length}</strong><small>Hasil tersedia untuk ditinjau</small></div><div class="card"><div class="label">Gagal</div><strong>${exams.filter(e => e.status === 'FAILED').length}</strong><small>Lihat detail error pemeriksaan</small></div><div class="card"><div class="label">Pasien</div><strong>${patients.length}</strong><small>Identitas menggunakan kode anonim</small></div></div><section class="panel"><div class="panel-head"><h2>Pemeriksaan terbaru</h2><a href="/patients">Semua pasien →</a></div>${examTable(exams.slice(0, 12))}</section><section class="panel"><h2>Hasil dengan risiko tinggi</h2>${examTable(exams.filter(e => e.result?.riskLevel === 'HIGH').slice(0, 6))}</section>`;
}
async function patientsPage(patientId) {
  const patients = await api('/api/patients');
  if (patientId) {
    const patient = patients.find(p => p.patientId === patientId);
    if (!patient) throw new Error('Pasien tidak ditemukan.');
    const exams = await api(`/api/examinations?patientId=${encodeURIComponent(patientId)}`);
    main.innerHTML = heading(patientId, `Terdaftar ${date(patient.createdAt)}`, `<a class="button" href="/examinations/new?patientId=${encodeURIComponent(patientId)}">+ Pemeriksaan baru</a>`) + `<section class="panel"><h2>Riwayat pemeriksaan</h2>${examTable(exams)}</section>`;
    return;
  }
  main.innerHTML = heading('Pasien', 'Kode anonim dan riwayat pemeriksaan dalam satu tempat.') + `<section class="panel narrow"><h2>Tambahkan pasien</h2><form id="patient-form"><div class="form-grid"><div><label for="patient-code">Kode pasien anonim</label><input id="patient-code" pattern="[A-Za-z0-9_-]{1,64}" maxlength="64" placeholder="PT-00001" required></div><div style="align-self:end"><button>Simpan pasien</button></div></div><div id="patient-error"></div></form></section><section class="panel"><div class="panel-head"><h2>Daftar pasien (${patients.length})</h2><input id="search" aria-label="Cari kode pasien" placeholder="Cari kode pasien…"></div><div id="patient-list"></div></section>`;
  const render = query => {
    const filtered = patients.filter(p => p.patientId.toLowerCase().includes(query.toLowerCase()));
    document.querySelector('#patient-list').innerHTML = filtered.length ? `<table><thead><tr><th>KODE PASIEN</th><th>TERDAFTAR</th><th></th></tr></thead><tbody>${filtered.map(p => `<tr><td>${escape(p.patientId)}</td><td>${escape(date(p.createdAt))}</td><td><a href="/patients/${encodeURIComponent(p.patientId)}">Riwayat →</a></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Belum ada pasien yang cocok.</div>';
  };
  render('');
  document.querySelector('#search').addEventListener('input', e => render(e.target.value));
  document.querySelector('#patient-form').addEventListener('submit', async e => {
    e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true;
    try { const patient = await api('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId: document.querySelector('#patient-code').value.trim() }) }); location.href = `/patients/${encodeURIComponent(patient.patientId)}`; }
    catch (error) { document.querySelector('#patient-error').innerHTML = errorBox(error); button.disabled = false; }
  });
}
async function newExamination() {
  const patients = await api('/api/patients');
  const selected = new URLSearchParams(location.search).get('patientId') || '';
  main.innerHTML = heading('Pemeriksaan baru', 'Pilih pasien, mata, dan foto fundus untuk menjalankan analisis.') + `<section class="panel narrow"><form id="exam-form"><div class="form-grid"><div class="field"><label for="patient">Kode pasien anonim</label><input id="patient" list="patients" pattern="[A-Za-z0-9_-]{1,64}" maxlength="64" value="${escape(selected)}" placeholder="PT-00001" required><datalist id="patients">${patients.map(p => `<option value="${escape(p.patientId)}"></option>`).join('')}</datalist></div><div class="field"><label for="eye">Mata</label><select id="eye"><option value="RIGHT">Kanan</option><option value="LEFT">Kiri</option></select></div><div class="field"><label for="capture">Posisi pengambilan</label><select id="capture"><option value="MACULA_CENTERED">Macula centered</option><option value="OPTIC_DISC_CENTERED">Optic disc centered</option></select></div><div class="field"><label for="image">Foto fundus</label><input id="image" type="file" accept="image/png,image/jpeg" required><p class="help">PNG/JPEG · maksimum 10 MiB</p></div></div><img id="preview" class="preview" alt="Preview foto fundus" hidden><div id="upload-status" role="status"></div><button id="submit">Mulai analisis</button></form></section>`;
  let previewUrl;
  document.querySelector('#image').addEventListener('change', e => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const file = e.target.files[0], preview = document.querySelector('#preview');
    preview.hidden = !file;
    if (file) { previewUrl = URL.createObjectURL(file); preview.src = previewUrl; }
  });
  document.querySelector('#exam-form').addEventListener('submit', async e => {
    e.preventDefault(); const button = document.querySelector('#submit'), status = document.querySelector('#upload-status');
    const file = document.querySelector('#image').files[0];
    if (file.size > 10 * 1024 * 1024) { status.innerHTML = errorBox(new Error('Ukuran gambar melebihi 10 MiB.')); return; }
    button.disabled = true;
    let exam;
    try {
      status.innerHTML = '<div class="notice">Memeriksa kesiapan layanan AI…</div>';
      const system = await api('/api/system');
      if (!system.aiReady) throw new Error('Layanan AI belum siap. Pastikan layanan model berjalan, lalu coba lagi. Pemeriksaan belum dibuat.');
      status.innerHTML = '<div class="notice">Membuat pemeriksaan…</div>';
      exam = await api('/api/examinations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId: document.querySelector('#patient').value.trim(), eye: document.querySelector('#eye').value, captureType: document.querySelector('#capture').value }) });
      status.innerHTML = '<div class="notice">Foto sedang diproses dan dianalisis. Tunggu sampai hasil tersedia.</div>';
      const form = new FormData(); form.append('image', file);
      await api(`/api/examinations/${exam.examinationId}/images`, { method: 'POST', body: form });
      location.href = `/examinations/${exam.examinationId}`;
    } catch (error) {
      status.innerHTML = errorBox(error) + (exam ? `<p><a href="/examinations/${exam.examinationId}">Lihat status pemeriksaan →</a></p>` : '');
      if (exam) { button.textContent = 'Buat pemeriksaan baru'; button.onclick = () => location.reload(); button.type = 'button'; }
      button.disabled = false;
    }
  });
}
function explanationPanel(exam, id) {
  const cam = exam.result?.explanation;
  if (!exam.result) return '';
  if (cam?.status !== 'AVAILABLE') return `<section class="panel"><h2>Visualisasi Grad-CAM</h2><p>${exam.result.isMock ? 'Grad-CAM tidak dibuat untuk prediksi mock.' : 'Visualisasi tidak tersedia untuk pemeriksaan ini. Jalankan pemeriksaan baru untuk menghasilkan Grad-CAM.'}</p></section>`;
  return `<section class="panel"><div class="panel-head"><h2>Visualisasi Grad-CAM</h2><span class="badge LOW">${escape(cam.targetClass)}</span></div><div class="image-grid"><figure><img src="/api/examinations/${encodeURIComponent(id)}/images/gradcam" alt="Overlay Grad-CAM pada citra hasil prapemrosesan"><figcaption>Overlay perhatian model</figcaption></figure><figure><img src="/api/examinations/${encodeURIComponent(id)}/images/heatmap" alt="Peta aktivasi Grad-CAM"><figcaption>Aktivasi rendah (biru) hingga tinggi (merah)</figcaption></figure></div><p class="help">Peta ini menunjukkan kontribusi relatif area citra terhadap kelas yang diprediksi. Bukan penanda lesi atau konfirmasi diagnosis. Koordinat mengikuti citra hasil prapemrosesan.</p><details><summary>Detail metode</summary><p class="help">${escape(cam.method)} · ${escape(cam.version)} · ${escape(cam.layer)}</p></details></section>`;
}
async function devicesPage() {
  const devices = await api('/api/devices');
  main.innerHTML = heading('Perangkat', 'Pantau koneksi kamera dan pengiriman citra melalui jaringan lokal.') +
    `<div class="notice">ESP32-SIM menandai klien simulasi. Status dianggap aktif selama 60 detik sejak pembaruan terakhir.</div>` +
    (devices.length ? devices.map(d => `<section class="panel"><div class="panel-head"><h2>${escape(d.deviceId)}</h2>${badge(d.status)}</div><p>${d.isOnline ? 'Terhubung' : 'Tidak aktif'} · Pembaruan terakhir ${escape(date(d.lastSeen))}</p>${d.message ? errorBox(new Error(d.message)) : ''}${d.examinationId ? `<a class="button secondary" href="/examinations/${encodeURIComponent(d.examinationId)}">Lihat pemeriksaan</a>` : ''}<ol class="timeline">${d.statusHistory.map(s => `<li>${escape(s.status)}<time>${escape(date(s.timestamp))}</time></li>`).join('')}</ol></section>`).join('') : '<section class="panel empty">Belum ada perangkat yang mengirim status. Jalankan klien simulasi atau hubungkan kamera.</section>');
  setTimeout(() => { if (location.pathname === '/devices') devicesPage().catch(error => { main.innerHTML = errorBox(error); }); }, 5000);
}
async function examination(id) {
  const exam = await api(`/api/examinations/${encodeURIComponent(id)}`), result = exam.result;
  main.innerHTML = heading('Hasil pemeriksaan', `${exam.patientId} · Mata ${exam.eye === 'LEFT' ? 'kiri' : 'kanan'} · ${date(exam.createdAt)}`, `<a class="button secondary" href="/patients/${encodeURIComponent(exam.patientId)}">Riwayat pasien</a>`) + `<div class="notice">Status ${badge(exam.status)} · ${escape(exam.captureType)}${result?.isMock ? ' · Hasil MOCK: prediksi dummy untuk pengujian.' : ''}</div>` + (exam.error ? errorBox(new Error(`${exam.error.code}: ${exam.error.message}`)) : '') + `<div class="results"><div><section class="panel"><h2>Citra fundus</h2>${exam.image ? `<div class="image-grid"><figure><img src="/api/examinations/${encodeURIComponent(id)}/images/original" alt="Citra fundus original"><figcaption>Original · ${escape(exam.image.originalResolution.join(' × '))}</figcaption></figure>${exam.image.processedPath ? `<figure><img src="/api/examinations/${encodeURIComponent(id)}/images/processed" alt="Citra fundus setelah preprocessing"><figcaption>Processed · 300 × 300</figcaption></figure>` : ''}</div>` : '<div class="empty">Gambar belum diunggah.</div>'}</section><section class="panel"><h2>Riwayat status</h2><ol class="timeline">${exam.statusHistory.map(s => `<li>${escape(s.status)}<time>${escape(date(s.timestamp))}</time></li>`).join('')}</ol></section></div><div><section class="panel"><div class="eyebrow">AI SCREENING</div>${result ? `<div class="prediction">${escape(labels[result.predictedClass])}</div><div class="meta"><div><span>Confidence</span><b>${(result.confidence * 100).toFixed(1)}%</b></div><div><span>Kategori risiko</span>${badge(result.riskLevel)}</div></div>${Object.entries(result.probabilities).map(([name, probability]) => `<div class="probability"><div><span>${escape(labels[name])}</span><b>${(probability * 100).toFixed(1)}%</b></div><div class="bar"><i style="width:${probability * 100}%"></i></div></div>`).join('')}<div class="notice">${result.isMock ? 'Prediksi dummy untuk pengujian integrasi.' : 'Prediksi model aktual. Tinjau bersama tenaga medis.'} Kategori risiko mengikuti kelas DR dengan aturan ${escape(result.riskRuleVersion || 'legacy')}.</div>` : '<div class="empty">Hasil belum tersedia.</div>'}</section><section class="panel"><h2>Metadata</h2><div class="meta"><div><span>Examination ID</span><b>${escape(id)}</b></div><div><span>Model</span><b>${escape(result?.modelVersion || '—')}</b></div><div><span>Preprocessing</span><b>${escape(exam.image?.preprocessingVersion || '—')}</b></div><div><span>Selesai</span><b>${escape(date(exam.completedAt))}</b></div></div></section>${exam.status === 'CREATED' || exam.status === 'FAILED' ? `<a class="button" href="/examinations/new?patientId=${encodeURIComponent(exam.patientId)}">Pemeriksaan baru</a>` : ''}</div></div>`;
  if (!['IMAGE_RECEIVED', 'PROCESSING'].includes(exam.status)) {
    main.querySelector('.page-head').insertAdjacentHTML('beforeend', `<button type="button" class="danger" data-delete-exam="${escape(id)}" data-patient="${escape(exam.patientId)}">Hapus pemeriksaan</button>`);
  }
  if (exam.status === 'COMPLETED' && result) {
    main.querySelector('.page-head').insertAdjacentHTML('beforeend', `<a class="button" href="/api/examinations/${encodeURIComponent(id)}/report" download="report-${escape(id)}.pdf">Unduh PDF</a>`);
  }
  main.querySelector('.results > div > .panel')?.insertAdjacentHTML('afterend', explanationPanel(exam, id));
  if (result && result.confidence < 0.6) main.querySelector('.results > div:nth-child(2) > .panel')?.insertAdjacentHTML('beforeend', '<div class="notice uncertainty">Probabilitas kelas tertinggi masih di bawah 60%. Hasil perlu ditinjau, dan tidak boleh digunakan sebagai keputusan medis mandiri.</div>');
  if (exam.image) main.querySelector('.results > div:nth-child(2) .meta:last-child')?.insertAdjacentHTML('beforeend', `<div><span>Perangkat</span><b>${escape(exam.image.deviceId || 'Upload manual')}</b></div><div><span>Waktu analisis</span><b>${result?.inferenceTimeMs !== undefined ? (result.inferenceTimeMs / 1000).toFixed(2) + ' detik' : 'Tidak tercatat'}</b></div>`);
  if (['IMAGE_RECEIVED', 'PROCESSING'].includes(exam.status)) setTimeout(() => examination(id).catch(error => { main.innerHTML = errorBox(error); }), 2000);
}
async function init() {
  if (location.pathname === '/devices') {
    location.replace('/dashboard');
    return;
  }
  try {
    const system = await api('/api/system');
    document.querySelector('#system').textContent = `${system.aiMode === 'model' ? 'Model aktual' : 'MOCK'} · ${system.aiReady ? 'Siap' : 'AI belum siap'}`;
    const path = location.pathname;
    const section = path.startsWith('/patients') ? 'patients' : path.startsWith('/examinations') ? 'examinations' : 'dashboard';
    document.querySelector(`[data-nav="${section}"]`).classList.add('active');
    if (path === '/patients') await patientsPage();
    else if (path.startsWith('/patients/')) await patientsPage(decodeURIComponent(path.split('/')[2]));
    else if (path === '/examinations/new') await newExamination();
    else if (path.startsWith('/examinations/')) await examination(path.split('/')[2]);
    else await dashboard();
  } catch (error) { main.innerHTML = heading('Tidak dapat memuat halaman', 'Periksa koneksi backend dan coba lagi.') + errorBox(error) + '<button onclick="location.reload()">Coba lagi</button>'; }
}
main.addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-exam]');
  if (!button || button.disabled) return;
  const id = button.dataset.deleteExam;
  if (!confirm(`Hapus pemeriksaan pasien ${button.dataset.patient} (${id})? Foto dan hasil AI pemeriksaan ini akan dihapus permanen. Data pasien tetap tersimpan.`)) return;
  button.disabled = true;
  try {
    const result = await api(`/api/examinations/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!result.filesRemoved) alert('Riwayat telah dihapus, tetapi sebagian file gambar gagal dibersihkan.');
    if (location.pathname.startsWith('/examinations/')) location.href = `/patients/${encodeURIComponent(button.dataset.patient)}`;
    else await init();
  } catch (error) { alert(error.message); button.disabled = false; }
});
init();
