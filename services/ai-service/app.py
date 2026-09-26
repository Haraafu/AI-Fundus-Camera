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
from fundus.preprocessing import VERSION, encode_png, parameters, preprocess_bytes, validate_image

load_dotenv()
MAX_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", "10485760"))
if MAX_BYTES <= 0:
    raise ValueError("MAX_UPLOAD_BYTES must be positive")


def create_app(mode=None, model_path=None, model_version=None, model_class_names=None):
    adapter = create_adapter(mode if mode is not None else os.getenv("AI_MODE", "mock"),
                             model_path=model_path, model_version=model_version,
                             model_class_names=model_class_names)
    service = FastAPI(title="AI Fundus service", version="0.5.0")

    def status():
        return {"status": "healthy" if adapter.ready else "not_ready", "service": "ai",
                "mode": adapter.mode, "ready": adapter.ready, "modelLoaded": adapter.model_loaded,
                "modelVersion": adapter.model_version, "isMock": adapter.mode == "mock",
                "preprocessingVersion": VERSION, "errorCode": adapter.error_code}

    @service.get("/health")
    def health():
        return status()

    @service.get("/ready")
    def ready():
        return JSONResponse(status_code=200 if adapter.ready else 503, content=status())

    @service.post("/predict")
    def predict(image: UploadFile = File(...)):
        # Sync endpoint: CPU-bound OpenCV runs in FastAPI's thread pool.
        try:
            if not adapter.ready:
                return JSONResponse(status_code=503, content={"success": False, "error": {
                    "code": adapter.error_code, "message": "Configured model is unavailable."}})
            content = image.file.read(MAX_BYTES + 1)
        finally:
            image.file.close()
        if len(content) > MAX_BYTES:
            return JSONResponse(status_code=413, content={"success": False, "error": {"code": "UPLOAD_TOO_LARGE"}})
        try:
            validate_image(content, image.content_type)
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
        result["preprocessing"] = {"version": VERSION, "outputResolution": [300, 300],
                                   "parameters": parameters(), "mimeType": "image/png",
                                   "imageBase64": base64.b64encode(encode_png(processed)).decode("ascii")}
        return result

    return service


app = create_app()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.getenv("AI_SERVICE_HOST", "127.0.0.1"), port=int(os.getenv("AI_SERVICE_PORT", "8000")))
