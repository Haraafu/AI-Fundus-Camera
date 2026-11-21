## LUXORA frontend

The English interface includes `/login`, `/register`, and sign-out. Every account has its own patients and examinations. See [authentication](../../docs/authentication.md).

### Vercel (frontend only)

Deploy from this directory with `npx vercel --prod --project ai-fundus-camera`. Vercel runs `node build.mjs`
and publishes only the static files in `dist/`. The build marks the hosted
UI as a frontend preview: it makes no backend requests and shows unavailable
data as dashes. Patient and examination actions remain unavailable until a
public backend is connected. The local Express-served UI keeps its normal API
behavior because the preview flag is injected only into the Vercel build.

The Python AI service, database, uploaded images, model, and local `.env` are
not part of this deployment. To enable the full app later, replace the preview
flag in `build.mjs` and configure Vercel proxy rewrites for `/api/:path*` and
`/health` to the public backend before the UI route rewrites.

Open `http://127.0.0.1:3001/dashboard` after starting `npm run backend` and the Python AI service. The backend serves this frontend directly; no separate build or frontend server is needed.

Available pages: dashboard with examination counts and recent results, patients with search and history, new examination with upload preview, and result with original/processed images, confidence, probabilities, risk category, rule/model versions, status timeline, and failures. The workspace uses the same API origin and uses account-scoped MongoDB storage.

Backend contract: `docs/api.md`. The MVP uses plain JavaScript and CSS served by Express.

The result page also shows Grad-CAM overlay/heatmap when available, the camera device ID, and inference-request duration. `/devices` displays the latest HTTP camera statuses and their history, polling every five seconds. Simulated camera IDs are explicitly labelled in the page guidance. See `docs/demo.md` for recording instructions.
