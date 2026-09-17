// A small library surface (see package.json's "./evidence-pack" export) so another consumer —
// the dashboard (DOMAIN_CHECKLIST.md Phase 7's "one-click evidence-pack export") — can build the
// exact same pack `vellum export` does, without a second implementation to keep in sync.
export { buildManifest, type BuildManifestInput, type ExportManifest } from './manifest.js';
export { coverStampFor, renderEvidencePackPdf, type CoverStamp } from './pdf.js';
export { getToolVersion } from './version.js';
