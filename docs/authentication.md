# LUXORA accounts and private patient workspaces

LUXORA uses MongoDB for accounts, password hashes, sessions, patient records,
examinations, image metadata, and AI results. Configure `DATABASE_URL` and
`DATABASE_NAME` in your ignored `.env`. Normal backend startup requires MongoDB;
it never falls back to an unauthenticated SQLite workspace.

Start the Python AI service and `npm run backend`, then open `/register` to
create your own account. No default account or password is supplied. The web
interface is in English and retains the light/dark theme switch.

Passwords must contain 12–128 characters. Only salted scrypt hashes are stored.
Sign-in creates a seven-day session. The browser receives an HttpOnly,
SameSite=Lax cookie, marked Secure on HTTPS requests (including a local
Cloudflare Tunnel). Session tokens are random; only their SHA-256 hashes are
stored in MongoDB. Expired sessions are rejected immediately, independently of
MongoDB TTL cleanup. Signing out revokes the current session.

Every patient and examination operation is scoped by the signed-in account's
ID, including lists, search, notes, edits, deletion, uploads, images, Grad-CAM,
PDF reports, and camera telemetry. Ownership comes from the session rather than
the request body. Different accounts can use the same patient code. Another
account's examination ID returns 404. Clinical and authentication responses
use `Cache-Control: private, no-store`.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/auth/register` | `{name, email, password}`; create account and session |
| POST | `/api/auth/login` | `{email, password}`; create a session |
| GET | `/api/auth/me` | Current account, or 401 |
| POST | `/api/auth/logout` | Revoke the current cookie/Bearer session |
| POST | `/api/auth/device-token` | Create a seven-day account-bound camera token |

Cookie-authenticated writes, including registration and sign-in, require
`X-Luxora-Request: 1`. Cross-site browser mutations are rejected; no cross-origin
CORS access is enabled. Sign-in and registration are rate-limited using MongoDB
by IP and normalized email. `/health` is public; other `/api/*` routes require
authentication. The AI service remains private on localhost.

## ESP cameras and CLI clients

Sign in, then choose **Camera token → Generate token** in the account area.
Copy the token into the camera's private configuration. Send the following on
every camera API request (including device-contract and readiness requests):

```http
Authorization: Bearer <your-camera-token>
```

The creation/upload contract is unchanged. All patients and examinations
created by the camera belong to the account that generated its token. Tokens
are displayed once and are not stored in browser localStorage. A token can be
revoked with `POST /api/auth/logout` using that Bearer token. Otherwise it
expires after seven days; generate a new one when needed.

For the existing simulation and smoke CLIs:

```powershell
$env:LUXORA_DEVICE_TOKEN = '<your-camera-token>'
npm run device:mock -- 'C:\captures\fundus.jpg' PT-001 CAMERA-01
npm run smoke -- 'C:\captures\fundus.jpg'
```

## Existing records and image storage

Records created before accounts were introduced have no `ownerId`. They are
preserved in MongoDB, but no account can see or claim them automatically. An
administrator must explicitly map old records to the intended account before
migration; never assign all historical records to the first person who signs up.

MongoDB stores clinical records and image metadata. Original, processed, and
Grad-CAM image files remain in `UPLOAD_DIR` on the backend machine; they are
served only after an account-scoped examination lookup. Back up both MongoDB
and this directory. Do not serve the directory as a public static folder.

## Verification

`npm test` runs isolated SQLite regressions with an explicit test-only bypass.
Run the MongoDB authorization suite with `TEST_MONGODB_URL` and optionally
`TEST_MONGODB_NAME` set. It creates uniquely prefixed disposable collections,
tests two accounts and all sensitive routes, and removes only those test
collections. Never use real patient records as test fixtures.

The public web interface should be reached over HTTPS. Email verification and
password recovery are not implemented in this version.
