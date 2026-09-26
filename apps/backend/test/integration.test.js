import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { createApp } from '../src/app.js';

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
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); store.close(); rmSync(dir, { recursive: true, force: true }); });
  const request = async (path, options) => { const r = await fetch(base + path, options); return { status: r.status, body: await r.json() }; };
  const create = async () => (await request('/api/examinations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientId: 'TEST-001', eye: 'RIGHT', captureType: 'MACULA_CENTERED' }) })).body;
  const upload = (id, bytes = png, type = 'image/png', extra = {}) => {
    const form = new FormData(); form.append('image', new Blob([bytes], { type }), 'test.png');
    for (const [key, value] of Object.entries(extra)) form.append(key, value);
    return request(`/api/examinations/${id}/images`, { method: 'POST', body: form });
  };
  return { request, create, upload, config, store };
}
test('both health endpoints and real Python mock upload; bytes preserved and result persists', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/health')).status, 200);
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
  assert.deepEqual(other.store.get(exam.examinationId), r.body); other.store.close();
  assert.equal((await f.upload(exam.examinationId)).status, 409);
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
  assert.equal(f.store.get(e.examinationId).status, 'CREATED');
});
test('AI unavailable records FAILED and preserves original', async t => {
  const f = await fixture(t, { aiUrl: 'http://127.0.0.1:1' });
  const e = await f.create(), r = await f.upload(e.examinationId);
  assert.equal(r.status, 502);
  const saved = f.store.get(e.examinationId);
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
    assert.equal(f.store.get(e.examinationId).error.code, mode === 'timeout' ? 'AI_TIMEOUT' : 'INVALID_AI_RESPONSE');
  }
});
test('concurrent uploads allow only one inference', async t => {
  const f = await fixture(t), e = await f.create();
  const results = await Promise.all([f.upload(e.examinationId), f.upload(e.examinationId)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
});
test('Python rejects corrupt uploads directly', async () => {
  const body = new FormData(); body.append('image', new Blob(['invalid'], { type: 'image/png' }), 'bad.png');
  const r = await fetch(aiUrl + '/predict', { method: 'POST', body });
  assert.equal(r.status, 400);
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
    const saved = f.store.get(exam.examinationId);
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
    assert.equal(f.store.get(exam.examinationId).error.code, 'INVALID_AI_RESPONSE');
    assert.equal(f.store.get(exam.examinationId).result, null);
  }
});
