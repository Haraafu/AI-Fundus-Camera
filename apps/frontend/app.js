const main = document.querySelector('#main');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const date = value => value ? new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const labels = { No_DR: 'No DR', DR: 'DR', Mild: 'Mild DR', Moderate: 'Moderate DR', Severe: 'Severe DR', Proliferative_DR: 'Proliferative DR' };
const statusLabels = { CREATED: 'Dibuat', IMAGE_RECEIVED: 'Gambar diterima', PROCESSING: 'Diproses', COMPLETED: 'Selesai', FAILED: 'Gagal' };
const riskLabels = { NOT_ASSESSED: 'Tidak dinilai', LOW: 'Risiko rendah', MEDIUM: 'Risiko sedang', HIGH: 'Risiko tinggi' };
const BUSY = ['IMAGE_RECEIVED', 'PROCESSING'];
const PATIENT_PATTERN = '[A-Za-z0-9_-]{1,64}';

const svg = paths => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const icons = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  back: svg('<path d="M19 12H5M11 18l-6-6 6-6"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/>'),
  edit: svg('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  alert: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'),
  check: svg('<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>'),
  x: svg('<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>'),
  activity: svg('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  file: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3"/>'),
  upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>'),
  inbox: svg('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/>'),
  note: svg('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>')
};

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message ? `${body.error.message} (${body.error.code})` : `Request gagal (${response.status})`);
  return body;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const badge = (value, text) => `<span class="badge ${escape(value)}">${escape(text ?? statusLabels[value] ?? riskLabels[value] ?? value)}</span>`;
const errorBox = error => `<div class="error" role="alert">${icons.alert}<span>${escape(error.message)}</span></div>`;
const empty = text => `<div class="empty">${icons.inbox}<p>${escape(text)}</p></div>`;
const eyeLabel = eye => eye === 'LEFT' ? 'Kiri (OS)' : 'Kanan (OD)';
function heading(title, subtitle, actions = '', eyebrow = 'AI FUNDUS CAMERA') {
  return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
}

// ---------- Toasts & modal ----------
function toast(message, type = 'success') {
  const host = document.querySelector('.toasts') ?? document.body.appendChild(Object.assign(document.createElement('div'), { className: 'toasts' }));
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `${type === 'success' ? icons.check : icons.alert}<span>${escape(message)}</span>`;
  host.append(el);
  setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 250); }, 3500);
}
const flash = message => sessionStorage.setItem('flash', message);

