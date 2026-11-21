// Revalidate stored, pre-gate examinations. Rejected predictions are archived,
// never silently retained as DR/No DR. Originals are preserved for the owner.
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { validateFundus } from '../apps/backend/src/ai-client.js';

const apply = process.argv.includes('--apply');
const client = new MongoClient(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 10000 });
try {
  await client.connect();
  const db = client.db(process.env.DATABASE_NAME || 'ai_fundus');
  const examinations = db.collection('examinations');
  const rows = await examinations.find({ ownerId: { $type: 'string' }, status: 'COMPLETED', 'image.inputValidation.version': { $ne: 'fundus-input-v1' } }).toArray();
  let accepted = 0, rejected = 0;
  for (const exam of rows) {
    const filename = exam.image?.originalPath;
    if (!filename || filename !== basename(filename)) throw new Error('Unsafe original image reference; audit stopped');
    const original = await readFile(resolve(process.env.UPLOAD_DIR || 'data/uploads', filename));
    if (exam.image.originalSha256 && createHash('sha256').update(original).digest('hex') !== exam.image.originalSha256) {
      throw new Error('A saved original no longer matches its examination; audit stopped');
    }
    let validation, error;
    try { validation = await validateFundus({ aiUrl: process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000', aiTimeout: 15000 }, original, exam.image.mimeType); }
    catch (failure) {
      if (!['NON_FUNDUS_IMAGE', 'FUNDUS_IMAGE_UNCERTAIN'].includes(failure.code)) throw failure;
      error = { code: failure.code, message: failure.message };
    }
    if (validation) {
      accepted++;
      if (apply) await examinations.updateOne({ _id: exam._id, ownerId: exam.ownerId, status: 'COMPLETED' }, { $set: { 'image.inputValidation': validation } });
    } else {
      rejected++;
      if (apply) {
        const session = client.startSession();
        try {
          await session.withTransaction(async () => {
            await db.collection('input_validation_audit').updateOne({ _id: `${exam._id}:fundus-input-v1` }, { $setOnInsert: {
              ownerId: exam.ownerId, examinationId: exam.examinationId, previousStatus: exam.status,
              previousResult: exam.result, previousImage: exam.image, previousCompletedAt: exam.completedAt,
              rejectedAt: new Date(), error
            } }, { upsert: true, session });
            await examinations.updateOne({ _id: exam._id, ownerId: exam.ownerId, status: 'COMPLETED' }, {
              $set: { status: 'REJECTED', result: null, completedAt: null, error,
                'image.inputValidation': { version: 'fundus-input-v1', status: 'REJECTED', errorCode: error.code },
                'image.processedPath': null, 'image.gradcamPath': null, 'image.heatmapPath': null },
              $push: { statusHistory: { status: 'REJECTED', timestamp: new Date().toISOString() } }
            }, { session });
            await db.collection('ai_results').deleteOne({ _id: exam.examinationId, ownerId: exam.ownerId }, { session });
          });
        } finally { await session.endSession(); }
      }
    }
  }
  console.log(JSON.stringify({ applied: apply, examined: rows.length, accepted, rejected, originalsPreserved: true }));
} finally { await client.close(); }
