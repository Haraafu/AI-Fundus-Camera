import 'dotenv/config';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Explicit offline demo uses its own SQLite database; Atlas configuration stays intact.
const env = { ...process.env, AI_MODE: 'model', DATABASE_URL: '',
  DATABASE_PATH: resolve('data/demo/fundus.sqlite'), UPLOAD_DIR: resolve('data/demo/uploads'),
  AI_TIMEOUT_MS: '60000', BACKEND_HOST: '127.0.0.1', AI_SERVICE_HOST: '127.0.0.1' };
const aiPort = env.AI_SERVICE_PORT || '8000', backendPort = env.BACKEND_PORT || '3001';
env.AI_SERVICE_URL = `http://127.0.0.1:${aiPort}`;
for (const port of [aiPort, backendPort]) {
  try {
    await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
    console.error(`Port ${port} is already occupied. Stop the existing service before npm run demo.`);
    process.exit(1);
  } catch {}
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
function start(command, args) {
  const child = spawn(command, args, { env, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
  return child;
}
start(env.PYTHON || 'python', ['services/ai-service/app.py']);
let ready = false;
for (let i = 0; i < 120 && !stopping; i++) {
  try {
    const response = await fetch(`${env.AI_SERVICE_URL}/ready`, { signal: AbortSignal.timeout(1000) });
    if (response.ok && (await response.json()).modelLoaded) { ready = true; break; }
  } catch {}
  await delay(1000);
}
if (!ready) { console.error('Model did not become ready. Check Python dependencies and MODEL_PATH.'); stop(1); }
else {
  start(process.execPath, ['apps/backend/src/server.js']);
  console.log(`Offline demo (SQLite, real model): http://127.0.0.1:${backendPort}/dashboard`);
}
