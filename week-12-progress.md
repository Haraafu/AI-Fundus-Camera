# Week 12 progress

Summary of UI, backend, and test updates implemented for the **AI Fundus Camera** workspace.

## 1. Dashboard & Branding Updates
- **[apps/frontend/index.html](apps/frontend/index.html)**
  - Updated the page title to `AI Fundus Camera · Sistem Skrining Retinopati Diabetik` and header subtitle to `Sistem Skrining Retinopati Diabetik Berbasis AI`.
  - Replaced the old `fundus.` sidebar branding with `AI Fundus Camera` and `Skrining Retinopati Diabetik` while keeping the `◉` icon (`.brand-icon`).
  - Added SVG icons to the sidebar navigation links (`Dashboard`, `Pasien`, `Pemeriksaan baru`) and added an SVG favicon.
- **[apps/frontend/style.css](apps/frontend/style.css)**
  - Refined layout, typography, cards, tables, badges, and responsive breakpoints (`1100px` and `700px`).
  - Added styles for confirmation modals (`.modal`), toast notifications (`.toasts`, `.toast`), the drag-and-drop image upload area (`.dropzone`), and distinct destructive buttons (`.button.danger`, `.button.danger-outline`, `.icon-btn.danger`).

## 2. Patient Management (Create Notes, Edit, Delete) & Examination Deletion
- **[apps/frontend/app.js](apps/frontend/app.js)**
  - **Patient notes:** Added an optional `notes` input (up to 500 characters) on `/patients` and displayed notes in both the patient table and `/patients/:patientId` detail view.
  - **Edit patient (`edit-patient`):** Added an edit modal (accessible from the patient list and patient detail page) to update a patient's `patientId` and `notes`.
  - **Delete patient (`delete-patient`):** Added a destructive delete button with a confirmation modal that requires typing the exact `patientId` before deleting the patient and their examinations/images. Disabled when any examination for the patient is `IMAGE_RECEIVED` or `PROCESSING`.
  - **Delete examination (`delete-exam`):** Replaced the plain delete entry with a red trash icon button in examination tables and a `Hapus` (`danger-outline`) button on `/examinations/:id`, backed by a confirmation modal.
  - **Additional frontend improvements:** Added toast notifications (`toast`, `flash`), drag-and-drop upload support on `/examinations/new`, Indonesian status/risk labels, and an `Unduh laporan` link on completed examinations.

## 3. Backend API & Persistence
- **[apps/backend/src/store.js](apps/backend/src/store.js)**
  - Added `notes` support to both `createSqliteStore` (including an `ALTER TABLE patients ADD COLUMN notes TEXT` migration for existing SQLite databases) and `createMongoStore`.
  - Added `getPatient`, `updatePatient` (cascading `patientId` renames to `examinations`), `deletePatient` (transactional removal of the patient and their `examinations`, `fundus_images`, and `ai_results`), and `deleteExamination` to both SQLite and MongoDB stores.
- **[apps/backend/src/app.js](apps/backend/src/app.js)**
  - Updated `POST /api/patients` to validate and store optional `notes` (up to 500 characters).
  - Added `GET /api/patients/:patientId`, `PATCH /api/patients/:patientId`, and `DELETE /api/patients/:patientId` with `409 PATIENT_BUSY` guards while examinations are processing, `409 PATIENT_EXISTS` on duplicate rename, and cleanup of uploaded original/processed image files on delete.
  - Added `DELETE /api/examinations/:id` with `409 EXAMINATION_LOCKED` protection while processing and cleanup of associated image files.

## 4. Tests
- **[apps/backend/test/integration.test.js](apps/backend/test/integration.test.js)**
  - Added integration test `patients can be edited, renamed and deleted; examinations can be deleted with their files` covering note validation, `409` conflict handling, cascading patient ID renames, examination deletion, patient deletion, and uploaded file removal.
  - Verified `npm test` (11/11 tests passing) after backend and test updates, prior to the final sidebar logo styling tweak.
