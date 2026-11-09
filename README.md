# Meesho Invoice to Tally Excel Converter

Browser-only: HTML + CSS + vanilla JS, PDF.js 3.11.174 and SheetJS 0.18.5 (loaded from cdnjs). No backend, no API keys.

## Run
1. Open the folder in VS Code and start **Live Server** on `index.html`
   (or run `python -m http.server 8000` in this folder and open http://localhost:8000).
2. Needs internet once per session for the two CDN scripts. For offline use, download
   `pdf.min.js`, `pdf.worker.min.js` and `xlsx.full.min.js`, put them in `js/lib/`, and change the three URLs
   (two `<script>` tags in `index.html`, one `workerSrc` line in `js/app.js`).
3. Add PDFs (or a folder), click **Process PDFs**, review/edit, click **Download Excel**.

## Files
- `js/schema.js` - the 19 Tally columns (single source of truth) and validation settings.
- `js/extractor.js` - PDF reading, line grouping, table/header detection, GSTIN/address/state logic (no DOM).
- `js/validation.js` - Valid / Warning / Error classification (never changes values).
- `js/app.js` - UI, bulk queue (3 files at a time), editing, Excel export.

## Notes
- One Excel row per product line. `OTHER CHARGES` lines are skipped (not shown, not exported), but they are still counted when checking that line totals add up to the invoice total. Total Bill Value therefore still includes them.
- Item Rate = Gross Amount (before discount). Item Basic Amount = Taxable Value. Total Bill Value = the invoice "Total".
- Tax types that do not appear in a row are exported as 0 when another tax was read; if no tax is read the cells stay blank and the row is flagged.
- Missing SKU / customer GSTIN are not flagged by default (normal on Meesho B2C invoices). Change `MI.CONFIG` in `js/schema.js` to flag them.
- Scanned (image-only) PDFs are rejected with "OCR required"; OCR is not included.
- For 5000+ PDFs: process in one go or in folders; keep the tab open and visible. Use **Stop** and **Retry failed** as needed. Export after processing.
