import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { scoreRisk } from '../src/risk.js';

let ai, aiUrl, png;
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
before(async () => {
  const probe = createServer();
  const url = await listen(probe), port = probe.address().port;
  await new Promise(r => probe.close(r));
  aiUrl = url;
  ai = spawn(process.env.PYTHON || resolve('.venv/Scripts/python.exe'), ['services/ai-service/app.py'],
    { env: { ...process.env, AI_MODE: 'mock', AI_SERVICE_PORT: String(port), AI_SERVICE_HOST: '127.0.0.1' }, stdio: 'pipe', windowsHide: true });
  let logs = '', spawnError;
  ai.on('error', e => { spawnError = e; });
  ai.stderr.on('data', d => { logs += d; });
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    try { if ((await fetch(`${aiUrl}/health`)).ok) break; } catch {}
    if (i === 99 || ai.exitCode !== null) throw new Error(`AI startup failed: ${logs}`);
    await delay(100);
  }
  png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#c47b30' } }).png().toBuffer();
});
after(() => ai?.kill());

async function fixture(t, overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'fundus-test-'));
  const config = { databasePath: join(dir, 'db.sqlite'), uploadDir: join(dir, 'uploads'), aiUrl, aiTimeout: 3000, maxUploadBytes: 1024 * 1024, ...overrides };
  const { app, store } = createApp(config);
  const server = createServer(app), base = await listen(server);
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await store.close(); rmSync(dir, { recursive: true, force: true }); });
  const request = async (path, options) => { const r = await fetch(base + path, options); return { status: r.status, body: await r.json() }; };
  const create = async () => (await request('/api/examinations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId: 'TEST-001', eye: 'RIGHT', captureType: 'MACULA_CENTERED' }) })).body;
  const upload = (id, bytes = png, type = 'image/png', extra = {}) => {
    const form = new FormData(); form.append('image', new Blob([bytes], { type }), 'test.png');
    for (const [key, value] of Object.entries(extra)) form.append(key, value);
    return request(`/api/examinations/${id}/images`, { method: 'POST', body: form });
  };
  return { request, create, upload, config, store, base };
}
test('both health endpoints and real Python mock upload; bytes preserved and result persists', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/health')).status, 200);
  assert.equal((await f.request('/api/system')).body.aiReady, true);
  assert.equal((await (await fetch(aiUrl + '/health')).json()).modelLoaded, false);
  const exam = await f.create();
  const r = await f.upload(exam.examinationId);
  assert.equal(r.status, 200); assert.equal(r.body.status, 'COMPLETED');
  assert.equal(r.body.result.modelVersion, 'mock-v0'); assert.equal(r.body.result.isMock, true);
  assert.equal(r.body.result.confidence, 0.81);
  assert.equal(r.body.result.preprocessingVersion, 'fundus-prep-v1');
  assert.equal(r.body.image.preprocessingVersion, 'fundus-prep-v1');
  assert.notEqual(r.body.image.processedPath, r.body.image.originalPath);
  assert.deepEqual(r.body.image.processedResolution, [300, 300]);
  const processed = await sharp(readFileSync(join(f.config.uploadDir, r.body.image.processedPath))).metadata();
  assert.equal(processed.format, 'png'); assert.equal(processed.width, 300); assert.equal(processed.height, 300);
  assert.deepEqual((await f.request(`/api/examinations/${exam.examinationId}`)).body, r.body);
  assert.deepEqual(r.body.statusHistory.map(s => s.status), ['CREATED', 'IMAGE_RECEIVED', 'PROCESSING', 'COMPLETED']);
  assert.deepEqual(readFileSync(join(f.config.uploadDir, r.body.image.originalPath)), png);
  const other = createApp(f.config);
  assert.deepEqual(await other.store.get(exam.examinationId), r.body); await other.store.close();
  assert.equal((await f.upload(exam.examinationId)).status, 409);
});
test('device statuses validate references and uploads preserve camera metadata', async t => {
  const f = await fixture(t), exam = await f.create();
  const endpoint = '/api/devices/ESP32-SIM-01/status';
  const post = body => f.request(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ status: 'BOGUS' })).status, 400);
  assert.equal((await post({ status: 'UPLOADING', examinationId: 'missing' })).status, 400);
  for (const status of ['IDLE', 'READY', 'CAPTURING', 'UPLOADING']) {
    assert.equal((await post({ status, examinationId: exam.examinationId })).status, 200);
  }
  const timestamp = new Date().toISOString();
  const result = await f.upload(exam.examinationId, png, 'image/png', { device_id: 'ESP32-SIM-01', capture_timestamp: timestamp });
  assert.equal(result.status, 200);
  assert.equal(result.body.image.deviceId, 'ESP32-SIM-01');
  assert.equal(result.body.image.capturedAt, timestamp);
  const device = (await f.request('/api/devices')).body[0];
  assert.equal(device.isOnline, true);
  assert.deepEqual(device.statusHistory.map(s => s.status), ['IDLE', 'READY', 'CAPTURING', 'UPLOADING']);
  await post({ status: 'UPLOADING', examinationId: exam.examinationId });
  assert.equal((await f.request('/api/devices')).body[0].statusHistory.length, 4);
  assert.equal((await fetch(f.base + '/devices')).status, 200);
  assert.equal((await post({ status: 'ERROR', message: 'Camera capture failed' })).status, 200);
  assert.equal((await f.request('/api/devices')).body[0].message, 'Camera capture failed');
});

