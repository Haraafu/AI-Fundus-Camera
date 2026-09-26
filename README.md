# AI Fundus Camera

AI Fundus Camera is a local research prototype for fundus-image processing and AI-assisted diabetic-retinopathy screening. It combines an image preprocessing and EfficientNetB3 training pipeline with a Node.js backend, a SQLite examination store, and a separate Python AI service.

The project is intended for academic and research use. It is not a certified medical device, does not replace clinical examination, and must not be used as the sole basis for a medical decision.

## Capabilities

The repository provides the following working components:

- A local Express backend for creating examinations, receiving fundus images, validating uploads, coordinating inference, and returning stored results.
- A FastAPI AI service with health/readiness endpoints, explicit mock/model mode, and a structured image-prediction contract.
- A SQLite data store for patients, examinations, uploaded-image metadata, and AI results.
- Image upload validation for supported formats, decompression-bomb protection, maximum file size, maximum pixel count, and image-content verification.
- Examination status tracking from creation through image receipt, processing, completion, or failure.
- A deterministic mock adapter for integration tests and a TensorFlow adapter that loads a configured `.keras` model.
- Shared preprocessing for one image, the batch script, and the AI service; original and processed images are stored separately with preprocessing parameters and version.
- An EfficientNetB3 training workflow with augmentation, class weighting, checkpointing, early stopping, learning-rate reduction, and fine-tuning.
- Integration tests covering successful requests, validation failures, AI failures, timeouts, concurrent uploads, persistence, and corrupted images.
- A smoke-test script for exercising the local backend with a dataset image.

## System Flow

```text
Client
  -> Express backend
  -> Upload validation and temporary storage
  -> Python AI service
  -> Shared preprocessing + mock or TensorFlow model prediction
  -> SQLite persistence
  -> Examination result
```

Uploaded originals are preserved in `data/uploads/`. The backend forwards the image to the AI service, stores the returned 300 x 300 processed PNG under a different filename, persists the result and preprocessing metadata, and exposes the completed examination through its API.

## Services and API

### Node.js backend

The backend listens on `http://127.0.0.1:3001` by default.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check backend availability |
| `POST` | `/api/examinations` | Create an examination |
| `POST` | `/api/examinations/:id/images` | Upload and analyse one fundus image |
| `GET` | `/api/examinations/:id` | Retrieve examination, image, and result data |

Creating an examination requires a patient identifier, eye selection (`LEFT` or `RIGHT`), and capture type (`MACULA_CENTERED` or `OPTIC_DISC_CENTERED`). Uploaded files must be PNG or JPEG images. The default maximum upload size is 10 MiB and the default maximum image size is 40 megapixels.

### Python AI service

The FastAPI service listens on `http://127.0.0.1:8000` by default. Interactive API documentation is available at `http://127.0.0.1:8000/docs`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Report service and model status |
| `GET` | `/ready` | Return 200 for a ready adapter, 503 when the selected model adapter is unavailable |
| `POST` | `/predict` | Validate an image and return a prediction contract |

The default service uses `AI_MODE=mock`: preprocessing is real and predictions are dummy. The prediction fields of every successful response are:

```json
{
  "success": true,
  "prediction": {
    "class": "Moderate",
    "confidence": 0.81
  },
  "probabilities": {
    "No_DR": 0.02,
    "Mild": 0.07,
    "Moderate": 0.81,
    "Severe": 0.08,
    "Proliferative_DR": 0.02
  },
  "riskLevel": "MEDIUM",
  "modelVersion": "mock-v0",
  "isMock": true,
  "preprocessingVersion": "fundus-prep-v1"
}
```

The full response additionally carries `preprocessing` with a processed PNG encoded as base64 and its parameters; see [API contract](docs/api.md). The backend validates and stores that PNG without retaining base64 in the database.

