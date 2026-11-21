import { randomUUID } from 'node:crypto';

// Every clinical query is bound to an authenticated owner. Patient codes can
// repeat across accounts; ownerless legacy records are deliberately excluded.
export async function initializeMongoStore(client, database, options = {}) {
  const collection = name => database.collection(`${options.collectionPrefix || ''}${name}`);
  const patients = collection('patients');
  const examinations = collection('examinations');
  const images = collection('fundus_images');
  const results = collection('ai_results');
  const users = collection('users');
  const sessions = collection('sessions');
  const attempts = collection('auth_attempts');
  await Promise.all([
    users.createIndex({ email: 1 }, { unique: true }),
    sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    sessions.createIndex({ userId: 1 }),
    attempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    patients.createIndex({ ownerId: 1, patientId: 1 }, {
      unique: true, partialFilterExpression: { ownerId: { $type: 'string' } }
    }),
    examinations.createIndex({ ownerId: 1, patientId: 1, createdAt: -1 })
  ]);
  const transaction = async operation => {
    const session = client.startSession();
    try {
      let result;
      await session.withTransaction(async () => { result = await operation(session); });
      return result;
    } finally { await session.endSession(); }
  };
  const document = value => {
    if (!value) return null;
    const { _id, ownerId, ...publicData } = value;
    return publicData;
  };
  function forUser(ownerId) {
    if (typeof ownerId !== 'string' || !ownerId) throw new Error('An authenticated owner is required');
    const patientKey = patientId => `${ownerId}:${patientId}`;
    const patient = value => value ? { patientId: value.patientId, createdAt: value.createdAt, notes: value.notes ?? '' } : null;
    const get = async id => document(await examinations.findOne({ _id: id, ownerId }));
    const getPatient = async patientId => patient(await patients.findOne({ _id: patientKey(patientId), ownerId }));
    const listExaminations = async patientId => (await examinations.find({ ownerId, ...(patientId ? { patientId } : {}) })
      .sort({ createdAt: -1 }).toArray()).map(document);
    const listPatients = async () => (await patients.find({ ownerId }).sort({ createdAt: -1 }).toArray()).map(patient);
    const savePatient = async value => {
      await patients.updateOne({ _id: patientKey(value.patientId), ownerId }, {
        $setOnInsert: { ownerId, patientId: value.patientId, createdAt: value.createdAt, notes: value.notes ?? '' }
      }, { upsert: true });
      return getPatient(value.patientId);
    };
    const save = exam => transaction(async session => {
      await patients.updateOne({ _id: patientKey(exam.patientId), ownerId }, {
        $setOnInsert: { ownerId, patientId: exam.patientId, createdAt: exam.createdAt, notes: '' }
      }, { upsert: true, session });
      // The owner is supplied by the session, never by a request body.
      const record = { ...structuredClone(exam), _id: exam.examinationId, ownerId };
      await examinations.replaceOne({ _id: exam.examinationId, ownerId }, record, { upsert: true, session });
      if (exam.image) await images.replaceOne({ _id: exam.image.imageId, ownerId }, {
        ...structuredClone(exam.image), _id: exam.image.imageId, ownerId, examinationId: exam.examinationId
      }, { upsert: true, session });
      if (exam.result) await results.replaceOne({ _id: exam.examinationId, ownerId }, {
        ...structuredClone(exam.result), _id: exam.examinationId, ownerId
      }, { upsert: true, session });
      else await results.deleteOne({ _id: exam.examinationId, ownerId }, { session });
    });
    const updatePatient = (patientId, changes) => transaction(async session => {
      const current = await patients.findOne({ _id: patientKey(patientId), ownerId }, { session });
      if (!current) return null;
      const nextId = changes.patientId ?? patientId, notes = changes.notes ?? current.notes ?? '';
      if (nextId !== patientId) {
        await patients.insertOne({ _id: patientKey(nextId), ownerId, patientId: nextId, createdAt: current.createdAt, notes }, { session });
        await examinations.updateMany({ ownerId, patientId }, { $set: { patientId: nextId } }, { session });
        await patients.deleteOne({ _id: patientKey(patientId), ownerId }, { session });
      } else await patients.updateOne({ _id: patientKey(patientId), ownerId }, { $set: { notes } }, { session });
      return patient(await patients.findOne({ _id: patientKey(nextId), ownerId }, { session }));
    });
    const removeExam = async (id, session) => {
      await results.deleteOne({ _id: id, ownerId }, { session });
      await images.deleteMany({ examinationId: id, ownerId }, { session });
      await examinations.deleteOne({ _id: id, ownerId }, { session });
    };
    const deleteExamination = id => transaction(async session => {
      const exam = await examinations.findOne({ _id: id, ownerId }, { session });
      if (!exam) return null;
      await removeExam(id, session);
      return document(exam);
    });
    const deletePatient = patientId => transaction(async session => {
      if (!await patients.findOne({ _id: patientKey(patientId), ownerId }, { session })) return null;
      const exams = (await examinations.find({ ownerId, patientId }, { session }).toArray()).map(document);
      for (const exam of exams) await removeExam(exam.examinationId, session);
      await patients.deleteOne({ _id: patientKey(patientId), ownerId }, { session });
      return exams;
    });
    return { type: 'mongodb', get, save, getPatient, savePatient, listPatients, listExaminations, updatePatient, deletePatient, deleteExamination };
  }
  const auth = {
    createUser: async user => { await users.insertOne({ ...user, _id: randomUUID() }); return users.findOne({ email: user.email }); },
    findUserByEmail: email => users.findOne({ email }),
    findUserById: id => users.findOne({ _id: id }),
    saveSession: session => sessions.insertOne(session),
    findSession: id => sessions.findOne({ _id: id, expiresAt: { $gt: new Date() } }),
    deleteSession: id => sessions.deleteOne({ _id: id }),
    countAttempt: async key => {
      const bucket = Math.floor(Date.now() / 900000);
      const item = await attempts.findOneAndUpdate({ _id: `${bucket}:${key}` }, {
        $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((bucket + 1) * 900000) }
      }, { upsert: true, returnDocument: 'after' });
      return item.count;
    }
  };
  // Recover only tenant-owned requests interrupted by an earlier process.
  for (const stored of await examinations.find({ ownerId: { $type: 'string' }, status: { $in: ['IMAGE_RECEIVED', 'PROCESSING'] } }).toArray()) {
    const exam = document(stored);
    exam.status = 'FAILED';
    exam.error = { code: 'PROCESS_INTERRUPTED', message: 'Backend restarted during processing.' };
    exam.statusHistory.push({ status: 'FAILED', timestamp: new Date().toISOString() });
    await forUser(stored.ownerId).save(exam);
  }
  return { type: 'mongodb', auth, forUser, close: () => client.close() };
}
