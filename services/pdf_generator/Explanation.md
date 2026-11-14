# Fundus AI — PDF Generator Module

> Current integration uses the binary EfficientNetB3 model (`No_DR`, `DR`). Binary reports display `NOT_ASSESSED` as "Tidak dinilai", retain model/preprocessing/risk-rule provenance, and do not infer ICDR severity. Five-class examples and benchmark results below describe historical scenarios. Local validation is not a physical-camera or joint hardware test.

This directory contains the headless Python PDF Report Generator for the **AI Fundus Camera** project. It generates automated, A4 medical examination reports using Python's `reportlab` and is integrated directly into the Node.js Express backend.

---

## Overview & System Role

The PDF Generator acts as a headless microservice inside the main application repository (`services/pdf_generator/`).

```text
[Client / Browser] ──GET /api/examinations/:id/report──► [Express Backend] ──execFile──► [Python ReportLab] ──► PDF Output
```

- **Express Endpoint:** `GET /api/examinations/:id/report`
- **Backend Controller:** `apps/backend/src/report.js`
- **Generator Location:** `services/pdf_generator/generate_report.py`

---

## Features & Data Mapping

The PDF generator renders examination data according to the project's PRD backlog roadmap:

1. **Patient & Exam Metadata:** Patient ID, Examination ID (UUID wrapped), Examination Date, Eye side (`OD (Kanan)` / `OS (Kiri)`).
2. **Fundus Image Pair:** Original uploaded image and 300×300 CLAHE preprocessed image side-by-side (with fallback placeholder boxes if images are missing).
3. **Primary Screening Summary:** Severity Stage (e.g. `Moderate`), Confidence Score (e.g. `81%`), and Risk Level (`MEDIUM`).
4. **5-Class DR Probabilities Table (P0/P1 Real Model Output):** Displays probabilities for all 5 Diabetic Retinopathy classes (`No_DR`, `Mild`, `Moderate`, `Severe`, `Proliferative_DR`) and highlights the predicted severity class in soft green (`#d5f5e3`).
5. **Vascular & Lesion Biomarkers Table (P2/P3 Roadmap Feature):** Displays a clean, styled placeholder banner indicating that CRAE/CRVE/AVR analysis is scheduled for future P2/P3 releases.

---

## Installation & Dependencies

The PDF generator uses `reportlab` and `pillow`. In the main repository, dependencies are included in `services/ai-service/requirements.txt` so a single `.venv` virtual environment powers both the AI service and the PDF generator.

```bash
# In the main repository root
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r services/ai-service/requirements.txt
```

---

## CLI Usage (Standalone / Testing)

You can run the script manually from the command line by passing an input JSON payload and an output PDF path:

```powershell
python generate_report.py --input mock_payload.json --output report.pdf
```

### JSON Input Payload Structure

```json
{
  "patient_id": "DEMO-001",
  "examination_id": "5460fa35-54bd-4041-9955-13f9d75daf11",
  "date": "2026-10-10",
  "eye_side": "OD (Kanan)",
  "images": {
    "clahe": "path/to/processed.png",
    "gradcam": null
  },
  "primary_screening": {
    "severity_stage": "Moderate",
    "risk_level": "MEDIUM",
    "confidence_score": "81%"
  },
  "probabilities": {
    "No_DR": 0.02,
    "Mild": 0.07,
    "Moderate": 0.81,
    "Severe": 0.08,
    "Proliferative_DR": 0.02
  },
  "risk_categories": []
}
```

---

## Testing & Quality Assurance

Run pytest to verify defense mechanisms against missing files, bad paths, malformed JSON payloads, non-square camera aspect ratios, and single-page budget compliance:

```bash
pytest test_report.py -v
```

---

## Week 10 Milestone: Full System Integration & v1.0-freeze

- **Proportional Image Scaling:** Resolves camera aspect-ratio distortions (e.g. 4:3, 16:9, or circular fundus feeds). Uses `reportlab.lib.utils.ImageReader` to preserve true anatomical aspect ratios within a $(210 \times 170)$ pt container.
- **High-DPI Preservation:** Embeds full raw camera resolution into the ReportLab vector stream, ensuring crisp clarity on both high-resolution digital displays and 300 DPI physical prints.
- **Strict 1-Page A4 Budget:** The layout is verified against edge cases (complete 5-class DR probability table + complete 9-biomarker risk table + 2 images) ensuring the report always fits strictly within one A4 page without page-spill.
- **Version Tag:** `v1.0-freeze` (Ready for end-to-end integration with hardware ingestion and backend streaming).

---

## Week 11 Milestone: Subsystem Testing, Stress Benchmarking & Data Acquisition

In Week 11, formal subsystem testing, stress/repeatability benchmarking, and experimental data acquisition were added to validate performance targets without modifying the frozen core generator logic (`v1.0-freeze`):

