export const DEVICE_CONTRACT_VERSION = 'fundus-device-http-v1';
export const UPLOAD_FIELDS = ['eye', 'capture_type', 'device_id', 'capture_timestamp'];

export function deviceContract(config) {
  return {
    version: DEVICE_CONTRACT_VERSION,
    transport: 'HTTP multipart/form-data over local Wi-Fi/LAN',
    health: '/health', readiness: '/api/system',
    createExamination: { method: 'POST', path: '/api/examinations', contentType: 'application/json',
      required: ['patientId', 'eye', 'captureType'],
      eye: ['LEFT', 'RIGHT'], captureType: ['MACULA_CENTERED', 'OPTIC_DISC_CENTERED'] },
    upload: { method: 'POST', path: '/api/examinations/{examinationId}/images',
      contentType: 'multipart/form-data', fileField: 'image',
      acceptedMimeTypes: ['image/jpeg', 'image/png'], maxBytes: config.maxUploadBytes,
      maxPixels: 40000000, optionalFields: UPLOAD_FIELDS,
      timestampFormat: 'ISO 8601 with timezone, e.g. 2026-10-31T09:00:00+07:00',
      response: 'Synchronous: HTTP 200 after processing, with examination status COMPLETED and result',
      recommendedClientTimeoutMs: Math.max(120000, config.aiTimeout + 30000),
      retryPolicy: 'Never retry blindly. GET examination first. Retry the same ID only if status is CREATED. A retake requires a new examination.' },
    getExamination: { method: 'GET', path: '/api/examinations/{examinationId}' },
    telemetry: { method: 'POST', path: '/api/devices/{deviceId}/status',
      states: ['IDLE', 'READY', 'CAPTURING', 'UPLOADING', 'ERROR'], heartbeatIntervalMs: 15000 },
    examinationStates: ['CREATED', 'IMAGE_RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED'],
    authentication: 'none; trusted local prototype network only',
    mqttImplemented: false
  };
}

export function validCaptureTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
