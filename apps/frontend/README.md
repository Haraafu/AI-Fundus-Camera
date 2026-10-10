## Frontend MVP

Open `http://127.0.0.1:3001/dashboard` after starting `npm run backend` and the Python AI service. The backend serves this frontend directly; no separate build or frontend server is needed.

Available pages: dashboard with examination counts and recent results, patients with search and history, new examination with upload preview, and result with original/processed images, confidence, probabilities, risk category, rule/model versions, status timeline, and failures. The workspace uses the same API origin and runs with MongoDB or SQLite.

Backend contract: `docs/api.md`. The MVP uses plain JavaScript and CSS served by Express.

The result page also shows Grad-CAM overlay/heatmap when available, the camera device ID, and inference-request duration. `/devices` displays the latest HTTP camera statuses and their history, polling every five seconds. Simulated camera IDs are explicitly labelled in the page guidance. See `docs/demo.md` for recording instructions.