test('real explanation images persist without base64 and reject a mismatched class', async t => {
  const form = new FormData(); form.append('image', new Blob([png], { type: 'image/png' }), 'test.png');
  const sample = await (await fetch(aiUrl + '/predict', { method: 'POST', body: form })).json();
  const processed = sample.preprocessing.imageBase64;
  let targetClass = 'Moderate';
  const upstream = createServer((req, res) => { req.resume(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({
    ...sample, isMock: false, modelVersion: 'fixture-model-v1', explanation: { status: 'AVAILABLE', method: 'Grad-CAM',
      version: 'gradcam-v1', targetClass, coordinateSpace: 'processed', layer: 'test/top_conv', outputResolution: [300, 300],
      mimeType: 'image/png', imageBase64: processed, heatmapBase64: processed }
  })); });
  const url = await listen(upstream);
  t.after(() => { upstream.closeAllConnections(); upstream.close(); });
  const f = await fixture(t, { aiMode: 'model', aiUrl: url });
  const exam = await f.create(), result = await f.upload(exam.examinationId);
  assert.equal(result.status, 200);
  assert.equal(result.body.result.explanation.status, 'AVAILABLE');
  assert.equal(JSON.stringify(result.body).includes('imageBase64'), false);
  assert.match(result.body.image.gradcamSha256, /^[a-f0-9]{64}$/);
  const image = await fetch(`${f.base}/api/examinations/${exam.examinationId}/images/gradcam`);
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(processed, 'base64'));
  targetClass = 'Severe';
  const other = await f.create();
  assert.equal((await f.upload(other.examinationId)).body.error.code, 'INVALID_AI_RESPONSE');
});

