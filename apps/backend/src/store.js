import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MongoClient } from 'mongodb';

export function createSqliteStore(path) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS patients (patientId TEXT PRIMARY KEY, createdAt TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS examinations (
      examinationId TEXT PRIMARY KEY, patientId TEXT NOT NULL REFERENCES patients(patientId),
      document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS fundus_images (
      imageId TEXT PRIMARY KEY, examinationId TEXT NOT NULL REFERENCES examinations(examinationId),
      document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_results (
      examinationId TEXT PRIMARY KEY REFERENCES examinations(examinationId), document TEXT NOT NULL);`);
  if (!db.prepare('PRAGMA table_info(patients)').all().some(column => column.name === 'notes')) {
    db.exec('ALTER TABLE patients ADD COLUMN notes TEXT');
  }
  const transaction = fn => {
    db.exec('BEGIN');
    try { const value = fn(); db.exec('COMMIT'); return value; } catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const get = id => {
    const row = db.prepare('SELECT document FROM examinations WHERE examinationId=?').get(id);
    return row ? JSON.parse(row.document) : null;
  };
  function save(exam) {
    db.exec('BEGIN');
    try {
      db.prepare('INSERT OR IGNORE INTO patients (patientId, createdAt) VALUES (?,?)').run(exam.patientId, exam.createdAt);
      db.prepare('INSERT INTO examinations VALUES (?,?,?) ON CONFLICT(examinationId) DO UPDATE SET document=excluded.document')
        .run(exam.examinationId, exam.patientId, JSON.stringify(exam));
      if (exam.image) db.prepare('INSERT OR REPLACE INTO fundus_images VALUES (?,?,?)')
        .run(exam.image.imageId, exam.examinationId, JSON.stringify(exam.image));
      if (exam.result) db.prepare('INSERT OR REPLACE INTO ai_results VALUES (?,?)')
        .run(exam.examinationId, JSON.stringify(exam.result));
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  // A process interrupted during inference cannot complete its old request.
  for (const row of db.prepare('SELECT document FROM examinations').all()) {
    const exam = JSON.parse(row.document);
    if (['IMAGE_RECEIVED', 'PROCESSING'].includes(exam.status)) {
      exam.status = 'FAILED';
      exam.error = { code: 'PROCESS_INTERRUPTED', message: 'Backend restarted during processing.' };
      exam.statusHistory.push({ status: 'FAILED', timestamp: new Date().toISOString() });
      save(exam);
    }
  }
  const listExaminations = patientId => db.prepare(patientId
    ? 'SELECT document FROM examinations WHERE patientId=? ORDER BY json_extract(document,\'$.createdAt\') DESC'
    : 'SELECT document FROM examinations ORDER BY json_extract(document,\'$.createdAt\') DESC')
    .all(...(patientId ? [patientId] : [])).map(row => JSON.parse(row.document));
  const patientRow = row => row ? { patientId: row.patientId, createdAt: row.createdAt, notes: row.notes ?? '' } : null;
  const listPatients = () => db.prepare('SELECT patientId, createdAt, notes FROM patients ORDER BY createdAt DESC').all().map(patientRow);
  const getPatient = patientId => patientRow(db.prepare('SELECT patientId, createdAt, notes FROM patients WHERE patientId=?').get(patientId));
  const savePatient = patient => {
    db.prepare('INSERT OR IGNORE INTO patients (patientId, createdAt, notes) VALUES (?,?,?)').run(patient.patientId, patient.createdAt, patient.notes ?? '');
    return getPatient(patient.patientId);
  };
  // Renames cascade to every examination document of the patient.
  const updatePatient = (patientId, changes) => transaction(() => {
    const current = getPatient(patientId);
    if (!current) return null;
    const nextId = changes.patientId ?? patientId, notes = changes.notes ?? current.notes;
    if (nextId !== patientId) {
      db.prepare('INSERT INTO patients (patientId, createdAt, notes) VALUES (?,?,?)').run(nextId, current.createdAt, notes);
      db.prepare('UPDATE examinations SET patientId=?, document=json_set(document,\'$.patientId\',?) WHERE patientId=?').run(nextId, nextId, patientId);
      db.prepare('DELETE FROM patients WHERE patientId=?').run(patientId);
    } else {
      db.prepare('UPDATE patients SET notes=? WHERE patientId=?').run(notes, patientId);
    }
    return getPatient(nextId);
  });
  const removeExamination = id => {
    db.prepare('DELETE FROM ai_results WHERE examinationId=?').run(id);
    db.prepare('DELETE FROM fundus_images WHERE examinationId=?').run(id);
    db.prepare('DELETE FROM examinations WHERE examinationId=?').run(id);
  };
  const deleteExamination = id => transaction(() => {
    const exam = get(id);
    if (exam) removeExamination(id);
    return exam;
  });
  // Returns the deleted examinations so the caller can remove their image files.
  const deletePatient = patientId => transaction(() => {
    if (!getPatient(patientId)) return null;
    const exams = listExaminations(patientId);
    for (const exam of exams) removeExamination(exam.examinationId);
    db.prepare('DELETE FROM patients WHERE patientId=?').run(patientId);
    return exams;
  });
  return {
    get, save, listExaminations, listPatients, getPatient, savePatient, updatePatient,
    deletePatient, deleteExamination, close: () => db.close()
  };
}

export const createStore = createSqliteStore;

export async function createMongoStore(url, databaseName = 'ai_fundus', options = {}) {
  const client = new MongoClient(url, { appName: 'luxora', ...(!/serverSelectionTimeoutMS=/i.test(url) ? { serverSelectionTimeoutMS: 10000 } : {}) });
  try {
    await client.connect();
    await client.db('admin').command({ ping: 1 });
    const { initializeMongoStore } = await import('./mongo-store.js');
    return await initializeMongoStore(client, client.db(databaseName), options);
  } catch (error) {
    await client.close();
    throw error;
  }
}
