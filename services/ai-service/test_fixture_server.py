"""Explicit loopback-only protocol-test fixture; never used by normal startup."""
import hashlib
import importlib.util
import os
from pathlib import Path
import uvicorn


class TestImageValidator:
    ready = True

    def require_fundus(self, content, content_type=None):
        return {"version": "fundus-input-v1", "status": "ACCEPTED", "method": "local_clip_zero_shot",
                "imageType": "retinal_fundus", "detectedLabel": "Retinal fundus photograph",
                "sourceSha256": hashlib.sha256(content).hexdigest(), "matchingScore": 1.0, "similarity": 0.4, "margin": 0.1}


if __name__ == '__main__':
    if os.getenv('AI_MODE') != 'mock':
        raise RuntimeError('The protocol-test fixture supports only explicit mock mode')
    spec = importlib.util.spec_from_file_location('test_ai_app', Path(__file__).with_name('app.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    app = module.create_app('mock', image_validator=TestImageValidator())
    uvicorn.run(app, host='127.0.0.1', port=int(os.environ['AI_SERVICE_PORT']))
