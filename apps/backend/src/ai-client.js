import sharp from 'sharp';

export const CLASSES = ['No_DR', 'Mild', 'Moderate', 'Severe', 'Proliferative_DR'];
const PREPROCESSING_VERSION = 'fundus-prep-v1';
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
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
    const code = ['MODEL_NOT_READY', 'MODEL_LOAD_FAILED'].includes(result?.error?.code) ? result.error.code : 'INFERENCE_FAILED';
    throw new ApiError(502, code, 'AI service rejected the request.');
  }
  const p = result?.probabilities;
  const index = CLASSES.indexOf(result?.prediction?.class);
  if (result?.success !== true || index < 0 || !p || Object.keys(p).length !== 5 ||
      !CLASSES.every(c => Number.isFinite(p[c]) && p[c] >= 0 && p[c] <= 1) ||
      Math.abs(CLASSES.reduce((sum, c) => sum + p[c], 0) - 1) > 0.0001 ||
      result.prediction.confidence !== p[CLASSES[index]] || p[CLASSES[index]] !== Math.max(...Object.values(p)) ||
      !['LOW', 'MEDIUM', 'HIGH'].includes(result.riskLevel) ||
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
  return { result: { predictedClass: result.prediction.class, confidence: result.prediction.confidence,
      probabilities: p, riskLevel: result.riskLevel, modelVersion: result.modelVersion, isMock: result.isMock,
      preprocessingVersion: result.preprocessingVersion },
    processedBytes, preprocessing: { version: prep.version, parameters: prep.parameters, outputResolution: prep.outputResolution } };
}
