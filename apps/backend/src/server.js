import 'dotenv/config';
import { resolve } from 'node:path';
import { createApp } from './app.js';
const integer = (key, fallback) => {
  const value = Number(process.env[key] || fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${key}`);
  return value;
};
const { app, store } = createApp({
  databasePath: resolve(process.env.DATABASE_PATH || 'data/fundus.sqlite'),
  uploadDir: resolve(process.env.UPLOAD_DIR || 'data/uploads'),
  aiUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000',
  aiMode: process.env.AI_MODE || 'mock',
  aiTimeout: integer('AI_TIMEOUT_MS', 15000), maxUploadBytes: integer('MAX_UPLOAD_BYTES', 10485760)
});
const server = app.listen(integer('BACKEND_PORT', 3001), process.env.BACKEND_HOST || '127.0.0.1', () => console.log('Fundus backend listening', server.address()));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
