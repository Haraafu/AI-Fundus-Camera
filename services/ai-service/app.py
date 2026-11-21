"""Fundus AI service with explicit mock and TensorFlow model modes."""
import base64
import os
from pathlib import Path
import sys

from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from fundus.adapters import ModelNotReadyError, create_adapter
from fundus.input_validation import FundusInputValidator, InputValidationError
from fundus.preprocessing import VERSION, encode_png, parameters, preprocess_bytes, validate_image

load_dotenv()
MAX_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", "10485760"))
if MAX_BYTES <= 0:
    raise ValueError("MAX_UPLOAD_BYTES must be positive")


def create_app(mode=None, model_path=None, model_version=None, model_class_names=None, image_validator=None):
    adapter = create_adapter(mode if mode is not None else os.getenv("AI_MODE", "mock"),
                             model_path=model_path, model_version=model_version,
                             model_class_names=model_class_names)
    validator = image_validator if image_validator is not None else FundusInputValidator()
    service = FastAPI(title="LUXORA AI service", version="0.6.0")

    def status():
        ready = adapter.ready and validator.ready
        return {"status": "healthy" if ready else "not_ready", "service": "ai",
                "mode": adapter.mode, "ready": ready, "modelLoaded": adapter.model_loaded,
                "modelVersion": adapter.model_version, "isMock": adapter.mode == "mock",
                "inputValidatorReady": validator.ready,
                "preprocessingVersion": VERSION, "errorCode": adapter.error_code if adapter.error_code else None if validator.ready else "IMAGE_VALIDATOR_UNAVAILABLE"}

    @service.get("/health")
    def health():
        return status()

    @service.get("/ready")
    def ready():
        current = status()
        return JSONResponse(status_code=200 if current['ready'] else 503, content=current)

    def rejected(error):
        return JSONResponse(status_code=error.status, content={"success": False, "error": {
            "code": error.code, "message": str(error), **({"details": error.details} if error.details else {})}})

    def validated_content(image):
        try:
            content = image.file.read(MAX_BYTES + 1)
        finally:
            image.file.close()
        if len(content) > MAX_BYTES:
            raise InputValidationError("UPLOAD_TOO_LARGE", "Image exceeds the upload limit.", 413)
        try:
            validate_image(content, image.content_type)
        except ValueError as error:
            raise InputValidationError("INVALID_IMAGE", "Upload a valid single JPEG or PNG image.", 400) from error
        return content, validator.require_fundus(content, image.content_type)

    @service.post("/validate-image")
    def validate_input(image: UploadFile = File(...)):
        try:
            _, validation = validated_content(image)
            return {"success": True, "inputValidation": validation}
        except InputValidationError as error:
            return rejected(error)
        except Exception:
            return rejected(InputValidationError("IMAGE_VALIDATOR_UNAVAILABLE", "Image validation could not complete. Try again.", 503))

    @service.post("/predict")
    def predict(image: UploadFile = File(...)):
        # Sync endpoint: CPU-bound OpenCV runs in FastAPI's thread pool.
        if not adapter.ready:
            image.file.close()
            return JSONResponse(status_code=503, content={"success": False, "error": {
                "code": adapter.error_code, "message": "Configured model is unavailable."}})
        try:
            content, validation = validated_content(image)
        except InputValidationError as error:
            return rejected(error)
        except Exception:
            return rejected(InputValidationError("IMAGE_VALIDATOR_UNAVAILABLE", "Image validation could not complete. Try again.", 503))
        try:
            processed = preprocess_bytes(content)
        except ValueError:
            return JSONResponse(status_code=400, content={"success": False, "error": {"code": "INVALID_IMAGE"}})
        try:
            result = adapter.predict(processed)
        except ModelNotReadyError:
            return JSONResponse(status_code=503, content={"success": False, "error": {
                "code": adapter.error_code or "MODEL_NOT_READY", "message": "Configured model is unavailable."}})
        except Exception:
            return JSONResponse(status_code=500, content={"success": False, "error": {
                "code": "INFERENCE_FAILED", "message": "Model inference did not produce a valid result."}})
        result["preprocessingVersion"] = VERSION
        result["inputValidation"] = validation
        result["preprocessing"] = {"version": VERSION, "outputResolution": [300, 300],
                                   "parameters": parameters(), "mimeType": "image/png",
                                   "imageBase64": base64.b64encode(encode_png(processed)).decode("ascii")}
        return result

    return service


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("AI_SERVICE_HOST", "127.0.0.1"), port=int(os.getenv("AI_SERVICE_PORT", "8000")))
