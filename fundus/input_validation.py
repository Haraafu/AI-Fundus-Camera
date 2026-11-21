"""Local semantic image-type gate, independent of the DR disease classifier."""
from collections import OrderedDict
import hashlib
import io
import json
import logging
from pathlib import Path
from threading import Lock

import numpy as np
from PIL import Image, ImageOps

from .preprocessing import validate_image

VERSION = "fundus-input-v1"
DIRECTORY = Path(__file__).resolve().parents[1] / "models" / "fundus-input-validator"
VISION_SHA256 = "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299"


class InputValidationError(ValueError):
    def __init__(self, code, message, status=422, details=None):
        super().__init__(message)
        self.code, self.status, self.details = code, status, details


class FundusInputValidator:
    def __init__(self, directory=DIRECTORY):
        self.ready = False
        self.session = None
        self.lock = Lock()
        self.cache = OrderedDict()
        try:
            import onnxruntime as ort

            directory = Path(directory)
            metadata = json.loads((directory / "prototypes.json").read_text(encoding="utf-8"))
            if metadata["version"] != VERSION or metadata["visionSha256"] != VISION_SHA256:
                raise ValueError("Unexpected input validator version")
            graph = directory / "vision.onnx"
            digest = hashlib.sha256()
            with graph.open("rb") as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(block)
            if digest.hexdigest() != VISION_SHA256:
                raise ValueError("Input validator checksum mismatch")
            self.classes = metadata["classes"]
            self.embeddings = np.asarray(metadata["embeddings"], dtype=np.float32)
            if self.embeddings.shape != (len(self.classes), 512) or not np.isfinite(self.embeddings).all():
                raise ValueError("Invalid image-type prototypes")
            self.embeddings /= np.linalg.norm(self.embeddings, axis=1, keepdims=True)
            self.fundus_index = next(index for index, item in enumerate(self.classes) if item["id"] == "retinal_fundus")
            self.thresholds = metadata["thresholds"]
            self.mean = np.array(metadata["preprocessing"]["mean"], dtype=np.float32)
            self.std = np.array(metadata["preprocessing"]["std"], dtype=np.float32)
            options = ort.SessionOptions()
            options.intra_op_num_threads = 2
            options.inter_op_num_threads = 1
            self.session = ort.InferenceSession(str(graph), sess_options=options, providers=["CPUExecutionProvider"])
            self.ready = True
        except Exception:
            logging.getLogger(__name__).exception("Fundus input validator is unavailable; image analysis is blocked")

    def _tensor(self, image):
        values = (np.asarray(image, dtype=np.float32) / 255.0 - self.mean) / self.std
        return values.transpose(2, 0, 1)

    def inspect(self, content, content_type=None):
        if not self.ready:
            raise InputValidationError("IMAGE_VALIDATOR_UNAVAILABLE", "Image validation is unavailable. Try again when the service is ready.", 503)
        validate_image(content, content_type)
        key = hashlib.sha256(content).hexdigest()
        with self.lock:
            if key in self.cache:
                self.cache.move_to_end(key)
                return dict(self.cache[key])
        with Image.open(io.BytesIO(content)) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
        width, height = image.size
        if min(width, height) < 128 or max(width, height) / min(width, height) > 3:
            raise InputValidationError("FUNDUS_IMAGE_UNCERTAIN", "Use a clear retinal fundus photograph at least 128 × 128 pixels, with the retina filling the image.")
        # Check the whole frame as well as the conventional CLIP center crop.
        # A retina embedded in a screenshot should not validate the interface.
        full = ImageOps.pad(image, (224, 224), method=Image.Resampling.BICUBIC, color=(0, 0, 0))
        scaled = image.resize((int(width * 224 / min(width, height)), int(height * 224 / min(width, height))), Image.Resampling.BICUBIC)
        x, y = (scaled.width - 224) // 2, (scaled.height - 224) // 2
        crop = scaled.crop((x, y, x + 224, y + 224))
        pixels = np.stack([self._tensor(full), self._tensor(crop)])
        with self.lock:
            features = self.session.run(["image_embeds"], {"pixel_values": pixels})[0]
        norms = np.linalg.norm(features, axis=1, keepdims=True)
        if not np.isfinite(features).all() or (norms <= 0).any():
            raise InputValidationError("IMAGE_VALIDATOR_UNAVAILABLE", "Image validation could not complete. Try again.", 503)
        similarities = (features / norms) @ self.embeddings.T
        logits = 100.0 * similarities
        scores = np.exp(logits - logits.max(axis=1, keepdims=True))
        scores /= scores.sum(axis=1, keepdims=True)
        index = self.fundus_index
        negatives = np.delete(similarities, index, axis=1).max(axis=1)
        margins = similarities[:, index] - negatives
        accepted = bool(np.all(
            (similarities.argmax(axis=1) == index)
            & (similarities[:, index] >= self.thresholds["minimumSimilarity"])
            & (margins >= self.thresholds["minimumMargin"])
            & (scores[:, index] >= self.thresholds["minimumMatchingScore"])
        ))
        most_cautious = int(scores[:, index].argmin())
        detected = self.classes[int(similarities[most_cautious].argmax())]
        result = {"version": VERSION, "sourceSha256": key, "method": "local_clip_zero_shot", "status": "ACCEPTED" if accepted else "REJECTED",
                  "decision": "Eye" if accepted else "Not eye",
                  "imageType": "retinal_fundus" if accepted else "not_eye",
                  "detectedLabel": "Eye" if accepted else "Not eye",
                  "uncertain": not accepted and detected["id"] == "retinal_fundus",
                  "matchingScore": round(float(scores[:, index].min()), 6),
                  "similarity": round(float(similarities[:, index].min()), 6), "margin": round(float(margins.min()), 6)}
        with self.lock:
            self.cache[key] = result
            if len(self.cache) > 64:
                self.cache.popitem(last=False)
        return dict(result)

    def require_fundus(self, content, content_type=None):
        result = self.inspect(content, content_type)
        if result["status"] != "ACCEPTED":
            uncertain = result["uncertain"]
            message = "This does not appear to be a fundus image. Please upload a clear retinal fundus photograph and try again."
            raise InputValidationError("FUNDUS_IMAGE_UNCERTAIN" if uncertain else "NON_FUNDUS_IMAGE", message, details=result)
        return result
