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
  const patientDoc = doc => doc ? { patientId: doc._id, createdAt: doc.createdAt, notes: doc.notes ?? '' } : null;
  const listPatients = async () => (await patients.find().sort({ createdAt: -1 }).toArray()).map(patientDoc);
  const getPatient = async patientId => patientDoc(await patients.findOne({ _id: patientId }));
  const savePatient = async patient => {
    await patients.updateOne({ _id: patient.patientId }, { $setOnInsert: { createdAt: patient.createdAt, notes: patient.notes ?? '' } }, { upsert: true });
    return getPatient(patient.patientId);
  };
  const inTransaction = async fn => {
    const session = client.startSession();
    try { let value; await session.withTransaction(async () => { value = await fn(session); }); return value; }
    finally { await session.endSession(); }
  };
  const updatePatient = (patientId, changes) => inTransaction(async session => {
    const current = await patients.findOne({ _id: patientId }, { session });
    if (!current) return null;
    const nextId = changes.patientId ?? patientId, notes = changes.notes ?? current.notes ?? '';
    if (nextId !== patientId) {
      await patients.insertOne({ _id: nextId, createdAt: current.createdAt, notes }, { session });
      await examinations.updateMany({ patientId }, { $set: { patientId: nextId } }, { session });
      await patients.deleteOne({ _id: patientId }, { session });
    } else {
      await patients.updateOne({ _id: patientId }, { $set: { notes } }, { session });
    }
    return patientDoc(await patients.findOne({ _id: nextId }, { session }));
  });
  const removeExamination = async (id, session) => {
    await aiResults.deleteOne({ _id: id }, { session });
    await fundusImages.deleteMany({ examinationId: id }, { session });
    await examinations.deleteOne({ _id: id }, { session });
  };
  const deleteExamination = id => inTransaction(async session => {
    const exam = await examinations.findOne({ _id: id }, { session });
    if (!exam) return null;
    await removeExamination(id, session);
    const { _id, ...document } = exam;
    return document;
  });
  const deletePatient = patientId => inTransaction(async session => {
    if (!await patients.findOne({ _id: patientId }, { session })) return null;
    const exams = (await examinations.find({ patientId }, { session }).toArray()).map(({ _id, ...document }) => document);
    for (const exam of exams) await removeExamination(exam.examinationId, session);
    await patients.deleteOne({ _id: patientId }, { session });
    return exams;
  });
  return {
    type: 'mongodb', get, save, listExaminations, listPatients, getPatient, savePatient, updatePatient,
    deletePatient, deleteExamination, close: () => client.close()
  };
}
