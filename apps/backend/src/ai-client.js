import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { scoreRisk } from './risk.js';

export const CLASSES = ['No_DR', 'Mild', 'Moderate', 'Severe', 'Proliferative_DR'];
const PREPROCESSING_VERSION = 'fundus-prep-v1';
export class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
function inputValidation(value, buffer) {
  if (value?.version !== 'fundus-input-v1' || value.status !== 'ACCEPTED' || value.imageType !== 'retinal_fundus' ||
      value.method !== 'local_clip_zero_shot' || value.sourceSha256 !== createHash('sha256').update(buffer).digest('hex') ||
      !Number.isFinite(value.matchingScore) || value.matchingScore < 0.65 || value.matchingScore > 1 ||
      !Number.isFinite(value.similarity) || value.similarity < 0.22 || !Number.isFinite(value.margin) || value.margin < 0.012) {
    throw new ApiError(503, 'IMAGE_VALIDATOR_UNAVAILABLE', 'The image type could not be verified. Try again when the validator is ready.');
  }
  return { version: value.version, status: value.status, decision: 'Eye', imageType: value.imageType, method: value.method,
    sourceSha256: value.sourceSha256, matchingScore: value.matchingScore, similarity: value.similarity, margin: value.margin };
}
function imageRejection(response, result) {
  const code = result?.error?.code;
  if (response.status === 400 && code === 'INVALID_IMAGE') throw new ApiError(400, code, 'Upload a valid single JPEG or PNG image.');
  if (response.status === 413 && code === 'UPLOAD_TOO_LARGE') throw new ApiError(413, code, 'Image exceeds the upload limit.');
  if (response.status === 422 && ['NON_FUNDUS_IMAGE', 'FUNDUS_IMAGE_UNCERTAIN'].includes(code)) {
    throw new ApiError(422, code, result.error.message || 'Upload a clear retinal fundus photograph.');
  }
  if (code === 'IMAGE_VALIDATOR_UNAVAILABLE') throw new ApiError(503, code, 'The image validator is unavailable. Try again later.');
}
export async function validateFundus(config, buffer, mime) {
  const body = new FormData();
  body.append('image', new Blob([buffer], { type: mime }), mime === 'image/png' ? 'image.png' : 'image.jpg');
  let response, result;
  try {
    response = await fetch(`${config.aiUrl}/validate-image`, { method: 'POST', body,
      signal: AbortSignal.timeout(Math.min(config.aiTimeout || 15000, 15000)) });
    result = await response.json();
  } catch {
    throw new ApiError(503, 'IMAGE_VALIDATOR_UNAVAILABLE', 'The image validator is unavailable. Try again later.');
  }
  imageRejection(response, result);
  if (!response.ok || result?.success !== true) {
    throw new ApiError(503, 'IMAGE_VALIDATOR_UNAVAILABLE', 'The image type could not be verified. Try again later.');
  }
  return inputValidation(result.inputValidation, buffer);
}
async function explanationOutput(value, targetClass) {
  if (!value) return { metadata: { status: 'UNAVAILABLE', reason: 'NOT_PROVIDED' } };
  const invalid = () => new ApiError(502, 'INVALID_AI_RESPONSE', 'AI explanation does not match the contract.');
  if (!['AVAILABLE', 'UNAVAILABLE'].includes(value.status) || value.method !== 'Grad-CAM' || !['gradcam-v1', 'gradcam-v2'].includes(value.version)) throw invalid();
  if (value.scoreType !== undefined && !['logit', 'model_output'].includes(value.scoreType)) throw invalid();
  const scoreMetadata = value.scoreType ? { scoreType: value.scoreType } : {};
  if (value.status === 'UNAVAILABLE') return { metadata: { status: value.status, method: value.method, version: value.version, reason: value.reason || 'EXPLANATION_FAILED', ...scoreMetadata } };
  if (value.targetClass !== targetClass || value.coordinateSpace !== 'processed' || value.mimeType !== 'image/png' ||
      typeof value.layer !== 'string' || JSON.stringify(value.outputResolution) !== '[300,300]') throw invalid();
  const images = {};
  for (const [key, field] of [['overlay', 'imageBase64'], ['heatmap', 'heatmapBase64']]) {
    const encoded = value[field];
    if (typeof encoded !== 'string' || !encoded.length || encoded.length > 500000) throw invalid();
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) throw invalid();
    try {
      const image = sharp(bytes, { limitInputPixels: 90000, failOn: 'warning' });
      const m = await image.metadata();
      if (m.format !== 'png' || m.width !== 300 || m.height !== 300 || (m.pages ?? 1) !== 1) throw invalid();
      await image.stats();
    } catch { throw invalid(); }
    images[key] = bytes;
  }
  return { metadata: { status: value.status, method: value.method, version: value.version, targetClass,
    coordinateSpace: value.coordinateSpace, layer: value.layer, outputResolution: value.outputResolution, ...scoreMetadata }, ...images };
}
export async function predict(config, buffer, mime) {
  const body = new FormData();
  body.append('image', new Blob([buffer], { type: mime }), mime === 'image/png' ? 'fundus.png' : 'fundus.jpg');
  let response, result;
  try {
    response = await fetch(`${config.aiUrl}/predict`, { method: 'POST', body, signal: AbortSignal.timeout(config.aiTimeout) });
    result = await response.json();
  } catch (error) {
    throw new ApiError(502, error.name === 'TimeoutError' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE', 'AI service could not complete the request.');
  }
  if (!response.ok) {
    imageRejection(response, result);
    const code = ['MODEL_NOT_READY', 'MODEL_LOAD_FAILED'].includes(result?.error?.code) ? result.error.code : 'INFERENCE_FAILED';
    throw new ApiError(502, code, 'AI service rejected the request.');
  }
  const p = result?.probabilities;
  const verifiedInput = result?.inputValidation ? inputValidation(result.inputValidation, buffer) : null;
  if (!verifiedInput && !config.allowUnauthenticatedTests) throw new ApiError(503, 'IMAGE_VALIDATOR_UNAVAILABLE', 'The AI service did not verify the image type.');
  const binary = !!p && Object.hasOwn(p, 'DR');
  const classes = binary ? ['No_DR', 'DR'] : CLASSES;
  const predicted = result?.prediction?.class;
  if (result?.success !== true || !classes.includes(predicted) || !p || Object.keys(p).length !== classes.length ||
      !classes.every(c => Number.isFinite(p[c]) && p[c] >= 0 && p[c] <= 1) ||
      Math.abs(classes.reduce((sum, c) => sum + p[c], 0) - 1) > 0.0001 ||
      result.prediction.confidence !== p[predicted] || p[predicted] !== Math.max(...Object.values(p)) ||
      (binary ? result.riskLevel !== 'NOT_ASSESSED' || result.isMock : !['LOW', 'MEDIUM', 'HIGH'].includes(result.riskLevel)) ||
      typeof result.modelVersion !== 'string' || !result.modelVersion || typeof result.isMock !== 'boolean' ||
      result.isMock !== ((config.aiMode ?? 'mock') === 'mock') ||
      (result.isMock ? result.modelVersion !== 'mock-v0' : result.modelVersion.startsWith('mock')) ||
      result.preprocessingVersion !== PREPROCESSING_VERSION) {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'AI response does not match the contract.');
  }
  const prep = result.preprocessing;
  let processedBytes;
  try {
    if (prep?.version !== PREPROCESSING_VERSION || prep.mimeType !== 'image/png' ||
        JSON.stringify(prep.outputResolution) !== '[300,300]' || !prep.parameters || typeof prep.parameters !== 'object' ||
        typeof prep.imageBase64 !== 'string' || !prep.imageBase64.length || prep.imageBase64.length > 500000 ||
        prep.imageBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(prep.imageBase64)) throw new Error('Invalid preprocessing metadata');
    processedBytes = Buffer.from(prep.imageBase64, 'base64');
    if (processedBytes.toString('base64') !== prep.imageBase64) throw new Error('Noncanonical base64');
    const image = sharp(processedBytes, { limitInputPixels: 90000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (metadata.format !== 'png' || metadata.width !== 300 || metadata.height !== 300 || (metadata.pages ?? 1) !== 1) throw new Error('Invalid processed image');
    await image.stats();
  } catch {
    throw new ApiError(502, 'INVALID_AI_RESPONSE', 'AI preprocessing output does not match the contract.');
  }
  if (result.isMock && result.explanation?.status === 'AVAILABLE') throw new ApiError(502, 'INVALID_AI_RESPONSE', 'Mock predictions cannot carry real Grad-CAM.');
  const explanation = await explanationOutput(result.explanation, result.prediction.class);
  return { explanation, result: { predictedClass: result.prediction.class, confidence: result.prediction.confidence,
      probabilities: p, ...scoreRisk(result.prediction.class, binary), modelVersion: result.modelVersion, isMock: result.isMock,
      preprocessingVersion: result.preprocessingVersion, explanation: explanation.metadata },
    inputValidation: verifiedInput,
    processedBytes, preprocessing: { version: prep.version, parameters: prep.parameters, outputResolution: prep.outputResolution } };
}
