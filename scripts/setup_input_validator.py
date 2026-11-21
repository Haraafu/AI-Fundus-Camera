"""Install the pinned, local-only CLIP image-type validator and text prototypes.

No patient images or DR checkpoint weights are used or changed. Runtime needs
only the vision graph and prototypes.json; the tokenizer/text graph are setup
artifacts kept under the ignored data/ directory.
"""
import concurrent.futures
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.request

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "models" / "fundus-input-validator"
CACHE = ROOT / "data" / "input-validator-setup"
REVISION = "6b7c523703ae26e39be4b03774966f8571c7f523"
BASE = f"https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/{REVISION}"
VISION_SHA256 = "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299"
TEXT_SHA256 = "73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a"

# These are image-type descriptions, not DR labels. A low-margin or weak match
# is rejected rather than being sent to the disease classifier.
CATEGORIES = [
    ("retinal_fundus", "Retinal fundus photograph", [
        "a color retinal fundus photograph showing the retina, blood vessels and optic disc",
        "a medical photograph of the back of a human eye taken with a fundus camera",
        "a retinal fundus photography image of a human retina with branching blood vessels",
    ]),
    ("map", "Map or geographic diagram", ["a geographical map with place names and coastlines", "a map of an island with roads, labels and oceans"]),
    ("screenshot", "Screenshot or interface", ["a screenshot of a website or computer interface", "a screenshot with text, panels and buttons"]),
    ("document", "Document or text image", ["a photograph of a document with printed text", "a page of text or a handwritten note"]),
    ("diagram", "Chart, drawing or illustration", ["a chart or scientific diagram", "a colorful drawing or cartoon illustration"]),
    ("external_eye", "External eye photograph", ["a close up photograph of a human eye showing the iris and pupil", "an external photograph of an eye, eyelashes and eyelids"]),
    ("face", "Person or face photograph", ["a portrait photograph of a person's face", "a photograph of a person or a selfie"]),
    ("skin", "Skin or body photograph", ["a close up photograph of human skin", "a photograph of a human body part or a wound"]),
    ("animal", "Animal photograph", ["a photograph of an animal, dog or cat", "a wildlife photograph of a bird, fish or insect"]),
    ("landscape", "Landscape photograph", ["a landscape photograph with mountains, trees and sky", "a photograph of a beach, ocean or forest"]),
    ("object", "Ordinary object photograph", ["a photograph of an everyday object, furniture or a vehicle", "a photograph of a room or building"]),
    ("food", "Food or fruit photograph", ["a photograph of food or a meal", "a close up photograph of an orange, fruit or vegetables"]),
    ("flower", "Flower or plant photograph", ["a close up photograph of a flower", "a photograph of a leaf or plant"]),
    ("planet", "Astronomy image", ["a photograph of a planet or the moon", "an astronomy image of the sun or a star"]),
    ("oct", "OCT image", ["a retinal OCT cross section scan", "an optical coherence tomography image showing layers of the retina"]),
    ("radiology", "Radiology or ultrasound image", ["a medical X-ray, MRI or CT scan", "a medical ultrasound image"]),
    ("microscopy", "Microscope image", ["a microscope photograph of cells or tissue", "a histopathology slide photograph"]),
    ("endoscopy", "Endoscopy image", ["an endoscopic photograph of the stomach or intestine", "a medical endoscopy image of an internal organ"]),
    ("abstract", "Pattern or synthetic image", ["an abstract texture or colorful pattern", "a plain colored circle or computer generated noise"]),
    ("unusable", "Blank, dark or blurred image", ["a blank or completely black photograph", "an extremely blurry unrecognizable photograph"]),
]


