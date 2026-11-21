import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { createApp } from '../src/app.js';
import { createMongoStore } from '../src/store.js';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });

test('MongoDB accounts, session security and tenant isolation across all clinical routes', {
  skip: !process.env.TEST_MONGODB_URL, timeout: 120000
}, async t => {
  // A unique collection namespace isolates these tests from all real records.
  const prefix = `_luxora_test_${randomUUID().replaceAll('-', '')}_`;
  const databaseName = process.env.TEST_MONGODB_NAME || 'ai_fundus';
  const client = new MongoClient(process.env.TEST_MONGODB_URL);
  await client.connect();
  const db = client.db(databaseName);
  const dir = mkdtempSync(join(tmpdir(), 'luxora-auth-'));
  t.after(async () => {
    for (const name of ['users', 'sessions', 'auth_attempts', 'patients', 'examinations', 'fundus_images', 'ai_results']) {
      await db.collection(prefix + name).drop().catch(error => { if (error.code !== 26) throw error; });
    }
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  });
  await db.collection(prefix + 'patients').insertOne({ _id: 'LEGACY', createdAt: new Date().toISOString() });
  const store = await createMongoStore(process.env.TEST_MONGODB_URL, databaseName, { collectionPrefix: prefix });
  t.after(() => store.close());
  const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: '#b66330' } }).png().toBuffer();
  const inputValidation = { version: 'fundus-input-v1', method: 'local_clip_zero_shot', status: 'ACCEPTED',
    imageType: 'retinal_fundus', sourceSha256: createHash('sha256').update(png).digest('hex'), matchingScore: 1, similarity: 0.4, margin: 0.1 };
  const ai = createServer((req, res) => {
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/ready' ? { ready: true, mode: 'model' } : req.url === '/validate-image' ? { success: true, inputValidation } : {
      inputValidation,
      success: true, isMock: false, modelVersion: 'test-model', prediction: { class: 'DR', confidence: 0.8 },
      probabilities: { No_DR: 0.2, DR: 0.8 }, riskLevel: 'NOT_ASSESSED', preprocessingVersion: 'fundus-prep-v1',
      preprocessing: { version: 'fundus-prep-v1', mimeType: 'image/png', outputResolution: [300, 300], parameters: {}, imageBase64: png.toString('base64') },
      explanation: { status: 'AVAILABLE', method: 'Grad-CAM', version: 'gradcam-v1', targetClass: 'DR', coordinateSpace: 'processed',
        layer: 'test', outputResolution: [300, 300], mimeType: 'image/png', imageBase64: png.toString('base64'), heatmapBase64: png.toString('base64') }
    }));
  });
  const aiUrl = await listen(ai);
  t.after(() => close(ai));
  const { app } = createApp({ store, uploadDir: join(dir, 'uploads'), aiUrl, aiMode: 'model', aiTimeout: 3000, maxUploadBytes: 1048576 });
  const server = createServer(app), base = await listen(server);
  t.after(() => close(server));
  const request = async (path, { cookie, token, method = 'GET', body, csrf = true, headers = {} } = {}) => {
    const response = await fetch(base + path, { method, headers: {
      ...(csrf ? { 'X-Luxora-Request': '1' } : {}), ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...headers
    }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
    const raw = await response.text();
    let data; try { data = JSON.parse(raw); } catch { data = raw; }
    return { status: response.status, body: data, headers: response.headers, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const password = 'A long test password 42!';
  const a = await request('/api/auth/register', { method: 'POST', body: { name: 'Account A', email: 'Alice@Example.test', password }, headers: { 'X-Forwarded-Proto': 'https' } });
  const b = await request('/api/auth/register', { method: 'POST', body: { name: 'Account B', email: 'bob@example.test', password } });
  assert.equal(a.status, 201); assert.equal(b.status, 201);
  assert.equal(a.body.user.email, 'alice@example.test');
  assert.match(a.headers.get('set-cookie'), /HttpOnly/); assert.match(a.headers.get('set-cookie'), /SameSite=Lax/); assert.match(a.headers.get('set-cookie'), /Secure/);
  assert.doesNotMatch(JSON.stringify(a.body), /passwordHash|luxora_session/);
  assert.equal((await request('/api/auth/register', { method: 'POST', body: { name: 'Duplicate', email: 'ALICE@example.test', password } })).status, 409);
  assert.equal((await request('/api/auth/register', { method: 'POST', body: { name: 'Weak', email: 'weak@example.test', password: 'short' } })).status, 400);
  assert.equal((await request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.test', password: 'wrong' } })).status, 401);
  const login = await request('/api/auth/login', { method: 'POST', body: { email: 'alice@example.test', password } });
  assert.equal(login.status, 200);
  assert.equal((await request('/api/auth/me', { cookie: login.cookie })).body.user.id, a.body.user.id);
  const persisted = await db.collection(prefix + 'users').findOne({ _id: a.body.user.id });
  assert.notEqual(persisted.passwordHash, password); assert.match(persisted.passwordHash, /^[a-f0-9]{32}:[a-f0-9]{128}$/);
  const sessionToken = a.cookie.split('=')[1];
  const sessionHash = createHash('sha256').update(sessionToken).digest('hex');
  assert.ok(await db.collection(prefix + 'sessions').findOne({ _id: sessionHash }));
  assert.equal(await db.collection(prefix + 'sessions').findOne({ _id: sessionToken }), null);
  for (const path of ['/api/patients', '/api/examinations', '/api/devices', '/api/system', '/api/images/validate']) assert.equal((await request(path)).status, 401);
  assert.equal((await request('/api/patients', { method: 'POST', cookie: a.cookie, csrf: false, body: { patientId: 'NO-CSRF' } })).status, 403);
  assert.equal((await request('/api/patients', { method: 'POST', cookie: a.cookie, headers: { 'Sec-Fetch-Site': 'cross-site' }, body: { patientId: 'CROSS-SITE' } })).status, 403);
  for (const [account, notes] of [[a, 'Only A'], [b, 'Only B']]) {
    assert.equal((await request('/api/patients', { method: 'POST', cookie: account.cookie, body: { patientId: 'SAME-CODE', notes, ownerId: 'spoofed' } })).status, 201);
  }
  assert.equal((await request('/api/patients', { cookie: a.cookie })).body.length, 1);
  assert.equal((await request('/api/patients', { cookie: b.cookie })).body[0].notes, 'Only B');
  assert.equal((await request('/api/patients/LEGACY', { cookie: a.cookie })).status, 404);
  const exam = (await request('/api/examinations', { method: 'POST', cookie: a.cookie, body: {
    patientId: 'SAME-CODE', eye: 'RIGHT', captureType: 'MACULA_CENTERED', ownerId: b.body.user.id
  } })).body;
  const form = new FormData(); form.append('image', new Blob([png], { type: 'image/png' }), 'retina.png');
  const upload = await request(`/api/examinations/${exam.examinationId}/images`, { method: 'POST', cookie: a.cookie, body: form });
  assert.equal(upload.status, 200); assert.equal(upload.body.status, 'COMPLETED');
  const stored = await db.collection(prefix + 'examinations').findOne({ _id: exam.examinationId });
  assert.equal(stored.ownerId, a.body.user.id);
  for (const collection of ['fundus_images', 'ai_results']) assert.equal((await db.collection(prefix + collection).findOne()).ownerId, a.body.user.id);
  assert.equal((await request('/api/examinations?patientId=SAME-CODE', { cookie: b.cookie })).body.length, 0);
  for (const suffix of ['', '/images/original', '/images/processed', '/images/gradcam', '/images/heatmap', '/report']) {
    assert.equal((await request(`/api/examinations/${exam.examinationId}${suffix}`, { cookie: b.cookie })).status, 404, `Foreign access: ${suffix}`);
    assert.equal((await request(`/api/examinations/${exam.examinationId}${suffix}`)).status, 401);
  }
  for (const variant of ['original', 'processed', 'gradcam', 'heatmap']) assert.equal((await request(`/api/examinations/${exam.examinationId}/images/${variant}`, { cookie: a.cookie })).status, 200);
  assert.equal((await request(`/api/examinations/${exam.examinationId}`, { method: 'DELETE', cookie: b.cookie })).status, 404);
  assert.equal((await request(`/api/examinations/${exam.examinationId}/images`, { method: 'POST', cookie: b.cookie, body: form })).status, 404);
  assert.equal((await request(`/api/examinations/${exam.examinationId}/explanation`, { method: 'POST', cookie: b.cookie })).status, 404);
  assert.equal((await request(`/api/examinations/${exam.examinationId}/explanation`, { method: 'POST', cookie: a.cookie })).status, 200);
  for (const account of [a, b]) assert.equal((await request('/api/devices/CAMERA-01/status', { method: 'POST', cookie: account.cookie, body: { status: 'READY' } })).status, 200);
  assert.equal((await request('/api/devices', { cookie: a.cookie })).body.length, 1);
  assert.equal((await request('/api/devices/CAMERA-02/status', { method: 'POST', cookie: b.cookie, body: { status: 'READY', examinationId: exam.examinationId } })).status, 400);
  assert.equal((await request('/api/patients/SAME-CODE', { method: 'PATCH', cookie: b.cookie, body: { patientId: 'B-RENAMED' } })).status, 200);
  assert.equal((await request('/api/patients/SAME-CODE', { cookie: a.cookie })).body.notes, 'Only A');
  assert.equal((await request('/api/patients/B-RENAMED', { method: 'DELETE', cookie: b.cookie })).status, 200);
  assert.equal((await request(`/api/examinations/${exam.examinationId}`, { cookie: a.cookie })).status, 200);
  const tokenResponse = await request('/api/auth/device-token', { method: 'POST', cookie: a.cookie });
  assert.equal(tokenResponse.status, 201);
  const token = tokenResponse.body.token;
  assert.equal((await request('/api/patients', { token })).body[0].notes, 'Only A');
  assert.equal((await request('/api/patients', { token: 'invalid', cookie: a.cookie })).status, 401);
  // Independent connections verify sessions and owner scopes persist in MongoDB.
  const reopened = await createMongoStore(process.env.TEST_MONGODB_URL, databaseName, { collectionPrefix: prefix });
  assert.equal((await reopened.forUser(a.body.user.id).get(exam.examinationId)).status, 'COMPLETED');
  assert.equal(await reopened.forUser(b.body.user.id).get(exam.examinationId), null);
  assert.ok(await reopened.auth.findSession(createHash('sha256').update(token).digest('hex')));
  await reopened.close();
  await db.collection(prefix + 'sessions').updateOne({ _id: sessionHash }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await request('/api/auth/me', { cookie: a.cookie })).status, 401);
  assert.equal((await request('/api/auth/logout', { method: 'POST', token })).status, 200);
  assert.equal((await request('/api/patients', { token })).status, 401);
  const logout = await request('/api/auth/logout', { method: 'POST', cookie: b.cookie });
  assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await request('/api/auth/me', { cookie: b.cookie })).status, 401);
  let limited;
  for (let i = 0; i < 16; i++) limited = await request('/api/auth/login', { method: 'POST', body: { email: 'unknown@example.test', password } });
  assert.equal(limited.status, 429);
});

test('clinical API cannot accidentally start without an account store', () => {
  const dir = mkdtempSync(join(tmpdir(), 'luxora-required-auth-'));
  try {
    assert.throws(() => createApp({ store: {}, uploadDir: dir }), /requires a MongoDB account store/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
