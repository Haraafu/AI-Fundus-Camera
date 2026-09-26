"""Training-compatible image preparation; no disease prediction or /255 scaling."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import warnings

import cv2
import numpy as np
from PIL import Image, UnidentifiedImageError

VERSION = "fundus-prep-v1"
IMAGE_SIZE = 300
Image.MAX_IMAGE_PIXELS = 40_000_000


def parameters():
    return {"colorSpace": "RGB", "cropThreshold": 10, "resize": [300, 300],
            "resizeInterpolation": "INTER_AREA", "claheClipLimit": 2.0,
            "claheTileGridSize": [8, 8], "gaussianKernel": [3, 3], "gaussianSigma": 0,
            "pixelRange": [0, 255], "externalNormalization": "none"}


def validate_image(content, content_type=None):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as image:
                if (image.format not in ("PNG", "JPEG") or getattr(image, "n_frames", 1) != 1
                        or (content_type is not None and content_type != Image.MIME[image.format])):
                    raise ValueError("Expected a single PNG or JPEG image")
                image.verify()
            with Image.open(io.BytesIO(content)) as image:
                image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        raise ValueError("Invalid PNG/JPEG image") from exc


def crop_black_border(image, threshold=10):
    mask = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY) > threshold
    if not mask.any():
        return image
    coordinates = np.argwhere(mask)
    y_min, x_min = coordinates.min(axis=0)
    y_max, x_max = coordinates.max(axis=0)
    return image[y_min:y_max + 1, x_min:x_max + 1]


def apply_clahe(image):
    luminance, a, b = cv2.split(cv2.cvtColor(image, cv2.COLOR_RGB2LAB))
    luminance = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(luminance)
    return cv2.cvtColor(cv2.merge((luminance, a, b)), cv2.COLOR_LAB2RGB)


def preprocess_bytes(content, img_size=IMAGE_SIZE):
    validate_image(content)
    image = cv2.imdecode(np.frombuffer(content, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Image cannot be decoded by OpenCV")
    image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    image = crop_black_border(image)
    image = cv2.resize(image, (img_size, img_size), interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(apply_clahe(image), (3, 3), 0)


def preprocess_fundus_image(image_path, img_size=IMAGE_SIZE):
    return preprocess_bytes(Path(image_path).read_bytes(), img_size)


def encode_png(rgb):
    ok, encoded = cv2.imencode(".png", cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
    if not ok:
        raise ValueError("Cannot encode processed image")
    return encoded.tobytes()


def model_input(rgb):
    """Existing training expects NHWC float32 RGB 0..255, rescaling inside model."""
    if rgb.shape != (300, 300, 3) or rgb.dtype != np.uint8:
        raise ValueError("Expected a 300x300 RGB uint8 processed image")
    return rgb.astype(np.float32)[None, ...]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--reference", type=Path, help="Existing training PNG to compare pixel-by-pixel")
    args = parser.parse_args()
    metadata_path = args.output.with_suffix(".json")
    protected = {args.image.resolve()}
    if args.reference:
        protected.add(args.reference.resolve())
    if args.output.resolve() in protected or metadata_path.resolve() in protected:
        parser.error("Output must not overwrite the original or training reference")
    original = args.image.read_bytes()
    processed = preprocess_bytes(original)
    png = encode_png(processed)
    metadata = {"source": str(args.image), "sourceSha256": hashlib.sha256(original).hexdigest(),
                "processedSha256": hashlib.sha256(png).hexdigest(), "preprocessingVersion": VERSION,
                "parameters": parameters(), "outputResolution": [300, 300],
                "modelInput": {"shape": list(model_input(processed).shape), "dtype": "float32", "range": [0, 255]},
                "opencvVersion": cv2.__version__, "numpyVersion": np.__version__}
    if args.reference:
        reference = cv2.imdecode(np.frombuffer(args.reference.read_bytes(), dtype=np.uint8), cv2.IMREAD_COLOR)
        if reference is None:
            raise ValueError("Cannot read training reference")
        reference = cv2.cvtColor(reference, cv2.COLOR_BGR2RGB)
        same_shape = reference.shape == processed.shape
        metadata["trainingReference"] = {"path": str(args.reference),
            "pixelsEqual": bool(np.array_equal(processed, reference)),
            "maxAbsolutePixelDifference": int(np.abs(processed.astype(np.int16) - reference.astype(np.int16)).max()) if same_shape else None}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(png)
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(metadata, indent=2))
    if args.reference and not metadata["trainingReference"]["pixelsEqual"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
