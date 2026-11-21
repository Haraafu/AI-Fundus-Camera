# LUXORA input validator

Runtime assets for `fundus/input_validation.py`. Source:
https://huggingface.co/Xenova/clip-vit-base-patch32 at pinned revision
`6b7c523703ae26e39be4b03774966f8571c7f523` (MIT).

`vision.onnx` is the unmodified quantized vision graph, verified with SHA-256
`583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299`.
`prototypes.json` contains normalized class text embeddings and conservative
acceptance thresholds generated with `scripts/setup_input_validator.py`.

See `docs/image-input-validation.md` for setup, limits, checks and provenance.
