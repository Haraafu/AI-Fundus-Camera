import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from './ai-client.js';

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const GENERATOR_DIR = join(ROOT, 'services', 'pdf_generator');
const SCRIPT = join(GENERATOR_DIR, 'generate_report.py');

export function toPayload(exam, uploadDir) {
    const r = exam.result;
    const imagePath = filename => filename && filename === basename(filename) ? resolve(uploadDir, filename) : null;
    return {
        patient_id: exam.patientId,
        examination_id: exam.examinationId,
        date: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(new Date(exam.completedAt || exam.createdAt)),
        eye_side: exam.eye === 'RIGHT' ? 'OD (Kanan)' : 'OS (Kiri)',
        images: {
            clahe: imagePath(exam.image?.processedPath),
            gradcam: r.explanation?.status === 'AVAILABLE' ? imagePath(exam.image?.gradcamPath) : null
        },
        primary_screening: {
            severity_stage: r.predictedClass,
            risk_level: r.riskLevel,
            confidence_score: `${(r.confidence * 100).toFixed(1)}%`
        },
        provenance: {
            model_version: r.modelVersion,
            preprocessing_version: exam.image?.preprocessingVersion,
            risk_rule_version: r.riskRuleVersion,
            is_mock: r.isMock === true
        },
        probabilities: r.probabilities || {},
        risk_categories: []
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
                await run(config.reportPython || process.env.REPORT_PYTHON || process.env.PYTHON || 'python', [SCRIPT, '--input', inputPath, '--output', outputPath],
                    { cwd: GENERATOR_DIR, timeout: 30000, windowsHide: true });
            } catch {
                throw new ApiError(500, 'REPORT_FAILED', 'PDF report could not be generated.');
            }
            const pdf = await readFile(outputPath);
            if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new ApiError(500, 'REPORT_FAILED', 'Invalid PDF output.');
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