`AI_MODE=model` loads the Keras checkpoint configured by `MODEL_PATH`. `MODEL_CLASS_NAMES` must list the five model outputs in their training order; the adapter maps them to the canonical API labels. A missing checkpoint returns `MODEL_NOT_READY`, and a load failure returns `MODEL_LOAD_FAILED`; model mode never falls back to mock. Configure the same mode on both services. See [model contract](docs/model-contract.md).

## Examination Lifecycle

An examination follows this state model:

```text
CREATED -> IMAGE_RECEIVED -> PROCESSING -> COMPLETED
                                      \\-> FAILED
```

The backend preserves the original upload when processing fails and records an error code and message. A second upload for the same examination is rejected after the first upload has started; a new examination should be created for a retake. If the backend restarts during processing, the interrupted examination is marked as failed.

## Data Storage (Still Temporary)

SQLite is created automatically at `data/fundus.sqlite`. The store contains:

- `patients`: patient identifiers and creation timestamps.
- `examinations`: examination metadata and lifecycle status.
- `fundus_images`: uploaded-image metadata and file references.
- `ai_results`: prediction, confidence, probabilities, risk level, model version, and mock flag.

The service stores extensible JSON documents for examination, image, and AI-result records. Uploaded files are stored under `data/uploads/` while the database keeps their metadata and references.

## Machine-Learning Pipeline

### Supported classes

The dataset has five diabetic-retinopathy diagnosis codes:

| Label | Class |
| --- | --- |
| `0` | `No_DR` |
| `1` | `Mild` |
| `2` | `Moderate` |
| `3` | `Severe` |
| `4` | `Proliferate_DR` |

These dataset codes do not establish the trained model's neuron order. Model integration requires the actual `train_ds.class_names` from training. The API maps the legacy folder name `Proliferate_DR` to `Proliferative_DR` explicitly.

### Preprocessing

Run `preprocess.py` to transform the source dataset from `colored_images/` into `preprocessed_images/`. For each image, the pipeline:

1. Finds the source file using its `id_code` from `train.csv`.
2. Converts OpenCV BGR data to RGB.
3. Crops black borders around the fundus image.
4. Resizes the image to 300 x 300 pixels.
5. Applies CLAHE contrast enhancement in LAB colour space.
6. Applies light Gaussian denoising.
7. Saves a PNG in the corresponding class directory.

Both batch and service code use `fundus/preprocessing.py`. To process one image and compare against an existing training PNG:

```powershell
.\.venv\Scripts\python.exe -m fundus.preprocessing colored_images/Moderate/000c1434d8d7.png --output data/preprocessing/processed.png --reference preprocessed_images/Moderate/000c1434d8d7.png
```

The output PNG has a JSON sidecar with parameters, hashes, and pixel comparison. Model input preparation keeps RGB values in 0–255 as float32, matching the integrated EfficientNetB3 checkpoint's internal rescaling.

### Training

Training and evaluation utilities live under `scripts/ml/`. The current workflow audits duplicate images, creates a fixed train/validation/test split, caches EfficientNetB3 embeddings, and compares dense, regularized, and ordinal heads. Run the ordinal workflow with:

```powershell
python scripts/ml/train_fundus_baseline.py
python scripts/ml/train_fundus_ordinal.py
```

The earlier fine-tuning workflow remains available as `scripts/ml/train_efficientnetb3_legacy.py` for comparison.

The currently integrated research checkpoint is `models/fundus_b3_ordinal.keras`. It can be replaced after later training by changing `MODEL_PATH`, `MODEL_VERSION`, and `MODEL_CLASS_NAMES`, provided the replacement follows the documented input and output contract. See [training results](docs/training.md) and [integration validation](docs/integration.md).

## Project Structure

