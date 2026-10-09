import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './ai-client.js';

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GENERATOR_DIR = join(ROOT, 'services', 'pdf_generator');
const SCRIPT = join(GENERATOR_DIR, 'generate_report.py');
const PYTHON = process.env.REPORT_PYTHON
    ? resolve(process.env.REPORT_PYTHON)
    : join(GENERATOR_DIR, 'venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

function toPayload(exam, uploadDir) {
    const r = exam.result;
    return {
        patient_id: exam.patientId,
        examination_id: exam.examinationId,
        date: (exam.completedAt || exam.createdAt).slice(0, 10),
        eye_side: exam.eye === 'RIGHT' ? 'OD (Kanan)' : 'OS (Kiri)',
        images: {
            clahe: exam.image?.processedPath ? resolve(uploadDir, exam.image.processedPath) : null,
            gradcam: null // belum dibuat, jadi generator render placeholder aja
        },
        primary_screening: {
            severity_stage: r.predictedClass,
            risk_level: r.riskLevel,
            confidence_score: `${Math.round(r.confidence * 100)}%`
        },
        probabilities: r.probabilities || {},
        risk_categories: [] // the backend doesn't compute the 9 biomarkers yet (P2/P3 feature)
    };
}

export function createReportHandler(config) {
    return async (req, res) => {
        const exam = req.exam; // loaded by the existing `find` middleware
        if (exam.status !== 'COMPLETED' || !exam.result) {
            throw new ApiError(409, 'REPORT_NOT_AVAILABLE', 'Report requires a completed examination.');
        }
        const dir = await mkdtemp(join(tmpdir(), 'fundus-report-'));
        const inputPath = join(dir, 'payload.json');
        const outputPath = join(dir, 'report.pdf');
        try {
            await writeFile(inputPath, JSON.stringify(toPayload(exam, config.uploadDir)), 'utf8');
            try {
                await run(PYTHON, [SCRIPT, '--input', inputPath, '--output', outputPath],
                    { cwd: GENERATOR_DIR, timeout: 30000, windowsHide: true });
            } catch {
                throw new ApiError(500, 'REPORT_FAILED', 'PDF report could not be generated.');
            }
            const pdf = await readFile(outputPath);
            res.set({
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="report-${exam.examinationId}.pdf"`,
                'Cache-Control': 'private, no-store'
            });
            res.send(pdf);
        } finally {
            // Runs on success, Python failure, or read failure.
            await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
            await rmdir(dir).catch(() => { });
        }
    };
}
