const main = document.querySelector('#main');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const enc = encodeURIComponent;
const date = value => value ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const labels = { No_DR: 'No DR', DR: 'DR', Mild: 'Mild DR', Moderate: 'Moderate DR', Severe: 'Severe DR', Proliferative_DR: 'Proliferative DR' };
const statusLabels = { CREATED: 'Created', IMAGE_RECEIVED: 'Image received', PROCESSING: 'Processing', COMPLETED: 'Completed', FAILED: 'Failed', REJECTED: 'Rejected' };
const riskLabels = { NOT_ASSESSED: 'Not assessed', LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk' };
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
  let response;
  try {
    response = await fetch(path, { ...options, credentials: 'same-origin', headers: { ...options.headers, 'X-Luxora-Request': '1' } });
  } catch {
    throw new Error(options.body instanceof FormData
      ? 'The image could not be uploaded. Please select the file again and try again.'
      : 'Unable to connect. Please check your connection and try again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error?.message ? `${body.error.message} (${body.error.code})` : `Request failed (${response.status})`);
    error.status = response.status;
    error.code = body.error?.code;
    if (response.status === 401 && !path.startsWith('/api/auth/')) {
      location.replace(`/login?next=${enc(location.pathname + location.search)}`);
    }
    throw error;
  }
  return body;
}
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const badge = (value, text) => `<span class="badge ${escape(value)}">${escape(text ?? statusLabels[value] ?? riskLabels[value] ?? value)}</span>`;
const errorBox = error => `<div class="error" role="alert">${icons.alert}<span>${['NON_FUNDUS_IMAGE', 'FUNDUS_IMAGE_UNCERTAIN'].includes(error.code) ? 'This does not appear to be a fundus image. Please upload a clear retinal fundus photograph and try again.' : escape(error.message)}</span></div>`;
function processingStatus(title, description = 'Please keep this page open while we process your image.') {
  return `<div class="processing-panel" aria-busy="true"><div class="processing-title"><span class="spinner" aria-hidden="true"></span><strong>${escape(title)}</strong></div><div class="processing-track" role="progressbar" aria-label="Image analysis progress" aria-valuetext="${escape(title)}"><span class="processing-fill"></span></div><p>${escape(description)}</p></div>`;
}
const empty = text => `<div class="empty">${icons.inbox}<p>${escape(text)}</p></div>`;
const eyeLabel = eye => eye === 'LEFT' ? 'Left (OS)' : 'Right (OD)';
function heading(title, subtitle, actions = '', eyebrow = 'LUXORA') {
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

function openModal({ title, body, confirmLabel = 'Save', danger = false, confirmText, onSubmit }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.innerHTML = `<form class="modal-card" novalidate>
    <div class="modal-head">${danger ? `<span class="modal-icon">${icons.alert}</span>` : ''}<h2>${escape(title)}</h2></div>
    <div class="modal-body">${body}${confirmText ? `<div class="field confirm-field"><label for="confirm-text">Type <code>${escape(confirmText)}</code> to confirm</label><input id="confirm-text" autocomplete="off" spellcheck="false"></div>` : ''}<div class="modal-error"></div></div>
    <div class="modal-actions"><button type="button" class="button ghost" data-cancel>Cancel</button><button type="submit" class="button ${danger ? 'danger' : ''}">${danger ? icons.trash : ''}${escape(confirmLabel)}</button></div>
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
  return `<div class="row-actions"><a class="button small ghost" href="/examinations/${enc(e.examinationId)}">View ${icons.arrow}</a><button type="button" class="icon-btn danger" data-action="delete-exam" data-id="${escape(e.examinationId)}" data-patient="${escape(e.patientId)}" title="${busy ? 'Still processing; cannot be deleted yet' : 'Delete examination'}" aria-label="Delete examination ${escape(e.patientId)} ${escape(date(e.createdAt))}"${busy ? ' disabled' : ''}>${icons.trash}</button></div>`;
}
function examTable(exams, emptyText = 'No examinations yet. Start by adding a new examination.') {
  if (!exams.length) return empty(emptyText);
  return `<div class="scroll"><table><thead><tr><th>Patient</th><th>Date</th><th>Eye</th><th>Status</th><th>AI prediction</th><th class="right">Actions</th></tr></thead><tbody>${exams.map(e => `<tr>
    <td><a class="code" href="/patients/${enc(e.patientId)}">${escape(e.patientId)}</a></td>
    <td>${escape(date(e.createdAt))}</td><td>${eyeLabel(e.eye)}</td><td>${badge(e.status)}</td>
    <td>${e.result ? `<div class="result-cell"><span>${escape(labels[e.result.predictedClass] ?? e.result.predictedClass)}</span>${e.result.riskLevel && e.result.riskLevel !== 'NOT_ASSESSED' ? badge(e.result.riskLevel) : ''}${e.result.isMock ? '<span class="tag">MOCK</span>' : ''}</div>` : '<span class="muted">—</span>'}</td>
    <td class="right">${examActions(e)}</td></tr>`).join('')}</tbody></table></div>`;
}
const card = (label, value, hint, icon, tone = '') =>
  `<div class="card ${tone}"><div class="card-top"><span class="label">${escape(label)}</span><span class="card-icon">${icon}</span></div><strong>${value}</strong><small>${escape(hint)}</small></div>`;

// ---------- Pages ----------
async function dashboard() {
  const [exams, patients] = await Promise.all([api('/api/examinations'), api('/api/patients')]);
  const count = status => exams.filter(e => e.status === status).length;
  const dr = exams.filter(e => e.result?.predictedClass === 'DR');
  main.innerHTML = heading('Dashboard', 'Your latest retinal examinations and diabetic retinopathy screening results.', `<a class="button" href="/examinations/new">${icons.plus}New examination</a>`) +
    `<div class="cards">${card('Total examinations', exams.length, 'All your saved examinations', icons.activity)}${card('Completed', count('COMPLETED'), 'Results ready for review', icons.check, 'ok')}${card('Failed', count('FAILED'), 'Needs a repeat or review', icons.x, count('FAILED') ? 'bad' : '')}${card('Patients', patients.length, 'Identified by anonymous patient codes', icons.users)}</div>` +
    `<section class="panel"><div class="panel-head"><h2>Recent examinations</h2><a class="link" href="/patients">All patients ${icons.arrow}</a></div>${examTable(exams.slice(0, 10))}</section>` +
    `<section class="panel"><div class="panel-head"><h2>DR predictions <span class="count">${dr.length}</span></h2></div><p class="help">Examinations classified as DR by the binary screening model. Disease severity is not assessed.</p>${examTable(dr.slice(0, 6), 'No examinations have been classified as DR yet.')}</section>`;
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
  main.innerHTML = heading('Patients', 'Manage your anonymous patient codes and examination histories.') +
    `<section class="panel"><h2>Add patient</h2><form id="patient-form" class="inline-form">
      <div class="field"><label for="patient-code">Anonymous patient code</label><input id="patient-code" pattern="${PATIENT_PATTERN}" maxlength="64" placeholder="PT-00001" required></div>
      <div class="field grow"><label for="patient-notes">Notes <span class="optional">(optional)</span></label><input id="patient-notes" maxlength="500" placeholder="e.g. routine follow-up, 5-year history of diabetes"></div>
      <button type="submit">${icons.plus}Save patient</button></form>
      <p class="help">Use an anonymous code (letters, numbers, - or _). Do not enter names, identity numbers, or addresses.</p><div id="patient-error"></div></section>` +
    `<section class="panel"><div class="panel-head"><h2>Patient list <span class="count">${patients.length}</span></h2><div class="search">${icons.search}<input id="search" type="search" aria-label="Search patients" placeholder="Search codes or notes…"></div></div><div id="patient-list"></div></section>`;
  const render = query => {
    const q = query.trim().toLowerCase();
    const filtered = patients.filter(p => p.patientId.toLowerCase().includes(q) || (p.notes ?? '').toLowerCase().includes(q));
    document.querySelector('#patient-list').innerHTML = filtered.length ? `<div class="scroll"><table><thead><tr><th>Patient code</th><th>Notes</th><th>Examinations</th><th>Last examined</th><th>Registered</th><th class="right">Actions</th></tr></thead><tbody>${filtered.map(p => {
      const s = stats.get(p.patientId) ?? { count: 0, last: null, busy: false };
      const lock = s.busy ? ` disabled title="An examination is still processing"` : '';
      return `<tr><td><a class="code" href="/patients/${enc(p.patientId)}">${escape(p.patientId)}</a></td>
        <td class="notes-cell">${p.notes ? escape(p.notes) : '<span class="muted">—</span>'}</td>
        <td>${s.count}</td><td>${escape(date(s.last))}</td><td>${escape(date(p.createdAt))}</td>
        <td class="right"><div class="row-actions"><a class="button small ghost" href="/patients/${enc(p.patientId)}">History ${icons.arrow}</a>
          <button type="button" class="icon-btn" data-action="edit-patient" data-id="${escape(p.patientId)}" title="Edit patient" aria-label="Edit patient ${escape(p.patientId)}"${lock}>${icons.edit}</button>
          <button type="button" class="icon-btn danger" data-action="delete-patient" data-id="${escape(p.patientId)}" data-count="${s.count}" title="Delete patient" aria-label="Delete patient ${escape(p.patientId)}"${lock}>${icons.trash}</button></div></td></tr>`;
    }).join('')}</tbody></table></div>` : empty(patients.length ? 'No patients match your search.' : 'No patients yet. Add your first patient above.');
  };
  render('');
  document.querySelector('#search').addEventListener('input', e => render(e.target.value));
  document.querySelector('#patient-form').addEventListener('submit', async e => {
    e.preventDefault();
    const button = e.target.querySelector('button');
    button.disabled = true;
    try {
      const patient = await api('/api/patients', json('POST', { patientId: document.querySelector('#patient-code').value.trim(), notes: document.querySelector('#patient-notes').value }));
      flash(`Patient ${patient.patientId} saved.`);
      location.href = `/patients/${enc(patient.patientId)}`;
    } catch (error) { document.querySelector('#patient-error').innerHTML = errorBox(error); button.disabled = false; }
  });
}

async function patientDetail(patientId) {
  const [patient, exams] = await Promise.all([api(`/api/patients/${enc(patientId)}`), api(`/api/examinations?patientId=${enc(patientId)}`)]);
  const busy = exams.some(e => BUSY.includes(e.status));
  const lock = busy ? ' disabled title="An examination is still processing"' : '';
  const completed = exams.filter(e => e.status === 'COMPLETED');
  const latest = completed[0]?.result;
  main.innerHTML = heading(patient.patientId, `Registered ${date(patient.createdAt)} · ${exams.length} examinations`,
    `<button type="button" class="button secondary" data-action="edit-patient" data-id="${escape(patient.patientId)}"${lock}>${icons.edit}Edit</button>
     <button type="button" class="button danger-outline" data-action="delete-patient" data-id="${escape(patient.patientId)}" data-count="${exams.length}"${lock}>${icons.trash}Delete patient</button>
     <a class="button" href="/examinations/new?patientId=${enc(patient.patientId)}">${icons.plus}New examination</a>`,
    `<a class="back" href="/patients">${icons.back}Patient list</a>`) +
    `<div class="cards three">${card('Examinations', exams.length, `${completed.length} completed`, icons.activity)}${card('Latest result', latest ? escape(labels[latest.predictedClass] ?? latest.predictedClass) : '—', latest ? date(completed[0].completedAt) : 'No results yet', icons.check)}${card('Latest risk', latest ? badge(latest.riskLevel) : '—', latest?.riskLevel === 'NOT_ASSESSED' ? 'The binary model does not assess severity' : 'Based on the DR class', icons.alert)}</div>` +
    `<section class="panel"><div class="panel-head"><h2>Notes</h2></div>${patient.notes ? `<p class="notes">${escape(patient.notes)}</p>` : `<p class="muted">No notes yet. Select <b>Edit</b> to add notes.</p>`}</section>` +
    `<section class="panel"><h2>Examination history</h2>${examTable(exams, 'No examinations for this patient yet.')}</section>`;
}

async function newExamination() {
  const patients = await api('/api/patients');
  const selected = new URLSearchParams(location.search).get('patientId') || '';
  main.innerHTML = heading('New examination', 'Choose a patient, eye, and fundus image to run AI analysis.') + `<section class="panel narrow"><form id="exam-form">
    <div class="form-grid">
      <div class="field full"><label for="patient">Anonymous patient code</label><input id="patient" list="patients" pattern="${PATIENT_PATTERN}" maxlength="64" value="${escape(selected)}" placeholder="PT-00001" required><datalist id="patients">${patients.map(p => `<option value="${escape(p.patientId)}"></option>`).join('')}</datalist><p class="help">A new patient is created automatically if the code is not registered in your account.</p></div>
      <div class="field"><label for="eye">Eye</label><select id="eye"><option value="RIGHT">Right (OD)</option><option value="LEFT">Left (OS)</option></select></div>
      <div class="field"><label for="capture">Capture position</label><select id="capture"><option value="MACULA_CENTERED">Macula centered</option><option value="OPTIC_DISC_CENTERED">Optic disc centered</option></select></div>
    </div>
    <label class="dropzone" for="image"><span class="dropzone-icon">${icons.upload}</span><b id="file-name">Choose or drag a fundus image here</b><span>Retinal fundus photographs only · PNG / JPEG · maximum 10 MiB</span><img id="preview" class="preview" alt="Fundus image preview" hidden></label>
    <input id="image" class="visually-hidden" type="file" accept="image/png,image/jpeg" required>
    <div id="upload-status" role="status"></div>
    <div class="form-actions"><button id="submit" type="submit">${icons.activity}Start analysis</button></div>
  </form></section>`;
  let previewUrl;
  const input = document.querySelector('#image'), zone = document.querySelector('.dropzone');
  const showFile = file => {
    document.querySelector('#upload-status').innerHTML = '';
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const preview = document.querySelector('#preview');
    preview.hidden = !file;
    document.querySelector('#file-name').textContent = file ? file.name : 'Choose or drag a fundus image here';
    zone.classList.toggle('has-file', !!file);
    if (file) { previewUrl = URL.createObjectURL(file); preview.src = previewUrl; }
  };
  input.addEventListener('change', () => showFile(input.files[0]));
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragging'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragging');
    if (zone.getAttribute('aria-disabled') === 'true') return;
    if (e.dataTransfer.files.length) { input.files = e.dataTransfer.files; showFile(input.files[0]); }
  });
  document.querySelector('#exam-form').addEventListener('submit', async e => {
    e.preventDefault();
    const button = document.querySelector('#submit'), status = document.querySelector('#upload-status');
    if (button.disabled) return;
    const file = input.files[0];
    if (!file) { status.innerHTML = errorBox(new Error('Choose a fundus image first.')); return; }
    if (file.size > 10 * 1024 * 1024) { status.innerHTML = errorBox(new Error('The image exceeds the 10 MiB limit.')); return; }
    const metadata = { patientId: document.querySelector('#patient').value.trim(), eye: document.querySelector('#eye').value, captureType: document.querySelector('#capture').value };
    const fields = [...e.target.querySelectorAll('input:not([type="file"]), select')];
    fields.forEach(field => { field.disabled = true; });
    zone.setAttribute('aria-disabled', 'true');
    button.disabled = true; button.classList.add('busy');
    let exam;
    try {
      status.innerHTML = processingStatus('Preparing your image…', 'We’re checking your image before starting the analysis.');
      const validationForm = new FormData(); validationForm.append('image', file);
      await api('/api/images/validate', { method: 'POST', body: validationForm });
      status.innerHTML = processingStatus('Preparing your analysis…');
      exam = await api('/api/examinations', json('POST', metadata));
      status.innerHTML = processingStatus('Analyzing your image…', 'Your screening results and visualization are being generated. This may take a moment.');
      const form = new FormData(); form.append('image', file);
      await api(`/api/examinations/${exam.examinationId}/images`, { method: 'POST', body: form });
      location.href = `/examinations/${exam.examinationId}`;
    } catch (error) {
      status.innerHTML = errorBox(error) + (exam ? `<p><a class="link" href="/examinations/${exam.examinationId}">View examination status ${icons.arrow}</a></p>` : '');
      button.classList.remove('busy');
      fields.forEach(field => { field.disabled = false; });
      zone.removeAttribute('aria-disabled');
      if (exam) { button.textContent = 'Create a new examination'; button.type = 'button'; button.onclick = () => location.reload(); }
      button.disabled = false;
    }
  });
}

function explanationPanel(exam, id) {
  const cam = exam.result?.explanation;
  if (!exam.result) return '';
  if (cam?.status !== 'AVAILABLE') return `<section class="panel"><h2>Grad-CAM visualization</h2><p>${exam.result.isMock ? 'Grad-CAM is not generated for mock predictions.' : cam?.reason === 'NO_POSITIVE_ACTIVATION' ? 'No positive class activation was found for this image. An overlay cannot be generated from this result.' : 'A Grad-CAM overlay has not been generated for this examination.'}</p>${!exam.result.isMock && exam.status === 'COMPLETED' ? `<button type="button" class="button secondary" data-action="generate-gradcam" data-id="${escape(id)}">Generate Grad-CAM</button><p class="help">Uses the saved image and the same model. Your stored screening prediction stays unchanged.</p>` : ''}</section>`;
  return `<section class="panel"><div class="panel-head"><h2>Grad-CAM visualization</h2><span class="badge LOW">${escape(labels[cam.targetClass] ?? cam.targetClass)}</span></div><div class="image-grid"><figure><img src="/api/examinations/${encodeURIComponent(id)}/images/gradcam" alt="Grad-CAM overlay on the preprocessed image"><figcaption>Model attention overlay</figcaption></figure><figure><img src="/api/examinations/${encodeURIComponent(id)}/images/heatmap" alt="Grad-CAM activation map"><figcaption>Low activation (blue) to high activation (red)</figcaption></figure></div><p class="help">This map shows the relative contribution of image regions to the predicted class. It does not identify lesions or confirm a diagnosis. Coordinates refer to the preprocessed image.</p><details><summary>Method details</summary><p class="help">${escape(cam.method)} · ${escape(cam.version)} · ${escape(cam.layer)}</p></details></section>`;
}

async function examination(id) {
  const exam = await api(`/api/examinations/${enc(id)}`), result = exam.result;
  const busy = BUSY.includes(exam.status);
  main.innerHTML = heading('Examination results', `${exam.patientId} · Eye ${eyeLabel(exam.eye).toLowerCase()} · ${date(exam.createdAt)}`,
    `${exam.status === 'COMPLETED' ? `<a class="button secondary" href="/api/examinations/${enc(id)}/report" target="_blank" rel="noopener">${icons.file}Download report</a>` : ''}
     <button type="button" class="button danger-outline" data-action="delete-exam" data-id="${escape(id)}" data-patient="${escape(exam.patientId)}"${busy ? ' disabled title="Still processing; cannot be deleted yet"' : ''}>${icons.trash}Delete</button>`,
    `<a class="back" href="/patients/${enc(exam.patientId)}">${icons.back}History ${escape(exam.patientId)}</a>`) +
    `<div class="notice">${busy ? '<span class="spinner"></span>' : ''}Status ${badge(exam.status)} · ${escape(exam.captureType)}${result?.isMock ? ' · MOCK result: dummy prediction for testing.' : ''}</div>` +
    (busy ? processingStatus('Analyzing your image…', 'Your screening results and visualization are being generated. This may take a moment.') : '') +
    (exam.error ? errorBox(Object.assign(new Error(exam.error.message), { code: exam.error.code })) : '') +
    `<div class="results"><div>
      <section class="panel"><h2>${exam.status === 'REJECTED' ? 'Rejected image' : 'Fundus images'}</h2>${exam.image ? `<div class="image-grid"><figure><img src="/api/examinations/${enc(id)}/images/original" alt="Original fundus image"><figcaption>Original · ${escape(exam.image.originalResolution.join(' × '))}</figcaption></figure>${exam.image.processedPath ? `<figure><img src="/api/examinations/${enc(id)}/images/processed" alt="Preprocessed fundus image"><figcaption>Processed (CLAHE) · 300 × 300</figcaption></figure>` : ''}</div>` : empty('No image uploaded yet.')}</section>
      <section class="panel"><h2>Status history</h2><ol class="timeline">${exam.statusHistory.map(s => `<li class="${escape(s.status)}"><b>${escape(statusLabels[s.status] ?? s.status)}</b><time>${escape(date(s.timestamp))}</time></li>`).join('')}</ol></section>
    </div><div>
      <section class="panel"><div class="eyebrow">AI SCREENING</div>${result ? `<div class="prediction">${escape(labels[result.predictedClass] ?? result.predictedClass)}</div>
        <div class="meta"><div><span>Confidence</span><b>${(result.confidence * 100).toFixed(1)}%</b></div><div><span>${result.riskLevel === 'NOT_ASSESSED' ? 'Screening type' : 'Risk category'}</span>${result.riskLevel === 'NOT_ASSESSED' ? '<b>DR / No DR</b>' : badge(result.riskLevel)}</div></div>
        ${Object.entries(result.probabilities).map(([name, probability]) => `<div class="probability${name === result.predictedClass ? ' top' : ''}"><div><span>${escape(labels[name] ?? name)}</span><b>${(probability * 100).toFixed(1)}%</b></div><div class="bar"><i style="width:${probability * 100}%"></i></div></div>`).join('')}
        <div class="notice">${result.isMock ? 'Dummy prediction for integration testing.' : 'Actual model prediction. Review with a healthcare professional.'}${result.riskLevel === 'NOT_ASSESSED' ? ' The model predicts DR or No DR and does not assess severity. These are screening predictions, not confirmed diagnoses.' : ` Risk category follows rule ${escape(result.riskRuleVersion || 'legacy')}.`}</div>` : empty('Results are not available yet.')}</section>
      <section class="panel"><h2>Metadata</h2><div class="meta"><div><span>Examination ID</span><b class="mono">${escape(id)}</b></div><div><span>Model</span><b>${escape(result?.modelVersion || '—')}</b></div><div><span>Preprocessing</span><b>${escape(exam.image?.preprocessingVersion || '—')}</b></div><div><span>Completed</span><b>${escape(date(exam.completedAt))}</b></div></div></section>
      ${['CREATED', 'FAILED', 'REJECTED'].includes(exam.status) ? `<a class="button" href="/examinations/new?patientId=${enc(exam.patientId)}">${icons.plus}New examination</a>` : ''}
    </div></div>`;
  main.querySelector('.results > div > .panel')?.insertAdjacentHTML('afterend', explanationPanel(exam, id));
  if (result && result.confidence < 0.6) main.querySelector('.results > div:nth-child(2) > .panel')?.insertAdjacentHTML('beforeend', '<div class="notice uncertainty">The highest class probability is below 60%. Review is required; do not use this result as the sole basis for a medical decision.</div>');
  if (exam.image) main.querySelector('.results > div:nth-child(2) .meta:last-child')?.insertAdjacentHTML('beforeend', `<div><span>Device</span><b>${escape(exam.image.deviceId || 'Manual upload')}</b></div><div><span>Analysis time</span><b>${result?.inferenceTimeMs !== undefined ? (result.inferenceTimeMs / 1000).toFixed(2) + ' seconds' : 'Not recorded'}</b></div>`);
  if (busy) setTimeout(() => { if (location.pathname === `/examinations/${id}`) examination(id).catch(error => { main.innerHTML = errorBox(error); }); }, 2000);
}

// ---------- Actions (edit / delete) ----------
const onDetailPage = prefix => location.pathname.startsWith(prefix);
const actions = {
  'generate-gradcam': async ({ id }) => {
    const button = main.querySelector('[data-action="generate-gradcam"]');
    button.disabled = true;
    button.textContent = 'Generating Grad-CAM…';
    const progress = document.createElement('div');
    progress.innerHTML = processingStatus('Generating visualization…');
    button.closest('.panel').append(progress);
    try {
      const updated = await api(`/api/examinations/${enc(id)}/explanation`, { method: 'POST' });
      await examination(id);
      toast(updated.result.explanation?.status === 'AVAILABLE' ? 'Grad-CAM generated.' : 'Grad-CAM is unavailable for this image.');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Generate Grad-CAM';
      progress.remove();
      throw error;
    }
  },
  'delete-exam': ({ id, patient }) => openModal({
    title: 'Delete examination?', danger: true, confirmLabel: 'Delete examination',
    body: `<p>The examination for patient <b>${escape(patient)}</b> and its fundus images and AI results will be permanently deleted.</p><p class="warning-text">This action cannot be undone.</p>`,
    onSubmit: async () => {
      const deleted = await api(`/api/examinations/${enc(id)}`, { method: 'DELETE' });
      if (!deleted.filesRemoved) toast('The examination was deleted, but some image files could not be removed.', 'error');
      if (onDetailPage('/examinations/')) { flash('Examination deleted.'); location.href = `/patients/${enc(patient)}`; return; }
      toast('Examination deleted.');
      await route();
    }
  }),
  'edit-patient': async ({ id }) => {
    const patient = await api(`/api/patients/${enc(id)}`);
    openModal({
      title: 'Edit patient', confirmLabel: 'Save changes',
      body: `<div class="field"><label for="edit-code">Anonymous patient code</label><input id="edit-code" name="patientId" pattern="${PATIENT_PATTERN}" maxlength="64" value="${escape(patient.patientId)}" required><p class="help">Changing the code also updates this patient’s entire examination history.</p></div>
        <div class="field"><label for="edit-notes">Notes <span class="optional">(optional)</span></label><textarea id="edit-notes" name="notes" maxlength="500" rows="4" placeholder="e.g. routine follow-up, 5-year history of diabetes">${escape(patient.notes)}</textarea><p class="help">Do not enter personal identifiers (names, identity numbers, addresses).</p></div>`,
      onSubmit: async form => {
        const updated = await api(`/api/patients/${enc(id)}`, json('PATCH', { patientId: form.elements.patientId.value.trim(), notes: form.elements.notes.value }));
        if (onDetailPage('/patients/')) history.replaceState(null, '', `/patients/${enc(updated.patientId)}`);
        toast('Patient updated.');
        await route();
      }
    });
  },
  'delete-patient': ({ id, count }) => openModal({
    title: 'Delete patient?', danger: true, confirmLabel: 'Delete patient', confirmText: id,
    body: `<p>Patient <b>${escape(id)}</b>${Number(count) ? ` and <b>${Number(count)} examinations</b>, fundus images, and AI results` : ''} will be permanently deleted.</p><p class="warning-text">This action cannot be undone.</p>`,
    onSubmit: async () => {
      const deleted = await api(`/api/patients/${enc(id)}`, { method: 'DELETE' });
      if (!deleted.filesRemoved) toast('The patient was deleted, but some image files could not be removed.', 'error');
      if (onDetailPage('/patients/')) { flash(`Patient ${id} deleted.`); location.href = '/patients'; return; }
      toast(`Patient ${id} deleted.`);
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
function nextPage() {
  const next = new URLSearchParams(location.search).get('next') || '/dashboard';
  return /^\/(?:dashboard|patients(?:\/[^/?#]+)?|examinations\/(?:new|[^/?#]+))(?:\?[^#]*)?$/.test(next) ? next : '/dashboard';
}

function authenticationPage(register = false, preview = false) {
  document.body.classList.add('auth-page');
  document.querySelector('#system').textContent = preview ? 'Frontend preview' : 'Private workspace';
  const next = enc(nextPage());
  main.innerHTML = `<div class="auth-layout"><section class="auth-intro"><div class="auth-mark" aria-hidden="true">◉</div><h1>LUXORA</h1><p>AI-assisted retinal screening, with patient records and examination histories kept separate for every account.</p><div class="auth-features"><span>◉ Fundus image analysis</span><span>◉ Personal patient workspace</span><span>◉ Original images and screening reports</span></div></section>
    <section class="panel auth-card"><div class="eyebrow">YOUR LUXORA WORKSPACE</div><h2>${register ? 'Create your account' : 'Welcome back'}</h2><p>${register ? 'Set up a private workspace for your patients.' : 'Sign in to access your patients and examinations.'}</p>
    ${preview ? '<div class="notice">This preview is not connected to a backend. Open your backend or Cloudflare URL to sign in or create an account.</div>' : ''}
    <form id="auth-form">${register ? '<div class="field"><label for="auth-name">Name</label><input id="auth-name" name="name" autocomplete="name" minlength="2" maxlength="80" required></div>' : ''}
      <div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="username" maxlength="254" required></div>
      <div class="field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" ${register ? 'minlength="12"' : ''} maxlength="128" required>${register ? '<p class="help">Use at least 12 characters.</p>' : ''}</div>
      ${register ? '<div class="field"><label for="auth-confirm">Confirm password</label><input id="auth-confirm" name="confirmation" type="password" autocomplete="new-password" minlength="12" maxlength="128" required></div>' : ''}
      <div id="auth-error" role="alert"></div><button class="auth-submit" type="submit" ${preview ? 'disabled' : ''}>${register ? 'Create account' : 'Sign in'} ${icons.arrow}</button>
    </form><p class="auth-switch">${register ? 'Already have an account?' : 'New to LUXORA?'} <a href="/${register ? 'login' : 'register'}?next=${next}">${register ? 'Sign in' : 'Create an account'}</a></p></section></div>`;
  document.querySelector('#auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (preview) return;
    const form = event.target, button = form.querySelector('[type=submit]'), errors = document.querySelector('#auth-error');
    errors.innerHTML = '';
    if (register && form.elements.password.value !== form.elements.confirmation.value) {
      errors.innerHTML = errorBox(new Error('The passwords do not match.'));
      return;
    }
    button.disabled = true;
    button.textContent = register ? 'Creating account…' : 'Signing in…';
    try {
      await api(`/api/auth/${register ? 'register' : 'login'}`, json('POST', {
        email: form.elements.email.value, password: form.elements.password.value,
        ...(register ? { name: form.elements.name.value } : {})
      }));
      sessionStorage.removeItem('flash');
      location.replace(nextPage());
    } catch (error) {
      errors.innerHTML = errorBox(error);
      button.disabled = false;
      button.textContent = register ? 'Create account' : 'Sign in';
    }
  });
}

function showAccount(user) {
  const account = document.querySelector('#account');
  account.hidden = false;
  account.innerHTML = `<div class="account-identity"><strong>${escape(user.name)}</strong><span>${escape(user.email)}</span></div><div class="account-actions"><button class="button ghost small" id="device-token" type="button">Camera token</button><button class="button ghost small" id="logout" type="button">Sign out</button></div>`;
  document.querySelector('#logout').addEventListener('click', async event => {
    event.target.disabled = true;
    try { await api('/api/auth/logout', { method: 'POST' }); sessionStorage.clear(); location.replace('/login'); }
    catch (error) {
      if (error.status === 401) { location.replace('/login'); return; }
      toast(error.message, 'error'); event.target.disabled = false;
    }
  });
  document.querySelector('#device-token').addEventListener('click', () => openModal({
    title: 'Connect a camera', confirmLabel: 'Generate token',
    body: '<p>Generate a token for your ESP camera. Uploads made with this token belong to your account. It expires after 7 days. Keep it private.</p><div id="camera-token-result"></div>',
    onSubmit: async () => {
      const { token, expiresAt } = await api('/api/auth/device-token', { method: 'POST' });
      // The token is shown once and is never saved in browser storage.
      const dialog = document.createElement('dialog');
      dialog.className = 'modal';
      dialog.innerHTML = `<div class="modal-card"><h2>Your camera token</h2><p>Copy this token now. It expires ${escape(date(expiresAt))}.</p><label for="camera-token-value">Bearer token</label><textarea id="camera-token-value" readonly spellcheck="false">${escape(token)}</textarea><p class="help">Send it in the Authorization: Bearer header. Never share it publicly.</p><div class="modal-actions"><button type="button">Done</button></div></div>`;
      document.body.append(dialog);
      dialog.querySelector('button').addEventListener('click', () => { dialog.close(); dialog.remove(); });
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      dialog.showModal(); dialog.querySelector('textarea').select();
    }
  }));
}

function frontendPreview(path) {
  const system = document.querySelector('#system');
  system.textContent = 'Backend not connected';
  system.classList.add('not-ready');
  const notice = '<section class="panel"><h2>Frontend ready, backend not connected</h2><p>This is a preview of LUXORA. Sign-in, patient records, image uploads, AI analysis, and reports require a connected backend.</p></section>';
  if (path === '/' || path === '/dashboard' || path === '/devices') {
    main.innerHTML = heading('Dashboard', 'Preview of the diabetic retinopathy screening workspace.') + notice +
      `<div class="cards">${card('Total examinations', '—', 'Waiting for backend connection', icons.activity)}${card('Completed', '—', 'Waiting for backend connection', icons.check, 'ok')}${card('Failed', '—', 'Waiting for backend connection', icons.x)}${card('Patients', '—', 'Waiting for backend connection', icons.users)}</div>` +
      '<section class="panel"><div class="panel-head"><h2>Recent examinations</h2><a class="link" href="/patients">View patient</a></div><p class="muted">Examination data is unavailable until the backend is connected.</p></section>';
  } else {
    const title = path.startsWith('/patients') ? 'Patient' : 'Examination';
    main.innerHTML = heading(title, 'This feature requires a backend connection.') + notice + '<a class="button secondary" href="/dashboard">Back to dashboard</a>';
  }
}

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
  if (window.FUNDUS_FRONTEND_ONLY === true) {
    if (path === '/login' || path === '/register') { authenticationPage(path === '/register', true); return; }
    frontendPreview(path);
    return;
  }
  const message = sessionStorage.getItem('flash');
  if (message) { sessionStorage.removeItem('flash'); toast(message); }
  try {
    let user;
    try { ({ user } = await api('/api/auth/me')); }
    catch (error) {
      if (error.status !== 401) throw error;
      if (path === '/login' || path === '/register') authenticationPage(path === '/register');
      else location.replace(`/login?next=${enc(path + location.search)}`);
      return;
    }
    if (path === '/login' || path === '/register') { location.replace(nextPage()); return; }
    showAccount(user);
    const system = await api('/api/system');
    const el = document.querySelector('#system');
    el.innerHTML = `<span class="online-dot"></span>${escape(system.storage.toUpperCase())} · ${system.aiMode === 'model' ? 'Actual model' : 'MOCK mode'} · ${system.aiReady ? 'Ready' : 'AI not ready'}`;
    el.classList.toggle('mock', system.aiMode !== 'model');
    el.classList.toggle('not-ready', !system.aiReady);
    await route();
  } catch (error) {
    main.innerHTML = heading('Unable to load this page', 'Check your backend connection and try again.') + errorBox(error) + '<button type="button" onclick="location.reload()">Try again</button>';
  }
}
init();
