# Bundled inference assets

- `@ultralytics/yolo` npm package 0.0.56: https://github.com/ultralytics/inference (AGPL-3.0 / upstream enterprise option).
- YOLO11n pose and object detection ONNX weights: https://github.com/ultralytics/assets/releases/tag/v8.4.0 (Ultralytics licensing: https://www.ultralytics.com/license).
- ort-web runtime distribution 1.30.0: https://cdn.pyke.io/0/pyke:ort-rs/web@1.30.0/ ; ONNX Runtime: https://github.com/microsoft/onnxruntime (MIT), ort-web bridge: https://github.com/pykeio/ort (MIT/Apache-2.0 upstream).
- Test fixture `public/tests/fixtures/person.jpg`: Ultralytics bus example https://ultralytics.com/images/bus.jpg ; used only for real inference smoke tests.

Bundled runtime files are the CPU/WebGPU JS, MJS and WASM distributions, including the asyncify pair required by the WebGPU path, not generated application source. Model files are the upstream release exports. No frame upload service is used.