test('invalid metadata, missing file, unknown ID, spoofed image, oversized image', async t => {
  const f = await fixture(t, { maxUploadBytes: png.length + 10 });
  assert.equal((await f.request('/api/examinations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 400);
  assert.equal((await f.request('/api/examinations/missing')).status, 404);
  const e = await f.create();
  assert.equal((await f.request(`/api/examinations/${e.examinationId}/images`, { method: 'POST' })).status, 400);
  assert.equal((await f.upload(e.examinationId, Buffer.from('fake png'))).status, 400);
  assert.equal((await f.upload(e.examinationId, png, 'text/plain')).status, 400);
  assert.equal((await f.upload(e.examinationId, png, 'image/png', { eye: 'LEFT' })).status, 400);
  assert.equal((await f.upload(e.examinationId, Buffer.alloc(png.length + 11))).status, 413);
  assert.equal((await f.store.get(e.examinationId)).status, 'CREATED');
});
test('AI unavailable records FAILED and preserves original', async t => {
  const f = await fixture(t, { aiUrl: 'http://127.0.0.1:1' });
  assert.equal((await f.request('/api/system')).body.aiReady, false);
  const e = await f.create(), r = await f.upload(e.examinationId);
  assert.equal(r.status, 502);
  const saved = await f.store.get(e.examinationId);
  assert.equal(saved.status, 'FAILED'); assert.equal(saved.error.code, 'AI_UNAVAILABLE');
  assert.equal(saved.result, null); assert.ok(saved.image);
});
test('timeout and malformed upstream response fail instead of completing', async t => {
  for (const mode of ['timeout', 'invalid']) {
    const upstream = createServer((req, res) => { req.resume(); if (mode === 'invalid') res.end('{}'); });
    const url = await listen(upstream);
    t.after(() => { upstream.closeAllConnections(); upstream.close(); });
    const f = await fixture(t, { aiUrl: url, aiTimeout: 100 });
    const e = await f.create(), r = await f.upload(e.examinationId);
    assert.equal(r.status, 502);
    assert.equal((await f.store.get(e.examinationId)).error.code, mode === 'timeout' ? 'AI_TIMEOUT' : 'INVALID_AI_RESPONSE');
  }
});
test('concurrent uploads allow only one inference', async t => {
  const f = await fixture(t), e = await f.create();
  const results = await Promise.all([f.upload(e.examinationId), f.upload(e.examinationId)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});
test('delete examination removes child records and images, preserves patient and other examinations', async t => {
  const f = await fixture(t), exam = await f.create(), other = await f.create();
  const completed = (await f.upload(exam.examinationId)).body;
  const untouched = join(f.config.uploadDir, 'unrelated.png'); writeFileSync(untouched, png);
  const response = await f.request(`/api/examinations/${exam.examinationId}`, { method: 'DELETE' });
  assert.equal(response.status, 200); assert.equal(response.body.filesRemoved, true);
  assert.equal((await f.request(`/api/examinations/${exam.examinationId}`)).status, 404);
  assert.equal((await fetch(`${f.base}/api/examinations/${exam.examinationId}/report`)).status, 404);
  assert.equal((await f.request(`/api/examinations/${exam.examinationId}`, { method: 'DELETE' })).status, 404);
  assert.equal(existsSync(join(f.config.uploadDir, completed.image.originalPath)), false);
  assert.equal(existsSync(join(f.config.uploadDir, completed.image.processedPath)), false);
  assert.equal(existsSync(untouched), true);
  assert.equal((await f.request('/api/patients')).body.length, 1);
  assert.equal((await f.request('/api/examinations')).body[0].examinationId, other.examinationId);
  const db = new DatabaseSync(f.config.databasePath);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fundus_images WHERE examinationId=?').get(exam.examinationId).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_results WHERE examinationId=?').get(exam.examinationId).n, 0);
  db.close();
  const reopened = createApp(f.config); assert.equal(reopened.store.get(exam.examinationId), null); reopened.store.close();
});
test('delete refuses processing examinations and never unlinks outside upload directory', async t => {
  const f = await fixture(t), exam = await f.create();
  exam.status = 'PROCESSING'; await f.store.save(exam);
  assert.equal((await f.request(`/api/examinations/${exam.examinationId}`, { method: 'DELETE' })).status, 409);
  const outside = join(f.config.uploadDir, '..', 'keep.txt'); writeFileSync(outside, 'keep');
  exam.status = 'FAILED'; exam.image = { imageId: 'test', originalPath: '../keep.txt', processedPath: 'missing.png' };
  await f.store.save(exam);
  assert.equal((await f.request(`/api/examinations/${exam.examinationId}`, { method: 'DELETE' })).status, 200);
  assert.equal(existsSync(outside), true);
});
test('Python rejects corrupt uploads directly', async () => {
  const body = new FormData(); body.append('image', new Blob(['invalid'], { type: 'image/png' }), 'bad.png');
  const r = await fetch(aiUrl + '/predict', { method: 'POST', body });
  assert.equal(r.status, 400);
});

test('patient history, private image retrieval and frontend work with persisted examinations', async t => {
  const f = await fixture(t);
  const patient = await f.request('/api/patients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId: 'TEST-001' }) });
  assert.equal(patient.status, 201);
  assert.equal((await f.request('/api/patients')).body[0].patientId, 'TEST-001');
  const exam = await f.create();
  assert.equal((await f.request('/api/examinations?patientId=TEST-001')).body.length, 1);
  assert.equal((await f.request('/api/examinations?patientId=OTHER')).body.length, 0);
  assert.equal((await f.request('/api/examinations?patientId[]=bad')).status, 400);
  assert.equal((await f.request(`/api/examinations/${exam.examinationId}/images/processed`)).status, 404);
  const uploaded = await f.upload(exam.examinationId);
  assert.equal(uploaded.body.result.riskRuleVersion, 'dr-grade-risk-v1');
  assert.equal(uploaded.body.result.imageId, uploaded.body.image.imageId);
  const image = await fetch(`${f.base}/api/examinations/${exam.examinationId}/images/original`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  const page = await fetch(`${f.base}/patients`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Fundus/);
});

test('risk categories are versioned and independent of inference', () => {
  for (const [name, level] of Object.entries({ No_DR: 'LOW', Mild: 'LOW', Moderate: 'MEDIUM', Severe: 'HIGH', Proliferative_DR: 'HIGH' })) {
    assert.deepEqual(scoreRisk(name), { riskLevel: level, riskRuleVersion: 'dr-grade-risk-v1' });
  }
  assert.throws(() => scoreRisk('invalid'));
});

test('model readiness errors persist as FAILED without fallback', async t => {
  for (const code of ['MODEL_NOT_READY', 'MODEL_LOAD_FAILED']) {
    const upstream = createServer((req, res) => {
      req.resume(); res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: { code } }));
    });
    const url = await listen(upstream);
    t.after(() => { upstream.closeAllConnections(); upstream.close(); });
    const f = await fixture(t, { aiUrl: url, aiMode: 'model' });
    const exam = await f.create(), response = await f.upload(exam.examinationId);
    assert.equal(response.status, 502);
    const saved = await f.store.get(exam.examinationId);
    assert.equal(saved.status, 'FAILED'); assert.equal(saved.error.code, code);
    assert.equal(saved.result, null); assert.equal(saved.image.processedPath, null);
    assert.deepEqual(readFileSync(join(f.config.uploadDir, saved.image.originalPath)), png);
  }
});

test('invalid preprocessing, null response and a mock/model mode mismatch are rejected', async t => {
  const form = new FormData(); form.append('image', new Blob([png], { type: 'image/png' }), 'test.png');
  const valid = await (await fetch(aiUrl + '/predict', { method: 'POST', body: form })).json();
  const badImage = structuredClone(valid); badImage.preprocessing.imageBase64 = Buffer.from('corrupt').toString('base64');
  const badVersion = structuredClone(valid); badVersion.preprocessingVersion = 'unknown';
  const missingImage = structuredClone(valid); delete missingImage.preprocessing;
  for (const [body, aiMode] of [[null, 'mock'], [badImage, 'mock'], [badVersion, 'mock'], [missingImage, 'mock'], [valid, 'model']]) {
    const upstream = createServer((req, res) => { req.resume(); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); });
    const url = await listen(upstream);
    t.after(() => { upstream.closeAllConnections(); upstream.close(); });
    const f = await fixture(t, { aiUrl: url, aiMode });
    const exam = await f.create(), response = await f.upload(exam.examinationId);
    assert.equal(response.status, 502);
    assert.equal((await f.store.get(exam.examinationId)).error.code, 'INVALID_AI_RESPONSE');
    assert.equal((await f.store.get(exam.examinationId)).result, null);
  }
});

test('PDF export uses current result and real generator; incomplete and Python failure are handled', async t => {
  const f = await fixture(t, { reportPython: 'python' }), exam = await f.create();
  const endpoint = `/api/examinations/${exam.examinationId}/report`;
  assert.equal((await f.request(endpoint)).status, 409);
  const result = (await f.upload(exam.examinationId)).body;
  const response = await fetch(f.base + endpoint);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /attachment; filename="report-/);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 2000);
  const { toPayload } = await import('../src/report.js');
  result.result.explanation = { status: 'AVAILABLE' }; result.image.gradcamPath = 'actual-gradcam.png';
  const payload = toPayload(result, f.config.uploadDir);
  assert.equal(payload.images.gradcam, resolve(f.config.uploadDir, 'actual-gradcam.png'));
  assert.equal(payload.provenance.is_mock, true);
  assert.deepEqual(payload.probabilities, result.result.probabilities);
  result.image.gradcamPath = '../outside.png';
  assert.equal(toPayload(result, f.config.uploadDir).images.gradcam, null);
  const broken = await fixture(t, { reportPython: resolve('missing-python.exe') }), pending = await broken.create();
  await broken.upload(pending.examinationId);
  const error = await broken.request(`/api/examinations/${pending.examinationId}/report`);
  assert.equal(error.status, 500); assert.equal(error.body.error.code, 'REPORT_FAILED');
  assert.equal((await broken.request(`/api/examinations/${pending.examinationId}`)).body.status, 'COMPLETED');
});