function openModal({ title, body, confirmLabel = 'Simpan', danger = false, confirmText, onSubmit }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `<form class="modal-card" novalidate>
    <div class="modal-head">${danger ? `<span class="modal-icon">${icons.alert}</span>` : ''}<h2>${escape(title)}</h2></div>
    <div class="modal-body">${body}${confirmText ? `<div class="field confirm-field"><label for="confirm-text">Ketik <code>${escape(confirmText)}</code> untuk mengonfirmasi</label><input id="confirm-text" autocomplete="off" spellcheck="false"></div>` : ''}<div class="modal-error"></div></div>
    <div class="modal-actions"><button type="button" class="button ghost" data-cancel>Batal</button><button type="submit" class="button ${danger ? 'danger' : ''}">${danger ? icons.trash : ''}${escape(confirmLabel)}</button></div>
  </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form'), submit = form.querySelector('[type=submit]');
  const close = () => { dialog.close(); dialog.remove(); };
  form.querySelector('[data-cancel]').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  if (confirmText) {
    const input = form.querySelector('#confirm-text');
    submit.disabled = true;
    input.addEventListener('input', () => { submit.disabled = input.value.trim() !== confirmText; });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    submit.disabled = true;
    submit.classList.add('busy');
    try { await onSubmit(form); close(); }
    catch (error) { form.querySelector('.modal-error').innerHTML = errorBox(error); submit.disabled = false; submit.classList.remove('busy'); }
  });
  dialog.showModal();
  (form.querySelector('input, textarea') ?? form.querySelector('[data-cancel]')).focus();
}

// ---------- Shared tables ----------
function examActions(e) {
  const busy = BUSY.includes(e.status);
  return `<div class="row-actions"><a class="button small ghost" href="/examinations/${enc(e.examinationId)}">Lihat ${icons.arrow}</a><button type="button" class="icon-btn danger" data-action="delete-exam" data-id="${escape(e.examinationId)}" data-patient="${escape(e.patientId)}" title="${busy ? 'Masih diproses, belum dapat dihapus' : 'Hapus pemeriksaan'}" aria-label="Hapus pemeriksaan ${escape(e.patientId)} ${escape(date(e.createdAt))}"${busy ? ' disabled' : ''}>${icons.trash}</button></div>`;
}
function examTable(exams, emptyText = 'Belum ada pemeriksaan. Mulai dengan menambahkan pemeriksaan baru.') {
  if (!exams.length) return empty(emptyText);
  return `<div class="scroll"><table><thead><tr><th>Pasien</th><th>Waktu</th><th>Mata</th><th>Status</th><th>Hasil / risiko</th><th class="right">Aksi</th></tr></thead><tbody>${exams.map(e => `<tr>
    <td><a class="code" href="/patients/${enc(e.patientId)}">${escape(e.patientId)}</a></td>
    <td>${escape(date(e.createdAt))}</td><td>${eyeLabel(e.eye)}</td><td>${badge(e.status)}</td>
    <td>${e.result ? `<div class="result-cell"><span>${escape(labels[e.result.predictedClass] ?? e.result.predictedClass)}</span>${badge(e.result.riskLevel)}${e.result.isMock ? '<span class="tag">MOCK</span>' : ''}</div>` : '<span class="muted">—</span>'}</td>
    <td class="right">${examActions(e)}</td></tr>`).join('')}</tbody></table></div>`;
}
const card = (label, value, hint, icon, tone = '') =>
  `<div class="card ${tone}"><div class="card-top"><span class="label">${escape(label)}</span><span class="card-icon">${icon}</span></div><strong>${value}</strong><small>${escape(hint)}</small></div>`;

// ---------- Pages ----------
async function dashboard() {
  const [exams, patients] = await Promise.all([api('/api/examinations'), api('/api/patients')]);
  const count = status => exams.filter(e => e.status === status).length;
  const high = exams.filter(e => e.result?.riskLevel === 'HIGH' || e.result?.predictedClass === 'DR');
  main.innerHTML = heading('Dashboard', 'Ringkasan pemeriksaan retina dan hasil skrining retinopati diabetik terbaru.', `<a class="button" href="/examinations/new">${icons.plus}Pemeriksaan baru</a>`) +
    `<div class="cards">${card('Total pemeriksaan', exams.length, 'Seluruh pemeriksaan tersimpan', icons.activity)}${card('Selesai', count('COMPLETED'), 'Hasil siap ditinjau', icons.check, 'ok')}${card('Gagal', count('FAILED'), 'Perlu diulang atau diperiksa', icons.x, count('FAILED') ? 'bad' : '')}${card('Pasien', patients.length, 'Teridentifikasi dengan kode anonim', icons.users)}</div>` +
    `<section class="panel"><div class="panel-head"><h2>Pemeriksaan terbaru</h2><a class="link" href="/patients">Semua pasien ${icons.arrow}</a></div>${examTable(exams.slice(0, 10))}</section>` +
    `<section class="panel"><div class="panel-head"><h2>Hasil DR atau risiko tinggi <span class="count">${high.length}</span></h2></div>${examTable(high.slice(0, 6), 'Tidak ada hasil DR atau risiko tinggi.')}</section>`;
}

async function patientsList() {
  const [patients, exams] = await Promise.all([api('/api/patients'), api('/api/examinations')]);
  const stats = new Map();
  for (const e of exams) {
    const s = stats.get(e.patientId) ?? { count: 0, last: null, busy: false };
    s.count++; s.busy ||= BUSY.includes(e.status);
    if (!s.last || e.createdAt > s.last) s.last = e.createdAt;
    stats.set(e.patientId, s);
  }
  main.innerHTML = heading('Pasien', 'Kelola kode pasien anonim beserta riwayat pemeriksaannya.') +
    `<section class="panel"><h2>Tambah pasien</h2><form id="patient-form" class="inline-form">
      <div class="field"><label for="patient-code">Kode pasien anonim</label><input id="patient-code" pattern="${PATIENT_PATTERN}" maxlength="64" placeholder="PT-00001" required></div>
      <div class="field grow"><label for="patient-notes">Catatan <span class="optional">(opsional)</span></label><input id="patient-notes" maxlength="500" placeholder="mis. kontrol rutin, riwayat DM 5 tahun"></div>
      <button type="submit">${icons.plus}Simpan pasien</button></form>
      <p class="help">Gunakan kode anonim (huruf, angka, - atau _). Jangan masukkan nama, NIK, atau alamat.</p><div id="patient-error"></div></section>` +
    `<section class="panel"><div class="panel-head"><h2>Daftar pasien <span class="count">${patients.length}</span></h2><div class="search">${icons.search}<input id="search" type="search" aria-label="Cari pasien" placeholder="Cari kode atau catatan…"></div></div><div id="patient-list"></div></section>`;
  const render = query => {
    const q = query.trim().toLowerCase();
    const filtered = patients.filter(p => p.patientId.toLowerCase().includes(q) || (p.notes ?? '').toLowerCase().includes(q));
    document.querySelector('#patient-list').innerHTML = filtered.length ? `<div class="scroll"><table><thead><tr><th>Kode pasien</th><th>Catatan</th><th>Pemeriksaan</th><th>Terakhir diperiksa</th><th>Terdaftar</th><th class="right">Aksi</th></tr></thead><tbody>${filtered.map(p => {
      const s = stats.get(p.patientId) ?? { count: 0, last: null, busy: false };
      const lock = s.busy ? ` disabled title="Ada pemeriksaan yang masih diproses"` : '';
      return `<tr><td><a class="code" href="/patients/${enc(p.patientId)}">${escape(p.patientId)}</a></td>
        <td class="notes-cell">${p.notes ? escape(p.notes) : '<span class="muted">—</span>'}</td>
        <td>${s.count}</td><td>${escape(date(s.last))}</td><td>${escape(date(p.createdAt))}</td>
        <td class="right"><div class="row-actions"><a class="button small ghost" href="/patients/${enc(p.patientId)}">Riwayat ${icons.arrow}</a>
          <button type="button" class="icon-btn" data-action="edit-patient" data-id="${escape(p.patientId)}" title="Edit pasien" aria-label="Edit pasien ${escape(p.patientId)}"${lock}>${icons.edit}</button>
          <button type="button" class="icon-btn danger" data-action="delete-patient" data-id="${escape(p.patientId)}" data-count="${s.count}" title="Hapus pasien" aria-label="Hapus pasien ${escape(p.patientId)}"${lock}>${icons.trash}</button></div></td></tr>`;
    }).join('')}</tbody></table></div>` : empty(patients.length ? 'Tidak ada pasien yang cocok dengan pencarian.' : 'Belum ada pasien. Tambahkan pasien pertama di atas.');
  };
  render('');
  document.querySelector('#search').addEventListener('input', e => render(e.target.value));
  document.querySelector('#patient-form').addEventListener('submit', async e => {
    e.preventDefault();
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      const patient = await api('/api/patients', json('POST', { patientId: document.querySelector('#patient-code').value.trim(), notes: document.querySelector('#patient-notes').value }));
      flash(`Pasien ${patient.patientId} tersimpan.`);
      location.href = `/patients/${enc(patient.patientId)}`;
    } catch (error) { document.querySelector('#patient-error').innerHTML = errorBox(error); button.disabled = false; }
  });
}

async function patientDetail(patientId) {
  const [patient, exams] = await Promise.all([api(`/api/patients/${enc(patientId)}`), api(`/api/examinations?patientId=${enc(patientId)}`)]);
  const busy = exams.some(e => BUSY.includes(e.status));
  const lock = busy ? ' disabled title="Ada pemeriksaan yang masih diproses"' : '';
  const completed = exams.filter(e => e.status === 'COMPLETED');
  const latest = completed[0]?.result;
  main.innerHTML = heading(patient.patientId, `Terdaftar ${date(patient.createdAt)} · ${exams.length} pemeriksaan`,
    `<button type="button" class="button secondary" data-action="edit-patient" data-id="${escape(patient.patientId)}"${lock}>${icons.edit}Edit</button>
     <button type="button" class="button danger-outline" data-action="delete-patient" data-id="${escape(patient.patientId)}" data-count="${exams.length}"${lock}>${icons.trash}Hapus pasien</button>
     <a class="button" href="/examinations/new?patientId=${enc(patient.patientId)}">${icons.plus}Pemeriksaan baru</a>`,
    `<a class="back" href="/patients">${icons.back}Daftar pasien</a>`) +
    `<div class="cards three">${card('Pemeriksaan', exams.length, `${completed.length} selesai`, icons.activity)}${card('Hasil terakhir', latest ? escape(labels[latest.predictedClass] ?? latest.predictedClass) : '—', latest ? date(completed[0].completedAt) : 'Belum ada hasil', icons.check)}${card('Risiko terakhir', latest ? badge(latest.riskLevel) : '—', latest?.riskLevel === 'NOT_ASSESSED' ? 'Model biner tidak menilai keparahan' : 'Berdasarkan kelas DR', icons.alert)}</div>` +
    `<section class="panel"><div class="panel-head"><h2>Catatan</h2></div>${patient.notes ? `<p class="notes">${escape(patient.notes)}</p>` : `<p class="muted">Belum ada catatan. Gunakan tombol <b>Edit</b> untuk menambahkan.</p>`}</section>` +
    `<section class="panel"><h2>Riwayat pemeriksaan</h2>${examTable(exams, 'Belum ada pemeriksaan untuk pasien ini.')}</section>`;
}

async function newExamination() {
  const patients = await api('/api/patients');
  const selected = new URLSearchParams(location.search).get('patientId') || '';
  main.innerHTML = heading('Pemeriksaan baru', 'Pilih pasien, mata, dan foto fundus untuk menjalankan analisis AI.') + `<section class="panel narrow"><form id="exam-form">
    <div class="form-grid">
      <div class="field full"><label for="patient">Kode pasien anonim</label><input id="patient" list="patients" pattern="${PATIENT_PATTERN}" maxlength="64" value="${escape(selected)}" placeholder="PT-00001" required><datalist id="patients">${patients.map(p => `<option value="${escape(p.patientId)}"></option>`).join('')}</datalist><p class="help">Pasien baru otomatis dibuat bila kode belum terdaftar.</p></div>
      <div class="field"><label for="eye">Mata</label><select id="eye"><option value="RIGHT">Kanan (OD)</option><option value="LEFT">Kiri (OS)</option></select></div>
      <div class="field"><label for="capture">Posisi pengambilan</label><select id="capture"><option value="MACULA_CENTERED">Macula centered</option><option value="OPTIC_DISC_CENTERED">Optic disc centered</option></select></div>
    </div>
    <label class="dropzone" for="image"><span class="dropzone-icon">${icons.upload}</span><b id="file-name">Pilih atau seret foto fundus ke sini</b><span>PNG / JPEG · maksimum 10 MiB</span><img id="preview" class="preview" alt="Preview foto fundus" hidden></label>
    <input id="image" class="visually-hidden" type="file" accept="image/png,image/jpeg" required>
    <div id="upload-status" role="status"></div>
    <div class="form-actions"><button id="submit" type="submit">${icons.activity}Mulai analisis</button></div>
  </form></section>`;
  let previewUrl;
  const input = document.querySelector('#image'), zone = document.querySelector('.dropzone');
  const showFile = file => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const preview = document.querySelector('#preview');
    preview.hidden = !file;
    document.querySelector('#file-name').textContent = file ? file.name : 'Pilih atau seret foto fundus ke sini';
    zone.classList.toggle('has-file', !!file);
    if (file) { previewUrl = URL.createObjectURL(file); preview.src = previewUrl; }
  };
  input.addEventListener('change', () => showFile(input.files[0]));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragging');
    if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; showFile(input.files[0]); }
  });
  document.querySelector('#exam-form').addEventListener('submit', async e => {
    e.preventDefault();
    const button = document.querySelector('#submit'), status = document.querySelector('#upload-status');
    const file = input.files[0];
    if (!file) { status.innerHTML = errorBox(new Error('Pilih foto fundus terlebih dahulu.')); return; }
    if (file.size > 10 * 1024 * 1024) { status.innerHTML = errorBox(new Error('Ukuran gambar melebihi 10 MiB.')); return; }
    button.disabled = true; button.classList.add('busy');
    let exam;
    try {
      status.innerHTML = '<div class="notice">Membuat pemeriksaan…</div>';
      exam = await api('/api/examinations', json('POST', { patientId: document.querySelector('#patient').value.trim(), eye: document.querySelector('#eye').value, captureType: document.querySelector('#capture').value }));
      status.innerHTML = '<div class="notice"><span class="spinner"></span>Foto sedang diproses dan dianalisis. Tunggu sampai hasil tersedia.</div>';
      const form = new FormData(); form.append('image', file);
      await api(`/api/examinations/${exam.examinationId}/images`, { method: 'POST', body: form });
      location.href = `/examinations/${exam.examinationId}`;
    } catch (error) {
      status.innerHTML = errorBox(error) + (exam ? `<p><a class="link" href="/examinations/${exam.examinationId}">Lihat status pemeriksaan ${icons.arrow}</a></p>` : '');
      button.classList.remove('busy');
      if (exam) { button.textContent = 'Buat pemeriksaan baru'; button.type = 'button'; button.onclick = () => location.reload(); }
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

async function examination(id) {
  const exam = await api(`/api/examinations/${enc(id)}`), result = exam.result;
  const busy = BUSY.includes(exam.status);
  main.innerHTML = heading('Hasil pemeriksaan', `${exam.patientId} · Mata ${eyeLabel(exam.eye).toLowerCase()} · ${date(exam.createdAt)}`,
    `${exam.status === 'COMPLETED' ? `<a class="button secondary" href="/api/examinations/${enc(id)}/report" target="_blank" rel="noopener">${icons.file}Unduh laporan</a>` : ''}
     <button type="button" class="button danger-outline" data-action="delete-exam" data-id="${escape(id)}" data-patient="${escape(exam.patientId)}"${busy ? ' disabled title="Masih diproses, belum dapat dihapus"' : ''}>${icons.trash}Hapus</button>`,
    `<a class="back" href="/patients/${enc(exam.patientId)}">${icons.back}Riwayat ${escape(exam.patientId)}</a>`) +
    `<div class="notice">${busy ? '<span class="spinner"></span>' : ''}Status ${badge(exam.status)} · ${escape(exam.captureType)}${result?.isMock ? ' · Hasil MOCK: prediksi dummy untuk pengujian.' : ''}</div>` +
    (exam.error ? errorBox(new Error(`${exam.error.code}: ${exam.error.message}`)) : '') +
    `<div class="results"><div>
      <section class="panel"><h2>Citra fundus</h2>${exam.image ? `<div class="image-grid"><figure><img src="/api/examinations/${enc(id)}/images/original" alt="Citra fundus original"><figcaption>Original · ${escape(exam.image.originalResolution.join(' × '))}</figcaption></figure>${exam.image.processedPath ? `<figure><img src="/api/examinations/${enc(id)}/images/processed" alt="Citra fundus setelah preprocessing"><figcaption>Processed (CLAHE) · 300 × 300</figcaption></figure>` : ''}</div>` : empty('Gambar belum diunggah.')}</section>
      <section class="panel"><h2>Riwayat status</h2><ol class="timeline">${exam.statusHistory.map(s => `<li class="${escape(s.status)}"><b>${escape(statusLabels[s.status] ?? s.status)}</b><time>${escape(date(s.timestamp))}</time></li>`).join('')}</ol></section>
    </div><div>
      <section class="panel"><div class="eyebrow">AI SCREENING</div>${result ? `<div class="prediction">${escape(labels[result.predictedClass] ?? result.predictedClass)}</div>
        <div class="meta"><div><span>Confidence</span><b>${(result.confidence * 100).toFixed(1)}%</b></div><div><span>Kategori risiko</span>${badge(result.riskLevel)}</div></div>
        ${Object.entries(result.probabilities).map(([name, probability]) => `<div class="probability${name === result.predictedClass ? ' top' : ''}"><div><span>${escape(labels[name] ?? name)}</span><b>${(probability * 100).toFixed(1)}%</b></div><div class="bar"><i style="width:${probability * 100}%"></i></div></div>`).join('')}
        <div class="notice">${result.isMock ? 'Prediksi dummy untuk pengujian integrasi.' : 'Prediksi model aktual. Tinjau bersama tenaga medis.'}${result.riskLevel === 'NOT_ASSESSED' ? ' Model biner tidak menentukan tingkat keparahan. No DR tidak menyingkirkan kemungkinan DR.' : ` Kategori risiko mengikuti aturan ${escape(result.riskRuleVersion || 'legacy')}.`}</div>` : empty('Hasil belum tersedia.')}</section>
      <section class="panel"><h2>Metadata</h2><div class="meta"><div><span>Examination ID</span><b class="mono">${escape(id)}</b></div><div><span>Model</span><b>${escape(result?.modelVersion || '—')}</b></div><div><span>Preprocessing</span><b>${escape(exam.image?.preprocessingVersion || '—')}</b></div><div><span>Selesai</span><b>${escape(date(exam.completedAt))}</b></div></div></section>
      ${exam.status === 'CREATED' || exam.status === 'FAILED' ? `<a class="button" href="/examinations/new?patientId=${enc(exam.patientId)}">${icons.plus}Pemeriksaan baru</a>` : ''}
    </div></div>`;
  main.querySelector('.results > div > .panel')?.insertAdjacentHTML('afterend', explanationPanel(exam, id));
  if (result && result.confidence < 0.6) main.querySelector('.results > div:nth-child(2) > .panel')?.insertAdjacentHTML('beforeend', '<div class="notice uncertainty">Probabilitas kelas tertinggi masih di bawah 60%. Hasil perlu ditinjau, dan tidak boleh digunakan sebagai keputusan medis mandiri.</div>');
  if (exam.image) main.querySelector('.results > div:nth-child(2) .meta:last-child')?.insertAdjacentHTML('beforeend', `<div><span>Perangkat</span><b>${escape(exam.image.deviceId || 'Upload manual')}</b></div><div><span>Waktu analisis</span><b>${result?.inferenceTimeMs !== undefined ? (result.inferenceTimeMs / 1000).toFixed(2) + ' detik' : 'Tidak tercatat'}</b></div>`);
  if (busy) setTimeout(() => { if (location.pathname === `/examinations/${id}`) examination(id).catch(error => { main.innerHTML = errorBox(error); }); }, 2000);
}

// ---------- Actions (edit / delete) ----------
const onDetailPage = prefix => location.pathname.startsWith(prefix);
const actions = {
  'delete-exam': ({ id, patient }) => openModal({
    title: 'Hapus pemeriksaan?', danger: true, confirmLabel: 'Hapus pemeriksaan',
    body: `<p>Pemeriksaan pasien <b>${escape(patient)}</b> beserta foto fundus dan hasil AI-nya akan dihapus permanen.</p><p class="warning-text">Tindakan ini tidak dapat dibatalkan.</p>`,
    onSubmit: async () => {
      const deleted = await api(`/api/examinations/${enc(id)}`, { method: 'DELETE' });
      if (!deleted.filesRemoved) toast('Riwayat dihapus, tetapi sebagian file gambar gagal dibersihkan.', 'error');
      if (onDetailPage('/examinations/')) { flash('Pemeriksaan berhasil dihapus.'); location.href = `/patients/${enc(patient)}`; return; }
      toast('Pemeriksaan berhasil dihapus.');
      await route();
    }
  }),
  'edit-patient': async ({ id }) => {
    const patient = await api(`/api/patients/${enc(id)}`);
    openModal({
      title: 'Edit pasien', confirmLabel: 'Simpan perubahan',
      body: `<div class="field"><label for="edit-code">Kode pasien anonim</label><input id="edit-code" name="patientId" pattern="${PATIENT_PATTERN}" maxlength="64" value="${escape(patient.patientId)}" required><p class="help">Mengganti kode juga memperbarui seluruh riwayat pemeriksaan pasien ini.</p></div>
        <div class="field"><label for="edit-notes">Catatan <span class="optional">(opsional)</span></label><textarea id="edit-notes" name="notes" maxlength="500" rows="4" placeholder="mis. kontrol rutin, riwayat DM 5 tahun">${escape(patient.notes)}</textarea><p class="help">Jangan masukkan identitas pribadi (nama, NIK, alamat).</p></div>`,
      onSubmit: async form => {
        const updated = await api(`/api/patients/${enc(id)}`, json('PATCH', { patientId: form.elements.patientId.value.trim(), notes: form.elements.notes.value }));
        if (onDetailPage('/patients/')) history.replaceState(null, '', `/patients/${enc(updated.patientId)}`);
        toast('Data pasien berhasil diperbarui.');
        await route();
      }
    });
  },
  'delete-patient': ({ id, count }) => openModal({
    title: 'Hapus pasien?', danger: true, confirmLabel: 'Hapus pasien', confirmText: id,
    body: `<p>Pasien <b>${escape(id)}</b>${Number(count) ? ` beserta <b>${Number(count)} pemeriksaan</b>, foto fundus, dan hasil AI-nya` : ''} akan dihapus permanen.</p><p class="warning-text">Tindakan ini tidak dapat dibatalkan.</p>`,
    onSubmit: async () => {
      const deleted = await api(`/api/patients/${enc(id)}`, { method: 'DELETE' });
      if (!deleted.filesRemoved) toast('Data pasien dihapus, tetapi sebagian file gambar gagal dibersihkan.', 'error');
      if (onDetailPage('/patients/')) { flash(`Pasien ${id} berhasil dihapus.`); location.href = '/patients'; return; }
      toast(`Pasien ${id} berhasil dihapus.`);
      await route();
    }
  })
};
main.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled || !actions[el.dataset.action]) return;
  try { await actions[el.dataset.action](el.dataset); } catch (error) { toast(error.message, 'error'); }
});

// ---------- Router ----------
async function route() {
  const path = location.pathname;
  if (path === '/devices') { location.replace('/dashboard'); return; }
  if (path === '/patients') return patientsList();
  if (path.startsWith('/patients/')) return patientDetail(decodeURIComponent(path.split('/')[2]));
  if (path === '/examinations/new') return newExamination();
  if (path.startsWith('/examinations/')) return examination(decodeURIComponent(path.split('/')[2]));
  return dashboard();
}
async function init() {
  const path = location.pathname;
  const section = path.startsWith('/patients') ? 'patients' : path.startsWith('/examinations') ? 'examinations' : 'dashboard';
  document.querySelector(`[data-nav="${section}"]`)?.classList.add('active');
  const message = sessionStorage.getItem('flash');
  if (message) { sessionStorage.removeItem('flash'); toast(message); }
  try {
    const system = await api('/api/system');
    const el = document.querySelector('#system');
    el.innerHTML = `<span class="online-dot"></span>${escape(system.storage.toUpperCase())} · ${system.aiMode === 'model' ? 'Model aktual' : 'Mode MOCK'} · ${system.aiReady ? 'Siap' : 'AI belum siap'}`;
    el.classList.toggle('mock', system.aiMode !== 'model');
    el.classList.toggle('not-ready', !system.aiReady);
    await route();
  } catch (error) {
    main.innerHTML = heading('Tidak dapat memuat halaman', 'Periksa koneksi backend dan coba lagi.') + errorBox(error) + '<button type="button" onclick="location.reload()">Coba lagi</button>';
  }
}
init();
