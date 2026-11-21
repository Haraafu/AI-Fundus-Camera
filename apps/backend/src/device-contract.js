export const DEVICE_CONTRACT_VERSION = 'fundus-device-http-v1';
export const UPLOAD_FIELDS = ['eye', 'capture_type', 'device_id', 'capture_timestamp'];

export function deviceContract(config) {
  return {
    version: DEVICE_CONTRACT_VERSION,
    transport: 'HTTP(S) multipart/form-data over local Wi-Fi/LAN or an HTTPS gateway',
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
    imageValidation: { preflight: '/api/images/validate', method: 'POST', fileField: 'image',
      requiredOnEveryUpload: true, rejectedHttpStatus: 422, errors: ['NON_FUNDUS_IMAGE', 'FUNDUS_IMAGE_UNCERTAIN'],
      unavailableHttpStatus: 503, unavailableCode: 'IMAGE_VALIDATOR_UNAVAILABLE',
      rejection: 'No image is stored or analyzed; the examination remains CREATED and can receive a corrected fundus photo.' },
    examinationStates: ['CREATED', 'IMAGE_RECEIVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED'],
    authentication: 'Sign in to LUXORA. Browsers use an HttpOnly session cookie; ESP clients use Authorization: Bearer <device token>. Create a 7-day device token with POST /api/auth/device-token from your signed-in account. All records belong to that account.',
    mqttImplemented: false
  };
}

export function validCaptureTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}
