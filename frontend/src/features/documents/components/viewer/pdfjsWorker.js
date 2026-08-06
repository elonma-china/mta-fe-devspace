// src/features/documents/components/viewer/pdfjsWorker.js
//
// pdfjs worker wiring, ISOLATED in its own module so tests can mock it
// wholesale (jest.mock("../pdfjsWorker")).
//
// The worker is served as a PRISTINE copy from public/ (see the
// "copy:pdfworker" npm script, run by prestart/prebuild). It must NOT go
// through webpack: CRA's babel "dependencies" pipeline rewrites the .mjs and
// injects @babel/runtime helper imports with ABSOLUTE build-machine paths
// ("/app/frontend/node_modules/..."), which cannot resolve in the browser —
// the module worker then dies with "Failed to load module script" and pdfjs
// degrades to a fake worker that fails the same way (found via headless
// repro against the client-server deployment, 2026-07-17).
import { pdfjs } from "react-pdf";

pdfjs.GlobalWorkerOptions.workerSrc = `${
  process.env.PUBLIC_URL || ""
}/pdf.worker.min.mjs`;
