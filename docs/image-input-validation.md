# Retinal image-type validation

LUXORA runs an independent, local semantic image classifier before DR inference
or upload persistence. File extensions, RGB colors, and the DR model's softmax
confidence do not establish that an input is a fundus photograph.

The validator uses the pinned MIT-licensed
[Xenova ONNX export of CLIP ViT-B/32](https://huggingface.co/Xenova/clip-vit-base-patch32)
with fixed image-type text prototypes. Patient images stay on the backend
machine. Text embeddings are built during setup; runtime needs only the local
vision graph and `prototypes.json`, not an external API.

## Setup and availability

Install `services/ai-service/requirements.txt`. The vision model and prototypes
are included under `models/fundus-input-validator/`. If absent, regenerate them:

```powershell
.\.venv\Scripts\python.exe scripts/setup_input_validator.py
```

Setup pins source revision `6b7c523703ae26e39be4b03774966f8571c7f523`, verifies
both ONNX graphs with SHA-256 and the tokenizer's Git blob hash, and writes only
the vision graph and prototypes to the runtime model directory. The temporary
text graph is kept in ignored `data/input-validator-setup/`.

If the graph, prototypes, dependency, or validator is unavailable, `/ready`
returns 503. Validation and disease inference fail closed with
`IMAGE_VALIDATOR_UNAVAILABLE`; the system never bypasses the image-type check.

## Upload flow

1. The web form sends a memory-only preflight to authenticated
   `POST /api/images/validate` before creating an examination.
2. Python `/validate-image` checks the actual bytes, size, format and semantic
   image type. Non-fundus inputs return 422 `NON_FUNDUS_IMAGE`; uncertain inputs
   return 422 `FUNDUS_IMAGE_UNCERTAIN`. The UI shows the reason and permits a new
   file to be selected.
3. The final examination upload repeats the required check before writing any
   file or advancing examination status. ESP/API clients cannot skip it by
   omitting the preflight. Rejection leaves the examination `CREATED`, with no
   image or DR result, so a corrected camera image can use that same ID.
4. Python `/predict` also requires fundus validation before preprocessing or
   disease inference. Direct service calls therefore cannot bypass the gate.
5. Accepted metadata includes the original SHA-256. The backend verifies that
   the validation is bound to the exact uploaded bytes and saves the metadata
   alongside the image record in MongoDB.

The public decision is binary: **Eye / Not eye**. Eye means a retinal fundus photograph; external-eye photos are not accepted for DR analysis. Detailed alternative image categories are not displayed or returned as the decision.

Both the complete frame and a center crop must match the fundus prototype.
Alternative categories include maps, screenshots, documents, diagrams,
external eyes, faces, skin, animals, landscapes, objects, food, plants,
astronomy, OCT, radiology, microscopy, endoscopy and unrecognizable images.

## Limits and checks

This is a conservative zero-shot content filter, not a clinically validated
image-quality or universal out-of-distribution detector. Matching scores are
relative text/image similarities, not calibrated clinical probabilities.
Ambiguous images are rejected. It does not establish that an accepted image
has sufficient clinical quality, correct laterality, or a reliable DR result.

Threshold development used 40 local fundus examples. In a separate fixed-seed
100-image local check, 95 fundus images passed and 5 were rejected as uncertain.
The uploaded map, two dashboard screenshots, natural photographs (person,
animals, food, rocket) and solid-color images were rejected. An external
fundus example from scikit-image was accepted. These small checks are
regressions, not claims about generalization or clinical performance.

Protocol tests use explicit test-only validators rather than treating their
synthetic orange rectangles as real medical images. Normal startup has no
environment switch or client flag to disable the gate. Run actual-model tests:

```powershell
$env:AI_MODE = 'mock'
$env:LUXORA_TEST_INPUT_VALIDATOR = '1'
.\.venv\Scripts\python.exe services/ai-service/test_input_validation.py
```

The mock setting here avoids disease inference during validator tests; image
validation itself uses the real local CLIP model.

## Revalidate old examinations

`node scripts/audit_image_inputs.mjs` previews an audit of account-owned,
completed records without validation metadata. Add `--apply` to save decisions.
Accepted records keep their predictions. Rejected records are marked
`REJECTED`, lose their active DR/No DR result and report/Grad-CAM availability,
and display the rejection reason. Original images and prior predictions/image
metadata are preserved in the private `input_validation_audit` collection.
This prevents an old map result from continuing to appear as a valid DR
screening. Existing uploaded files are not deleted by the audit.
