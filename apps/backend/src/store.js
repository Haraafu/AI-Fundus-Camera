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
  const get = id => {
    const row = db.prepare('SELECT document FROM examinations WHERE examinationId=?').get(id);
    return row ? JSON.parse(row.document) : null;
  };
  function save(exam) {
    db.exec('BEGIN');
    try {
      db.prepare('INSERT OR IGNORE INTO patients VALUES (?,?)').run(exam.patientId, exam.createdAt);
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
  const listPatients = () => db.prepare('SELECT patientId, createdAt FROM patients ORDER BY createdAt DESC').all();
  const savePatient = patient => {
    db.prepare('INSERT OR IGNORE INTO patients VALUES (?,?)').run(patient.patientId, patient.createdAt);
    return db.prepare('SELECT patientId, createdAt FROM patients WHERE patientId=?').get(patient.patientId);
  };
  return { get, save, listExaminations, listPatients, savePatient, close: () => db.close() };
}

export const createStore = createSqliteStore;

export async function createMongoStore(url, databaseName = 'ai_fundus') {
  const client = new MongoClient(url, { appName: 'ai-fundus-camera' });
  await client.connect();
  const database = client.db(databaseName);
  const patients = database.collection('patients');
  const examinations = database.collection('examinations');
  const fundusImages = database.collection('fundus_images');
  const aiResults = database.collection('ai_results');
  await client.db('admin').command({ ping: 1 });

  const get = async id => {
    const exam = await examinations.findOne({ _id: id });
    if (!exam) return null;
    const { _id, ...document } = exam;
    return document;
  };
  async function save(exam) {
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        await patients.updateOne(
          { _id: exam.patientId },
          { $setOnInsert: { createdAt: exam.createdAt } },
          { upsert: true, session }
        );
        await examinations.replaceOne(
          { _id: exam.examinationId },
          { _id: exam.examinationId, ...structuredClone(exam) },
          { upsert: true, session }
        );
        if (exam.image) {
          await fundusImages.replaceOne(
            { _id: exam.image.imageId },
            { _id: exam.image.imageId, examinationId: exam.examinationId, ...structuredClone(exam.image) },
            { upsert: true, session }
          );
        }
        if (exam.result) {
          await aiResults.replaceOne(
            { _id: exam.examinationId },
            { _id: exam.examinationId, ...structuredClone(exam.result) },
            { upsert: true, session }
          );
        } else {
          await aiResults.deleteOne({ _id: exam.examinationId }, { session });
        }
      });
    } finally {
      await session.endSession();
    }
  }

  const interrupted = await examinations.find({ status: { $in: ['IMAGE_RECEIVED', 'PROCESSING'] } }).toArray();
  for (const stored of interrupted) {
    const { _id, ...exam } = stored;
    exam.status = 'FAILED';
    exam.error = { code: 'PROCESS_INTERRUPTED', message: 'Backend restarted during processing.' };
    exam.statusHistory.push({ status: 'FAILED', timestamp: new Date().toISOString() });
    await save(exam);
  }
  const listExaminations = async patientId => (await examinations.find(patientId ? { patientId } : {})
    .sort({ createdAt: -1 }).toArray()).map(({ _id, ...document }) => document);
  const listPatients = async () => (await patients.find().sort({ createdAt: -1 }).toArray())
    .map(({ _id, createdAt }) => ({ patientId: _id, createdAt }));
  const savePatient = async patient => {
    await patients.updateOne({ _id: patient.patientId }, { $setOnInsert: { createdAt: patient.createdAt } }, { upsert: true });
    const saved = await patients.findOne({ _id: patient.patientId });
    return { patientId: saved._id, createdAt: saved.createdAt };
  };
  return { type: 'mongodb', get, save, listExaminations, listPatients, savePatient, close: () => client.close() };
}