def checksum(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def download_graph(name, size, sha256, target):
    if target.is_file() and checksum(target) == sha256:
        print(f"Verified existing {target.name}", flush=True)
        return
    parts = CACHE / (target.stem + "-parts")
    parts.mkdir(parents=True, exist_ok=True)
    chunk = 1024 * 1024
    count = math.ceil(size / chunk)

    def fetch(index):
        start, end = index * chunk, min(size - 1, (index + 1) * chunk - 1)
        part = parts / str(index)
        if part.is_file() and part.stat().st_size == end - start + 1:
            return part
        for attempt in range(4):
            try:
                request = urllib.request.Request(f"{BASE}/{name}?download=true", headers={"Range": f"bytes={start}-{end}"})
                with urllib.request.urlopen(request, timeout=40) as response:
                    if response.status != 206 or not response.headers.get("Content-Range", "").startswith(f"bytes {start}-{end}/"):
                        raise RuntimeError("Server did not return the requested model range")
                    content = response.read()
                if len(content) != end - start + 1:
                    raise RuntimeError("Incomplete model range")
                part.write_bytes(content)
                return part
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(attempt + 1)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        pending = [pool.submit(fetch, index) for index in range(count)]
        for completed, future in enumerate(concurrent.futures.as_completed(pending), 1):
            future.result()
            if completed % 20 == 0 or completed == count:
                print(f"{target.name}: {completed}/{count} ranges", flush=True)
    temporary = target.with_suffix(".download")
    with temporary.open("wb") as destination:
        for index in range(count):
            destination.write((parts / str(index)).read_bytes())
    if checksum(temporary) != sha256:
        raise RuntimeError("Model SHA-256 verification failed")
    temporary.replace(target)
    print(f"Verified {target.name}", flush=True)


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    download_graph("onnx/vision_model_quantized.onnx", 89117001, VISION_SHA256, DESTINATION / "vision.onnx")
    text_path = CACHE / "text.onnx"
    download_graph("onnx/text_model_quantized.onnx", 64504507, TEXT_SHA256, text_path)
    tokenizer_path = CACHE / "tokenizer.json"
    with urllib.request.urlopen(f"{BASE}/tokenizer.json", timeout=30) as response:
        tokenizer_bytes = response.read()
    git_hash = hashlib.sha1(b"blob " + str(len(tokenizer_bytes)).encode() + b"\0" + tokenizer_bytes).hexdigest()
    if git_hash != "bc1f77d20440541dd073ebae6f6c401087c7d34e":
        raise RuntimeError("Tokenizer revision verification failed")
    tokenizer_path.write_bytes(tokenizer_bytes)
    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    tokenizer.enable_truncation(max_length=77)
    tokenizer.enable_padding(length=77, pad_id=49407, pad_token="<|endoftext|>")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(text_path), sess_options=options, providers=["CPUExecutionProvider"])
    vectors = []
    for key, label, descriptions in CATEGORIES:
        encoded = tokenizer.encode_batch(descriptions)
        values = {
            "input_ids": np.array([value.ids for value in encoded], dtype=np.int64),
            "attention_mask": np.array([value.attention_mask for value in encoded], dtype=np.int64),
        }
        output = session.run(["text_embeds"], {item.name: values[item.name] for item in session.get_inputs()})[0]
        output = output / np.linalg.norm(output, axis=1, keepdims=True)
        mean = output.mean(axis=0)
        vectors.append((mean / np.linalg.norm(mean)).tolist())
    metadata = {
        "version": "fundus-input-v1", "model": "Xenova/clip-vit-base-patch32", "revision": REVISION,
        "visionSha256": VISION_SHA256, "license": "MIT", "method": "local_clip_zero_shot",
        "classes": [{"id": key, "label": label, "prompts": descriptions} for key, label, descriptions in CATEGORIES],
        "embeddings": vectors,
        "thresholds": {"minimumSimilarity": 0.22, "minimumMargin": 0.012, "minimumMatchingScore": 0.65},
        "preprocessing": {"shortestEdge": 224, "crop": 224, "mean": [0.48145466, 0.4578275, 0.40821073], "std": [0.26862954, 0.26130258, 0.27577711]},
        "limitations": "Zero-shot image-type screening; not a clinically validated image-quality or out-of-distribution detector. Ambiguous inputs are rejected."
    }
    (DESTINATION / "prototypes.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print("Local fundus input validator installed.", flush=True)


if __name__ == "__main__":
    main()