```text
.
|-- apps/
|   |-- backend/
|   |   |-- src/
|   |   `-- test/
|   `-- frontend/              # Frontend application directory
|-- services/
|   `-- ai-service/             # FastAPI AI service
|-- fundus/                     # Shared preprocessing, class mapping and adapters
|-- scripts/
|   |-- ml/                     # Training and model-evaluation utilities
|   `-- smoke.mjs               # Local API smoke test
|-- docs/
|   |-- project/                # Proposal, planner, PRD, and project assets
|   |-- api.md
|   |-- integration.md
|   |-- model-contract.md
|   `-- training.md
|-- data/
|   `-- uploads/                # Uploaded originals
|-- colored_images/             # Source dataset, ignored by Git
|-- preprocessed_images/        # Generated dataset, ignored by Git
|-- models/                     # Generated model files, ignored by Git
|-- preprocess.py
|-- train.csv
|-- package.json
`-- README.md
```

## Requirements

- Node.js 22.13 or later. The backend uses Node's built-in SQLite support.
- Python 3.11 or later (required by the pinned NumPy version).
- Python packages listed in `services/ai-service/requirements.txt`.
- TensorFlow and training dependencies when running training; pandas and tqdm when running the batch preprocessing script.
- A local copy of the dataset when running preprocessing, training, or the smoke test with a dataset image.

## Setup

Run these commands from the repository root.

```powershell
npm ci
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r services/ai-service/requirements.txt
Copy-Item .env.example .env
```

For real inference, set these values in `.env`:

```dotenv
AI_MODE=model
MODEL_PATH=./models/fundus_b3_ordinal.keras
MODEL_VERSION=fundus-b3-ordinal-aptos-v1
MODEL_CLASS_NAMES=Mild,Moderate,No_DR,Proliferate_DR,Severe
```

Keep `AI_MODE=mock` for deterministic integration tests. The checked-in `.env.example` defaults to mock mode, while this workspace's local `.env` is configured for the integrated model.

Start the AI service in one terminal:

```powershell
.\.venv\Scripts\python.exe services/ai-service/app.py
```

Start the backend in a second terminal:

```powershell
npm run backend
```

Run a local smoke test in a third terminal:

```powershell
npm run smoke -- "colored_images/Moderate/000c1434d8d7.png"
```

Replace the image path with a file that exists locally. Use anonymous patient identifiers for test data.

On Linux or macOS, use `.venv/bin/python` and run:

```bash
PYTHON=.venv/bin/python npm test
```

## Testing

Run backend and Python tests with:

```powershell
npm test
.\.venv\Scripts\python.exe -m pip install -r services/ai-service/requirements-dev.txt
.\.venv\Scripts\python.exe services/ai-service/test_ai_service.py
```

The backend suite starts the Python service in mock mode, uses temporary ports and SQLite, and cleans up after the run. It exercises successful mock inference with real preprocessing, byte preservation, persistence, upload validation, unavailable AI, timeouts, invalid responses, concurrency, model readiness errors, and mock/model mode mismatch. Python tests cover preprocessing, pixel scaling, class mapping, readiness, and missing-model handling. Use the smoke command with `AI_MODE=model` for a real end-to-end inference check.

## Configuration and Generated Files

The local environment can be configured through `.env` and `.env.example`. Common settings include the backend port, AI service URL, database location, and upload directory.

Generated datasets, model files, SQLite databases, uploads, virtual environments, logs, local environment files, and internal handover metadata are excluded through `.gitignore`. User-facing API, model, training, and integration documentation remains under `docs/`.

## Limitations

- The checked-in environment template defaults to deterministic mock data; real inference requires `AI_MODE=model` and an available checkpoint.
- The integrated checkpoint is a research model trained on APTOS data. Its current evaluation is documented in [docs/training.md](docs/training.md); it is not a clinically validated diagnostic model.
- The repository does not provide a clinical image-quality gate, Grad-CAM visualisation, PDF reporting workflow, or hardware/MQTT communication layer.
- The backend is designed for local development and does not provide production authentication, HTTPS, or deployment configuration.
- SQLite usage is intended for a local backend instance rather than a multi-instance production deployment.
- Results are preliminary research output and require review by qualified healthcare professionals.

## License and Use

This project is an educational and research prototype. Review the repository's project materials and dataset terms before redistributing code, images, or trained models.
