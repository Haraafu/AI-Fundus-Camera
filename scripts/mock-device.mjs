import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { extname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Upload is never retried blindly: inspect the examination after a timeout.
const flags = process.argv.slice(2).filter(value => value.startsWith('--'));
if (flags.some(value => value !== '--watch' && !value.startsWith('--eye=') && !value.startsWith('--capture-type='))) {
  console.error('Unknown option. Supported: --watch, --eye=LEFT|RIGHT, --capture-type=MACULA_CENTERED|OPTIC_DISC_CENTERED'); process.exit(1);
}
const args = process.argv.slice(2).filter(value => !value.startsWith('--'));
const imagePath = args[0];
if (!imagePath) { console.error('Usage: npm run device:mock -- image.png [patientId] [deviceId] [--watch]'); process.exit(1); }
const base = (process.env.BACKEND_URL || `http://127.0.0.1:${process.env.BACKEND_PORT || 3001}`).replace(/\/$/, '');
const patientId = args[1] || 'DEMO-DEVICE', deviceId = args[2] || 'ESP32-SIM-01';
const eye = flags.find(value => value.startsWith('--eye='))?.split('=')[1] || 'RIGHT';
const captureType = flags.find(value => value.startsWith('--capture-type='))?.split('=')[1] || 'MACULA_CENTERED';
if (!['LEFT', 'RIGHT'].includes(eye) || !['MACULA_CENTERED', 'OPTIC_DISC_CENTERED'].includes(captureType)) {
  console.error('Invalid eye or capture type.'); process.exit(1);
}
const mime = ['.jpg', '.jpeg'].includes(extname(imagePath).toLowerCase()) ? 'image/jpeg' : 'image/png';
const bytes = readFileSync(resolve(imagePath));
const sha256 = createHash('sha256').update(bytes).digest('hex');
const authorization = process.env.LUXORA_DEVICE_TOKEN ? { Authorization: `Bearer ${process.env.LUXORA_DEVICE_TOKEN}` } : {};
let examinationId;
let capturedAt;
let requestId;
let uploadStarted;
let requestTimeout = 120000;
let heartbeat;
async function request(path, body, multipart = false) {
  const response = await fetch(base + path, { method: 'POST', headers: { ...authorization, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    body: multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(requestTimeout) });
  if (multipart) requestId = response.headers.get('x-request-id');
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error?.code || response.status}: ${data.error?.message || 'Request failed'}`);
  return data;
}
async function status(value, message) {
  const result = await request(`/api/devices/${encodeURIComponent(deviceId)}/status`, { status: value, examinationId, message });
  console.log(`${result.lastSeen} ${deviceId}: ${value}`);
}
async function get(path) {
  const response = await fetch(base + path, { headers: authorization, signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.code || `HTTP ${response.status}`);
  return body;
}
function printResult(completed) {
  console.log(JSON.stringify({ status: completed.status, prediction: completed.result?.predictedClass,
    isMock: completed.result?.isMock, explanation: completed.result?.explanation?.status,
    receiptVerified: true, requestId, examinationId, deviceId, eye, captureType,
    sizeBytes: completed.image.sizeBytes, inferenceTimeMs: completed.result?.inferenceTimeMs,
    elapsedMs: Math.round(performance.now() - uploadStarted),
    resultUrl: `${base}/examinations/${examinationId}` }, null, 2));
}
async function verifyReceipt() {
  const saved = await get(`/api/examinations/${examinationId}`);
  if (saved.status !== 'COMPLETED' || saved.examinationId !== examinationId || !saved.result ||
      saved.eye !== eye || saved.captureType !== captureType ||
      saved.image?.deviceId !== deviceId || saved.image?.capturedAt !== capturedAt ||
      saved.image?.sizeBytes !== bytes.length || saved.image?.originalSha256 !== sha256) {
    throw new Error('Stored examination does not match the uploaded image and metadata.');
  }
  const original = await fetch(`${base}/api/examinations/${examinationId}/images/original`,
    { headers: authorization, signal: AbortSignal.timeout(30000) });
  if (!original.ok || createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex') !== sha256) {
    throw new Error('Original image could not be retrieved intact from the receiver.');
  }
  return saved;
}
try {
  const contract = await get('/api/device-contract');
  if (bytes.length > contract.upload.maxBytes) throw new Error('Image exceeds backend upload limit.');
  requestTimeout = contract.upload.recommendedClientTimeoutMs;
  const system = await get('/api/system');
  if (!system.aiReady) throw new Error('AI service is not ready. No examination created.');
  console.log(`Receiver ${base}, contract ${contract.version}, AI mode ${system.aiMode}`);
  await status('IDLE'); await status('READY'); await status('CAPTURING');
  const exam = await request('/api/examinations', { patientId, eye, captureType });
  examinationId = exam.examinationId;
  await status('UPLOADING');
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), 'capture' + extname(imagePath));
  form.append('device_id', deviceId); form.append('eye', eye);
  form.append('capture_type', captureType);
  capturedAt = new Date().toISOString();
  form.append('capture_timestamp', capturedAt);
  heartbeat = setInterval(() => status('UPLOADING').catch(() => {}), 15000);
  uploadStarted = performance.now();
  await request(`/api/examinations/${examinationId}/images`, form, true);
  clearInterval(heartbeat);
  const completed = await verifyReceipt();
  await status('READY');
  printResult(completed);
  if (process.argv.includes('--watch')) {
    console.log('Heartbeat active every 15 seconds. Press Ctrl+C to stop. No further images are uploaded.');
    for (;;) { await delay(15000); await status('READY'); }
  }
} catch (error) {
  clearInterval(heartbeat);
  if (examinationId) {
    try {
      const saved = await get(`/api/examinations/${examinationId}`);
      console.error(`Upload response interrupted or failed. Stored examination status: ${saved.status}. No automatic re-upload.`);
      if (saved.status === 'COMPLETED' && uploadStarted !== undefined) {
        const verified = await verifyReceipt();
        await status('READY'); printResult(verified); process.exit(0);
      }
    } catch {}
  }
  try { await status('ERROR', error.message.slice(0, 240)); } catch {}
  console.error(error.message);
  if (examinationId) console.error(`Inspect before retry: ${base}/examinations/${examinationId}`);
  process.exitCode = 1;
}
