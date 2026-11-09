/* UI + Excel export. Extraction logic lives in extractor.js (no DOM there). */
(function () {
  'use strict';
  const MI = window.MI, $ = (id) => document.getElementById(id);
  const CONCURRENCY = 3, PAGE = 100;
  const files = new Map();      // key -> {file,key,status,msg,rows,rawText}
  let records = [], stop = false, running = false, page = 0, view = [];

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (d) => (d instanceof Date && !isNaN(d) ? String(d.getDate()).padStart(2, '0') + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + d.getFullYear() : '');
  function parseDate(s) {
    const m = String(s).trim().match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
    if (!m) return undefined;
    const d = new Date(+m[3], +m[2] - 1, +m[1], 12);
    return d.getDate() === +m[1] && d.getMonth() === +m[2] - 1 ? d : undefined;
  }
  const show = (v, t) => (t === 'date' ? fmtDate(v) : v == null ? '' : v);
  function setStatus(t) { $('status').textContent = t; }

  /* ---------- adding files ---------- */
  function addFiles(list) {
    let added = 0;
    for (const f of list) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') continue;
      const key = f.name + '|' + f.size + '|' + f.lastModified;
      if (files.has(key)) continue;
      files.set(key, { file: f, key, status: 'pending', msg: '', rows: 0, rawText: '' });
      added++;
    }
    setStatus(added + ' file(s) added');
    refresh(true);
  }
  async function readEntry(en, out) {
    if (en.isFile) await new Promise((res) => en.file((f) => { out.push(f); res(); }, res));
    else if (en.isDirectory) {
      const rd = en.createReader();
      let batch;
      do { batch = await new Promise((res, rej) => rd.readEntries(res, rej)); for (const c of batch) await readEntry(c, out); } while (batch.length);
    }
  }

  /* ---------- processing ---------- */
  async function processOne(entry) {
    entry.status = 'processing';
    try {
      const buf = await entry.file.arrayBuffer();
      const inv = await MI.extractMeeshoInvoice(buf, window.pdfjsLib);
      const recs = MI.normalizeMeeshoInvoice(inv, entry.file.name).map((r, n) => { r._id = entry.key + '#' + n; r._key = entry.key; return MI.validateRecord(r); });
      if (!recs.length) throw new Error('No product rows found (only OTHER CHARGES lines)');
      records = records.filter((r) => r._key !== entry.key).concat(recs);
      entry.rows = recs.length; entry.rawText = inv.rawText; entry.status = 'ok'; entry.msg = '';
    } catch (e) {
      entry.status = 'failed'; entry.msg = e && e.message ? e.message : String(e);
    }
  }
  async function processAll(list) {
    if (running || !list.length) return;
    if (!window.pdfjsLib) { showLibError(); return; }
    running = true; stop = false; setBusy(true);
    let idx = 0, doneCount = 0;
    $('bar').max = list.length; $('bar').value = 0;
    const worker = async () => {
      while (!stop) {
        const i = idx++;
        if (i >= list.length) break;
        await processOne(list[i]);
        doneCount++;
        $('bar').value = doneCount;
        if (doneCount % 10 === 0) { setStatus('Processing ' + doneCount + ' / ' + list.length); refresh(false); await new Promise((r) => setTimeout(r, 0)); }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    running = false; setBusy(false);
    list.forEach((e) => { if (e.status === 'processing') e.status = 'pending'; });
    setStatus(stop ? 'Stopped' : 'Finished'); refresh(true);
  }
  function setBusy(b) { $('btnProcess').disabled = b; $('btnStop').disabled = !b; $('btnClear').disabled = b; $('btnRetry').disabled = b; $('btnFiles').disabled = b; $('btnFolder').disabled = b; }

  /* ---------- rendering ---------- */
  let timer = null;
  function refresh(now) {
    if (now) { clearTimeout(timer); timer = null; draw(); } else if (!timer) timer = setTimeout(() => { timer = null; draw(); }, 400);
  }
  function draw() { renderSummary(); renderFiles(); renderTable(); }
  function renderSummary() {
    const all = [...files.values()];
    $('sTotal').textContent = all.length;
    $('sDone').textContent = all.filter((f) => f.status === 'ok').length;
    $('sFail').textContent = all.filter((f) => f.status === 'failed').length;
    $('sRows').textContent = records.length;
    $('sWarn').textContent = records.filter((r) => r._status === 'Warning').length;
    $('sErr').textContent = records.filter((r) => r._status === 'Error').length;
    const pending = all.filter((f) => f.status === 'pending').length;
    if (!running) { $('btnProcess').disabled = !pending; $('btnRetry').disabled = !all.some((f) => f.status === 'failed'); $('btnClear').disabled = !all.length; }
    $('btnExport').disabled = !records.length;
  }
  function renderFiles() {
    const flt = $('fileFilter').value, all = [...files.values()].filter((f) => flt === 'all' || f.status === flt);
    $('fileCount').textContent = '(' + files.size + ')';
    $('fileTable').tBodies[0].innerHTML = all.slice(0, 300).map((f) =>
      '<tr><td>' + esc(f.file.name) + '</td><td><span class="' + (f.status === 'ok' ? 'ok' : f.status === 'failed' ? 'failed' : '') + '">' + f.status + '</span></td><td>' + f.rows + '</td><td class="note">' + esc(f.msg) +
      '</td><td>' + (f.rawText ? '<button class="btn" data-raw="' + esc(f.key) + '">Text</button> ' : '') + (running ? '' : '<button class="btn" data-rm="' + esc(f.key) + '">Remove</button>') + '</td></tr>').join('') +
      (all.length > 300 ? '<tr><td colspan="5">… and ' + (all.length - 300) + ' more (use the filter)</td></tr>' : '');
  }
  function getView() {
    const q = $('search').value.trim().toLowerCase(), st = $('statusFilter').value;
    return records.filter((r) => (st === 'all' || r._status === st) && (!q || MI.COLUMNS.some((c) => String(show(r[c.key], c.type)).toLowerCase().includes(q)) || r._file.toLowerCase().includes(q)));
  }
  function renderTable() {
    const t = $('dataTable');
    if (!t.tHead.rows.length) t.tHead.innerHTML = '<tr><th>Status</th>' + MI.COLUMNS.map((c) => '<th>' + c.label + '</th>').join('') + '<th>Review notes</th><th>File</th></tr>';
    view = getView();
    const pages = Math.max(1, Math.ceil(view.length / PAGE));
    page = Math.min(page, pages - 1);
    $('pageInfo').textContent = (page + 1) + ' / ' + pages + ' (' + view.length + ' rows)';
    t.tBodies[0].innerHTML = view.slice(page * PAGE, (page + 1) * PAGE).map((r) =>
      '<tr data-id="' + esc(r._id) + '"><td class="st">' + statusCell(r) + '</td>' +
      MI.COLUMNS.map((c) => '<td class="' + (c.key === 'itemName' ? 'name' : '') + '"><input data-k="' + c.key + '" value="' + esc(show(r[c.key], c.type)) + '"></td>').join('') +
      '<td class="note">' + esc(r._msgs.join('; ')) + '</td><td>' + esc(r._file) + '</td></tr>').join('');
  }
  const statusCell = (r) => '<span class="b ' + r._status + '">' + r._status + '</span>';
  function renderAll() { page = 0; renderTable(); }

  /* ---------- editing ---------- */
  function onEdit(e) {
    const inp = e.target;
    if (!inp.dataset || !inp.dataset.k) return;
    const tr = inp.closest('tr'), r = records.find((x) => x._id === tr.dataset.id);
    if (!r) return;
    const col = MI.COLUMNS.find((c) => c.key === inp.dataset.k), v = inp.value.trim();
    if (col.type === 'num') r[col.key] = v === '' ? null : (isFinite(Number(v.replace(/,/g, ''))) ? Number(v.replace(/,/g, '')) : NaN);
    else if (col.type === 'date') { const d = v === '' ? null : parseDate(v); r[col.key] = d === undefined ? new Date(NaN) : d; }
    else r[col.key] = v;
    MI.validateRecord(r);
    tr.querySelector('.st').innerHTML = statusCell(r);
    tr.querySelector('.note').textContent = r._msgs.join('; ');
    renderSummary();
  }

  /* ---------- Excel export ---------- */
  function exportToExcel(recs) {
    if (!window.XLSX) throw new Error('SheetJS (XLSX) did not load. Check your internet connection / CDN access.');
    const rows = recs;
    const cell = (r, c) => {
      const v = r[c.key];
      if (c.type === 'date') return v instanceof Date && !isNaN(v) ? v : '';
      if (c.type === 'num') return typeof v === 'number' && isFinite(v) ? v : '';
      return v == null ? '' : v;
    };
    const aoa = [MI.COLUMNS.map((c) => c.label)].concat(rows.map((r) => MI.COLUMNS.map((c) => cell(r, c))));
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    for (let i = 1; i < aoa.length; i++) { const a = ws['A' + (i + 1)]; if (a && a.t === 'd') a.z = 'dd-mm-yyyy'; }
    ws['!cols'] = MI.COLUMNS.map((c) => ({ wch: c.key === 'itemName' ? 50 : c.type === 'text' ? 18 : 14 }));
    const vs = XLSX.utils.aoa_to_sheet([['Row', 'File', 'Meesho Order ID', 'Status', 'Notes']].concat(rows.map((r, i) => [i + 2, r._file, r.orderId, r._status, r._msgs.join('; ')])));
    vs['!cols'] = [{ wch: 6 }, { wch: 22 }, { wch: 22 }, { wch: 10 }, { wch: 90 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Tally Import');
    XLSX.utils.book_append_sheet(wb, vs, 'Validation');
    const d = new Date(), name = 'Meesho_Tally_' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.xlsx';
    XLSX.writeFile(wb, name, { cellDates: true });
    return rows.length;
  }

  function showLibError() {
    const miss = [!window.pdfjsLib && 'PDF.js', !window.XLSX && 'SheetJS'].filter(Boolean);
    if (!miss.length) return;
    const b = $('libError'); b.hidden = false;
    b.textContent = miss.join(' and ') + ' failed to load from cdnjs.cloudflare.com. Check your internet connection or download the libraries and edit the <script> tags in index.html.';
  }

  /* ---------- wiring ---------- */
  function init() {
    showLibError();
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    $('btnFiles').onclick = () => $('inFiles').click();
    $('btnFolder').onclick = () => $('inFolder').click();
    $('inFiles').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    $('inFolder').onchange = (e) => { addFiles(e.target.files); e.target.value = ''; };
    const drop = $('drop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', async (e) => {
      const entries = [...e.dataTransfer.items].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean); // must read synchronously
      const plain = [...e.dataTransfer.files];
      setStatus('Reading dropped items…');
      const out = [];
      try { if (entries.length) for (const en of entries) await readEntry(en, out); else out.push(...plain); } catch (err) { out.push(...plain); }
      addFiles(out);
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());
    $('btnProcess').onclick = () => processAll([...files.values()].filter((f) => f.status === 'pending'));
    $('btnRetry').onclick = () => { const l = [...files.values()].filter((f) => f.status === 'failed'); l.forEach((f) => (f.status = 'pending')); processAll(l); };
    $('btnStop').onclick = () => { stop = true; setStatus('Stopping after current files…'); };
    $('btnClear').onclick = () => { if (confirm('Remove all files and extracted rows?')) { files.clear(); records = []; $('bar').value = 0; setStatus('Cleared'); refresh(true); } };
    $('fileFilter').onchange = renderFiles;
    $('search').oninput = renderAll; $('statusFilter').onchange = renderAll;
    $('prev').onclick = () => { page = Math.max(0, page - 1); renderTable(); };
    $('next').onclick = () => { page++; renderTable(); };
    $('dataTable').tBodies[0].addEventListener('change', onEdit);
    $('fileTable').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.rm) { files.delete(b.dataset.rm); records = records.filter((r) => r._key !== b.dataset.rm); refresh(true); }
      if (b.dataset.raw) { $('dlgText').textContent = files.get(b.dataset.raw).rawText; $('dlg').showModal(); }
    });
    $('dlgClose').onclick = () => $('dlg').close();
    $('btnExport').onclick = () => {
      try { const n = exportToExcel(records); setStatus('Exported ' + n + ' rows'); }
      catch (e) { setStatus('Export failed'); alert('Excel export failed: ' + e.message); }
    };
    refresh(true);
  }
  window.MI.exportToExcel = exportToExcel;
  document.addEventListener('DOMContentLoaded', init);
})();
