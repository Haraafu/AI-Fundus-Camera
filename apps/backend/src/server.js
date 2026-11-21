import 'dotenv/config';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { createMongoStore } from './store.js';
const integer = (key, fallback) => {
  const value = Number(process.env[key] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${key}`);
  return value;
};
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('LUXORA login requires MongoDB. Configure DATABASE_URL in .env; SQLite is available only to isolated integration tests.');
  process.exit(1);
}
let configuredStore;
if (databaseUrl) {
  try {
    configuredStore = await createMongoStore(databaseUrl, process.env.DATABASE_NAME || 'ai_fundus');
  } catch {
    console.error([
      'MongoDB startup failed. The backend has not started; storage was not switched to SQLite.',
      'For queryTxt/querySrv timeouts, check DNS resolution of the Atlas TXT and SRV records.',
      'For TLS/server-selection failures, check Atlas Network Access for your current public IP,',
      'cluster availability, and firewall/VPN access to the cluster on TCP 27017.',
      'Also verify DATABASE_URL and database credentials. Do not disable TLS certificate validation.',
      'LUXORA accounts require MongoDB; configure DATABASE_URL before starting the backend.'
    ].join('\n'));
    process.exit(1);
  }
}
const { app, store } = createApp({
  store: configuredStore,
  databasePath: resolve(process.env.DATABASE_PATH || 'data/fundus.sqlite'),
  uploadDir: resolve(process.env.UPLOAD_DIR || 'data/uploads'),
  aiUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
  aiMode: process.env.AI_MODE || 'mock',
  aiTimeout: integer('AI_TIMEOUT_MS', 90000), maxUploadBytes: integer('MAX_UPLOAD_BYTES', 10485760),
  onDeviceEvent: event => console.log(JSON.stringify(event))
});
const server = app.listen(integer('BACKEND_PORT', 3001), process.env.BACKEND_HOST || '127.0.0.1', error => {
  if (error) {
    console.error(`LUXORA could not bind the backend port (${error.code || 'LISTEN_FAILED'}). Stop the existing backend or choose another BACKEND_PORT.`);
    void store.close().finally(() => process.exit(1));
    return;
  }
  console.log('LUXORA backend listening', server.address(), `storage=${store.type}`);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => {
  await store.close();
  process.exit(0);
}));
