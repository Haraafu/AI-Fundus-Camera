import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('MongoDB startup failure is actionable, credential-safe, and does not fall back to SQLite', () => {
  const result = spawnSync(process.execPath, ['apps/backend/src/server.js'], {
    env: {
      ...process.env,
      DATABASE_URL: 'mongodb://startup-user:startup-secret@127.0.0.1:1/ai_fundus?serverSelectionTimeoutMS=100&connectTimeoutMS=100'
    },
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /MongoDB startup failed/);
  assert.match(result.stderr, /Atlas Network Access/);
  assert.match(result.stderr, /TXT and SRV/);
  assert.match(result.stderr, /storage was not switched to SQLite/);
  assert.doesNotMatch(result.stderr, /startup-secret|startup-user|MongoServerSelectionError/);
  assert.doesNotMatch(result.stdout, /Fundus backend listening/);
});