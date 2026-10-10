import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Upload is never retried blindly: inspect the examination after a timeout.
const args = process.argv.slice(2).filter(value => value !== '--watch');
const imagePath = args[0];
if (!imagePath) { console.error('Usage: npm run device:mock -- image.png [patientId] [deviceId] [--watch]'); process.exit(1); }
const base = process.env.BACKEND_URL || `http://127.0.0.1:${process.env.BACKEND_PORT || 3001}`;
const patientId = args[1] || 'DEMO-DEVICE', deviceId = args[2] || 'ESP32-SIM-01';
const mime = ['.jpg', '.jpeg'].includes(extname(imagePath).toLowerCase()) ? 'image/jpeg' : 'image/png';
const bytes = readFileSync(resolve(imagePath));
let examinationId;
async function request(path, body, multipart = false) {
  const response = await fetch(base + path, { method: 'POST', headers: multipart ? {} : { 'Content-Type': 'application/json' },
    body: multipart ? body : JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`${data.error?.code || response.status}: ${data.error?.message || 'Request failed'}`);
  return data;
}
async function status(value, message) {
  const result = await request(`/api/devices/${encodeURIComponent(deviceId)}/status`, { status: value, examinationId, message });
  console.log(`${result.lastSeen} ${deviceId}: ${value}`);
}
try {
  await status('IDLE'); await status('READY'); await status('CAPTURING');
  const exam = await request('/api/examinations', { patientId, eye: 'RIGHT', captureType: 'MACULA_CENTERED' });
  examinationId = exam.examinationId;
  await status('UPLOADING');
  const form = new FormData();
  form.append('image', new Blob([bytes], { type: mime }), 'capture' + extname(imagePath));
  form.append('device_id', deviceId); form.append('eye', 'RIGHT');
  form.append('capture_type', 'MACULA_CENTERED');
  form.append('capture_timestamp', new Date().toISOString());
  const completed = await request(`/api/examinations/${examinationId}/images`, form, true);
  await status('READY');
  console.log(JSON.stringify({ status: completed.status, prediction: completed.result?.predictedClass,
    isMock: completed.result?.isMock, explanation: completed.result?.explanation?.status,
    resultUrl: `${base}/examinations/${examinationId}` }, null, 2));
  if (process.argv.includes('--watch')) {
    console.log('Heartbeat active every 15 seconds. Press Ctrl+C to stop. No further images are uploaded.');
    for (;;) { await delay(15000); await status('READY'); }
  }
} catch (error) {
  try { await status('ERROR', error.message.slice(0, 240)); } catch {}
  console.error(error.message);
  if (examinationId) console.error(`Inspect before retry: ${base}/examinations/${examinationId}`);
  process.exitCode = 1;
}