1. **Automated Benchmark & Data Acquisition Suite (`benchmark.py`):**
   - **Normal Condition Testing (`N1–N5`):** Renders all 5 ICDR Diabetic Retinopathy severity stages (`No_DR`, `Mild`, `Moderate`, `Severe`, `Proliferative_DR`) with complete CLAHE and Grad-CAM image pairs.
   - **Boundary Condition Testing (`B1–B3`):** Evaluates Full-HD `1920×1080` (`16:9` non-square) sensor feeds, minimum `64×64` resolution inputs, and extended 64+ character patient/examination metadata strings against the strict 1-page A4 budget.
   - **Fault / Error Injection Testing (`F1–F5`):** Verifies graceful fallback rendering for missing `gradcam` (`null` backend mode), missing dual images, corrupted image binary streams, incomplete JSON keys (`"N/A"` fallback), and malformed JSON syntax via CLI (`exit_code = 1`).
   - **Sequential Repeatability Stress Test ($N = 50$ runs):** Measures wall-clock compilation latency (**mean `355.31 ms`**, **median `353.85 ms`**, **std `20.29 ms`**, **$P_{95}$ `378.54 ms`**), CPU time (**mean `333.75 ms`**), peak memory usage (**`11.67 MB`**), and deterministic file size (**`503.09 KB`**, 100% success rate).
   - **Concurrent CLI Subprocess Burst ($10$ parallel requests / $4$ workers):** Simulates simultaneous Node.js Express `child_process.execFile` invocations, achieving **100% success (`10/10`)**, **`1,479.96 ms` average CLI latency** (`< 1,500 ms` proposal target), and **`2.30 reports/sec` throughput**.
   - **Automated Chart Generation:** Renders 3 high-resolution PNG performance charts using Pillow (`chart_latency_50_runs.png`, `chart_scenario_comparison.png`, `chart_concurrent_stress.png`).

2. **Week 11 Testing Dataset & Stage 1 Report (`services/pdf_generator/stress_test/`):**
   - `LAPORAN_PENGUJIAN_TAHAP_1.md`: Complete Stage 1 Testing Report (Objectives, Procedures, Experimental Data, Charts, Target Validation Matrix, and Initial Bottleneck Analysis for Weeks 12–13).
   - `raw_data/`: `scenario_results.csv`, `stress_test_50_runs.csv`, `concurrent_burst_10_runs.csv`, and `summary_metrics.json`.
   - `logs/system_test.log`: Timestamped execution log for all test scenarios and stress iterations.
   - `charts/`: Visual performance graphs for report inclusion.
   - `samples/`: 12 generated PDF sample artifacts across Normal (`N1–N5`), Boundary (`B1–B3`), and Fault (`F1–F4`) conditions.

---

## Week 11 Milestone: Subsystem Testing, Stress Benchmarking & Data Acquisition

In Week 11, formal subsystem testing, stress/repeatability benchmarking, and experimental data acquisition were added to validate performance targets without modifying the frozen core generator logic (`v1.0-freeze`):

1. **Automated Benchmark & Data Acquisition Suite (`benchmark.py`):**
   - **Normal Condition Testing (`N1–N5`):** Renders all 5 ICDR Diabetic Retinopathy severity stages (`No_DR`, `Mild`, `Moderate`, `Severe`, `Proliferative_DR`) with complete CLAHE and Grad-CAM image pairs.
   - **Boundary Condition Testing (`B1–B3`):** Evaluates Full-HD `1920×1080` (`16:9` non-square) sensor feeds, minimum `64×64` resolution inputs, and extended 64+ character patient/examination metadata strings against the strict 1-page A4 budget.
   - **Fault / Error Injection Testing (`F1–F5`):** Verifies graceful fallback rendering for missing `gradcam` (`null` backend mode), missing dual images, corrupted image binary streams, incomplete JSON keys (`"N/A"` fallback), and malformed JSON syntax via CLI (`exit_code = 1`).
   - **Sequential Repeatability Stress Test ($N = 50$ runs):** Measures wall-clock compilation latency (**mean `355.31 ms`**, **median `353.85 ms`**, **std `20.29 ms`**, **$P_{95}$ `378.54 ms`**), CPU time (**mean `333.75 ms`**), peak memory usage (**`11.67 MB`**), and deterministic file size (**`503.09 KB`**, 100% success rate).
   - **Concurrent CLI Subprocess Burst ($10$ parallel requests / $4$ workers):** Simulates simultaneous Node.js Express `child_process.execFile` invocations, achieving **100% success (`10/10`)**, **`1,479.96 ms` average CLI latency** (`< 1,500 ms` proposal target), and **`2.30 reports/sec` throughput**.
   - **Automated Chart Generation:** Renders 3 high-resolution PNG performance charts using Pillow (`chart_latency_50_runs.png`, `chart_scenario_comparison.png`, `chart_concurrent_stress.png`).

2. **Week 11 Testing Dataset & Stage 1 Report (`services/pdf_generator/stress_test/`):**
   - `LAPORAN_PENGUJIAN_TAHAP_1.md`: Complete Stage 1 Testing Report (Objectives, Procedures, Experimental Data, Charts, Target Validation Matrix, and Initial Bottleneck Analysis for Weeks 12–13).
   - `raw_data/`: `scenario_results.csv`, `stress_test_50_runs.csv`, `concurrent_burst_10_runs.csv`, and `summary_metrics.json`.
   - `logs/system_test.log`: Timestamped execution log for all test scenarios and stress iterations.
   - `charts/`: Visual performance graphs for report inclusion.
   - `samples/`: 12 generated PDF sample artifacts across Normal (`N1–N5`), Boundary (`B1–B3`), and Fault (`F1–F4`) conditions.
