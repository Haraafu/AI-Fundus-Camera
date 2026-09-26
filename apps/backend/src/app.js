import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createStore } from './store.js';
import { ApiError, predict } from './ai-client.js';

export function createApp(config) {
  if (!['mock', 'model'].includes(config.aiMode ?? 'mock')) throw new Error('AI_MODE must be mock or model');
  const app = express(), store = createStore(config.databasePath), busy = new Set();
  mkdirSync(config.uploadDir, { recursive: true });
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.get('/health', (req, res) => res.json({ status: 'healthy', service: 'backend' }));
  app.post('/api/examinations', (req, res) => {
    const { patientId, eye, captureType } = req.body ?? {};
    if (typeof patientId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(patientId) ||
        !['LEFT', 'RIGHT'].includes(eye) || !['MACULA_CENTERED', 'OPTIC_DISC_CENTERED'].includes(captureType)) {
      throw new ApiError(400, 'INVALID_METADATA', 'Provide patientId (anonymous code), eye and captureType.');
    }
    const createdAt = new Date().toISOString();
    const exam = { examinationId: randomUUID(), patientId, eye, captureType, status: 'CREATED', createdAt,
      completedAt: null, image: null, result: null, error: null, statusHistory: [{ status: 'CREATED', timestamp: createdAt }] };
    store.save(exam);
    res.status(201).json(exam);
  });
  function find(req, res, next) {
    req.exam = store.get(req.params.id);
    if (!req.exam) throw new ApiError(404, 'EXAMINATION_NOT_FOUND', 'Examination not found.');
    next();
  }
  app.get('/api/examinations/:id', find, (req, res) => res.json(req.exam));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1, fields: 4 },
    fileFilter: (req, file, cb) => cb(['image/png', 'image/jpeg'].includes(file.mimetype) ? null :
      new ApiError(400, 'INVALID_IMAGE', 'Only PNG and JPEG are supported.'), true) }).single('image');
  app.post('/api/examinations/:id/images', find, (req, res, next) => {
    if (req.exam.status !== 'CREATED' || busy.has(req.params.id)) return next(new ApiError(409, 'EXAMINATION_LOCKED', 'Create a new examination for another upload.'));
    const examinationId = req.params.id;
    busy.add(examinationId);
    res.on('finish', () => busy.delete(examinationId));
    res.on('close', () => busy.delete(examinationId));
    upload(req, res, next);
  }, async (req, res) => {
    const exam = req.exam;
    if (!req.file) throw new ApiError(400, 'INVALID_IMAGE', 'Multipart field image is required.');
    const { eye, capture_type: captureType, device_id: deviceId, capture_timestamp: capturedAt } = req.body;
    if ((eye && eye !== exam.eye) || (captureType && captureType !== exam.captureType) ||
        (deviceId && !/^[A-Za-z0-9_-]{1,64}$/.test(deviceId)) || (capturedAt && !Number.isFinite(Date.parse(capturedAt)))) {
      throw new ApiError(400, 'INVALID_METADATA', 'Image metadata is invalid or differs from examination.');
    }
    let metadata;
    try {
      const image = sharp(req.file.buffer, { limitInputPixels: 40000000, failOn: 'warning' });
      metadata = await image.metadata();
      if (!['png', 'jpeg'].includes(metadata.format) || (metadata.pages ?? 1) !== 1 ||
          req.file.mimetype !== `image/${metadata.format}`) throw new Error('Invalid format');
      await image.stats();
    } catch { throw new ApiError(400, 'INVALID_IMAGE', 'Image cannot be decoded as a single PNG/JPEG image.'); }
    function transition(status) {
      exam.status = status;
      exam.statusHistory.push({ status, timestamp: new Date().toISOString() });
      store.save(exam);
    }
    try {
      const imageId = randomUUID(), filename = `${imageId}.${metadata.format === 'png' ? 'png' : 'jpg'}`;
      writeFileSync(join(config.uploadDir, filename), req.file.buffer, { flag: 'wx' });
      exam.image = { imageId, originalPath: filename, mimeType: req.file.mimetype, sizeBytes: req.file.size,
        originalResolution: [metadata.width, metadata.height], deviceId: deviceId || null, capturedAt: capturedAt || null,
        eye: exam.eye, captureType: exam.captureType, processedPath: null, preprocessingVersion: null };
      transition('IMAGE_RECEIVED');
      transition('PROCESSING');
      const prediction = await predict(config, req.file.buffer, req.file.mimetype);
      const processedFilename = `${imageId}-processed.png`;
      writeFileSync(join(config.uploadDir, processedFilename), prediction.processedBytes, { flag: 'wx' });
      exam.image.processedPath = processedFilename;
      exam.image.preprocessingVersion = prediction.preprocessing.version;
      exam.image.preprocessingParameters = prediction.preprocessing.parameters;
      exam.image.processedResolution = prediction.preprocessing.outputResolution;
      exam.result = prediction.result;
      exam.completedAt = new Date().toISOString();
      transition('COMPLETED');
      res.json(exam);
    } catch (error) {
      exam.result = null;
      exam.completedAt = null;
      exam.error = { code: error.code && error instanceof ApiError ? error.code : 'PROCESSING_FAILED',
        message: error instanceof ApiError ? error.message : 'Processing failed.' };
      transition('FAILED');
      throw error;
    }
  });
  app.use((req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  app.use((error, req, res, next) => {
    const tooLarge = error.code === 'LIMIT_FILE_SIZE';
    const status = tooLarge ? 413 : error instanceof multer.MulterError || error.type === 'entity.parse.failed' ? 400 : error.status || 500;
    res.status(status).json({ success: false, error: { code: tooLarge ? 'UPLOAD_TOO_LARGE' : error instanceof ApiError ? error.code : status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
      message: error instanceof ApiError ? error.message : tooLarge ? 'Image exceeds upload limit.' : 'Request could not be processed.' } });
  });
  return { app, store };
}
