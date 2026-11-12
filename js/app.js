
/* UI + Excel export. Extraction logic lives in extractor.js (no DOM there). */

(function () {
    'use strict';

    const MI = window.MI;
    const $ = (id) => document.getElementById(id);

    const CONCURRENCY = 3;
    const PAGE = 100;

    const files = new Map();

    let records = [];
    let stop = false;
    let running = false;
    let page = 0;
    let view = [];

    /* ---------- Helpers ---------- */

    const esc = (s) =>
        String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[c]));

    const fmtDate = (d) => (
        d instanceof Date && !isNaN(d)
            ? String(d.getDate()).padStart(2, '0') +
              '-' +
              String(d.getMonth() + 1).padStart(2, '0') +
              '-' +
              d.getFullYear()
            : ''
    );

    function parseDate(s) {
        const m = String(s).trim().match(
            /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/
        );

        if (!m) return undefined;

        const d = new Date(
            +m[3],
            +m[2] - 1,
            +m[1],
            12
        );

        return (
            d.getDate() === +m[1] &&
            d.getMonth() === +m[2] - 1 &&
            d.getFullYear() === +m[3]
        ) ? d : undefined;
    }

    const show = (v, t) => (
        t === 'date'
            ? fmtDate(v)
            : v == null
                ? ''
                : v
    );

    function setStatus(t) {
        const el = $('status');
        if (el) el.textContent = t;
    }

    /* ---------- Valid + Invalid Excel Download ---------- */

    function downloadValidInvalidExcel() {

        if (!window.XLSX) {
            throw new Error('XLSX library not loaded');
        }

        if (!MI.COLUMNS || !MI.INVALID_COLUMNS) {
            throw new Error(
                'MI.COLUMNS or MI.INVALID_COLUMNS is missing in schema.js'
            );
        }

        const validRows = records.filter(
            r => r._status === 'Valid'
        );

        const invalidRows = records.filter(
            r => r._status !== 'Valid'
        );

        const wb = XLSX.utils.book_new();

        // Convert records according to supplied schema
        function createSheet(columns, rows) {

            const data = [
                columns.map(c => c.label),

                ...rows.map(r =>
                    columns.map(c => {

                        let v = r[c.key];

                        if (c.key === '_msgs') {
                            return Array.isArray(v)
                                ? v.join('; ')
                                : (v || '');
                        }

                        if (c.type === 'date') {
                            return (
                                v instanceof Date && !isNaN(v)
                                    ? v
                                    : ''
                            );
                        }

                        if (c.type === 'num') {
                            return (
                                typeof v === 'number' && isFinite(v)
                                    ? v
                                    : ''
                            );
                        }

                        return v == null ? '' : v;
                    })
                )
            ];

            const ws = XLSX.utils.aoa_to_sheet(data);

            ws['!cols'] = columns.map(c => ({
                wch:
                    c.key === 'itemName' ? 45 :
                    c.key === '_msgs' ? 65 :
                    c.key === '_file' ? 30 :
                    18
            }));

            // Date formatting
            columns.forEach((c, i) => {

                if (c.type !== 'date') return;

                const col = XLSX.utils.encode_col(i);

                for (let row = 2; row <= data.length; row++) {

                    const cell = ws[col + row];

                    if (cell && cell.t === 'd') {
                        cell.z = 'dd-mm-yyyy';
                    }
                }
            });

            return ws;
        }

        // Valid Data sheet
        const validSheet = createSheet(
            MI.COLUMNS,
            validRows
        );

        XLSX.utils.book_append_sheet(
            wb,
            validSheet,
            'Valid Data'
        );

        // Failed PDF information
        const invalidFileRows = [...files.values()]
            .filter(f =>
                f.status === 'failed' &&
                !records.some(r => r._key === f.key)
            )
            .map(f => ({
                _file: f.file.name,
                _status: 'Processing Failed',
                _msgs: [
                    f.stage || '',
                    f.msg || 'PDF processing failed'
                ].filter(Boolean)
            }));

        const allInvalidRows = [
            ...invalidRows,
            ...invalidFileRows
        ];

        // Invalid Data sheet
        const invalidSheet = createSheet(
            MI.INVALID_COLUMNS,
            allInvalidRows
        );

        XLSX.utils.book_append_sheet(
            wb,
            invalidSheet,
            'Invalid Data'
        );

        XLSX.writeFile(
            wb,
            'Meesho_Valid_Invalid_Data.xlsx',
            { cellDates: true }
        );

        setStatus(
            'Exported ' +
            validRows.length +
            ' valid and ' +
            allInvalidRows.length +
            ' invalid records.'
        );
    }

    /* ---------- Adding Files ---------- */

    function addFiles(list) {

        let added = 0;

        for (const f of list) {

            if (
                !/\.pdf$/i.test(f.name) &&
                f.type !== 'application/pdf'
            ) {
                continue;
            }

            const key =
                f.name + '|' +
                f.size + '|' +
                f.lastModified;

            if (files.has(key)) continue;

            files.set(key, {
                file: f,
                key,
                status: 'pending',
                msg: '',
                rows: 0,
                rawText: ''
            });

            added++;
        }

        setStatus(added + ' file(s) added');

        refresh(true);
    }

    async function readEntry(en, out) {

        if (en.isFile) {

            await new Promise((res, rej) => {
                en.file(res, rej);
            });

        } else if (en.isDirectory) {

            const rd = en.createReader();

            let batch;

            do {

                batch = await new Promise((res, rej) => {
                    rd.readEntries(res, rej);
                });

                for (const c of batch) {
                    await readEntry(c, out);
                }

            } while (batch.length);
        }
    }

    /* ---------- Processing ---------- */

    async function processOne(entry) {

        entry.status = 'processing';
        entry.stage = 'Starting';
        entry.msg = '';
        entry.rawText = entry.rawText || '';
        entry.errorDetails = '';

        try {

            // STEP 1: Read PDF
            entry.stage = 'Reading PDF';

            const buf = await entry.file.arrayBuffer();

            // STEP 2: Extract invoice
            entry.stage = 'Extracting invoice';

            const inv = await MI.extractMeeshoInvoice(
                buf,
                window.pdfjsLib
            );

            // Preserve raw PDF text
            entry.rawText = inv?.rawText || '';

            // STEP 3: Normalize invoice
            entry.stage = 'Normalizing invoice';

            let recs = MI.normalizeMeeshoInvoice(
                inv,
                entry.file.name
            );

            if (!Array.isArray(recs)) {
                throw new Error(
                    'Normalization did not return an array'
                );
            }

            // STEP 4: Preserve extracted rows
            recs = recs.map((r, n) => {

                r._id = entry.key + '#' + n;
                r._key = entry.key;
                r._file = entry.file.name;

                return r;
            });

            // Keep extracted rows even if validation fails
            records = records.filter(
                r => r._key !== entry.key
            ).concat(recs);

            entry.rows = recs.length;

            if (!recs.length) {
                throw new Error(
                    'No product rows found in extracted invoice'
                );
            }

            // STEP 5: Validate records
            entry.stage = 'Validating records';

            recs.forEach(r => {

                MI.validateRecord(r);

                // Preserve Return status after validation
                if (r.transactionType === 'Return') {

                    r._status = 'Return';

                    r._msgs = Array.isArray(r._msgs)
                        ? r._msgs
                        : [];

                    if (
                        !r._msgs.includes(
                            'Credit Note / Product Return'
                        )
                    ) {
                        r._msgs.push(
                            'Credit Note / Product Return'
                        );
                    }
                }
            });

            entry.status = 'ok';
            entry.stage = 'Completed';
            entry.msg = '';

        } catch (e) {

            entry.status = 'failed';
            entry.msg = e.message || String(e);
            entry.errorDetails = e.stack || '';

            console.error(
                'PDF processing failed:',
                entry.file.name,
                e
            );
        }
    }

    /* ---------- Process All PDFs ---------- */

    async function processAll(list) {

        if (running || !list.length) {

            if (!list.length) {
                setStatus('No pending PDF files to process');
            }

            return;
        }

        if (!window.pdfjsLib) {
            showLibError();
            return;
        }

        running = true;
        stop = false;

        setBusy(true);

        let idx = 0;
        let doneCount = 0;

        $('bar').max = list.length;
        $('bar').value = 0;

        const worker = async () => {

            while (!stop) {

                const i = idx++;

                if (i >= list.length) break;

                try {

                    await processOne(list[i]);

                } catch (e) {

                    list[i].status = 'failed';
                    list[i].msg = e.message || String(e);

                    console.error(
                        'Processing error:',
                        e
                    );
                }

                doneCount++;

                $('bar').value = doneCount;

                refresh(false);

                setStatus(
                    'Processing ' +
                    doneCount +
                    ' / ' +
                    list.length
                );

                await new Promise(resolve =>
                    setTimeout(resolve, 0)
                );
            }
        };

        try {

            await Promise.all(
                Array.from(
                    {
                        length: Math.min(
                            CONCURRENCY,
                            list.length
                        )
                    },
                    worker
                )
            );

        } catch (e) {

            console.error(
                'Process All Error:',
                e
            );

            setStatus(
                'Processing failed: ' + e.message
            );

        } finally {

            running = false;

            setBusy(false);

            list.forEach(e => {

                if (e.status === 'processing') {
                    e.status = 'pending';
                }
            });

            setStatus(
                stop ? 'Stopped' : 'Finished'
            );

            refresh(true);
        }
    }

    /* ---------- Busy State ---------- */

    function setBusy(b) {

        $('btnProcess').disabled = b;
        $('btnStop').disabled = !b;
        $('btnClear').disabled = b;
        $('btnRetry').disabled = b;
        $('btnFiles').disabled = b;
        $('btnFolder').disabled = b;
    }

    /* ---------- Rendering ---------- */

    let timer = null;

    function refresh(now) {

        if (now) {

            clearTimeout(timer);
            timer = null;

            draw();

        } else if (!timer) {

            timer = setTimeout(() => {

                timer = null;
                draw();

            }, 400);
        }
    }

    function draw() {

        renderSummary();
        renderFiles();
        renderTable();
    }

    function renderSummary() {

        const all = [...files.values()];

        $('sTotal').textContent = all.length;

        $('sDone').textContent = all.filter(
            f => f.status === 'ok'
        ).length;

        $('sFail').textContent = all.filter(
            f => f.status === 'failed'
        ).length;

        $('sRows').textContent = records.length;

        $('sWarn').textContent = records.filter(
            r => r._status === 'Warning'
        ).length;

        $('sErr').textContent = records.filter(
            r => r._status === 'Error'
        ).length;

        const pending = all.filter(
            f => f.status === 'pending'
        ).length;

        if (!running) {

            $('btnProcess').disabled = !pending;

            $('btnRetry').disabled = !all.some(
                f => f.status === 'failed'
            );

            $('btnClear').disabled = !all.length;
        }

        $('btnExport').disabled = !records.length;

        const downloadBtn = $('downloadAllBtn');

        if (downloadBtn) {
            downloadBtn.disabled = !records.length &&
                !all.some(f => f.status === 'failed');
        }
    }

    function renderFiles() {

        const flt = $('fileFilter').value;

        const all = [...files.values()].filter(
            f => flt === 'all' || f.status === flt
        );

        $('fileCount').textContent =
            '(' + files.size + ')';

        $('fileTable').tBodies[0].innerHTML =

            all.slice(0, 300).map(f =>

                '<tr>' +

                '<td>' +
                esc(f.file.name) +
                '</td>' +

                '<td><span class="' +
                (
                    f.status === 'ok'
                        ? 'ok'
                        : f.status === 'failed'
                            ? 'failed'
                            : ''
                ) +
                '">' +
                esc(f.status) +
                '</span></td>' +

                '<td>' +
                f.rows +
                '</td>' +

                '<td class="note"><strong>' +
                esc(f.stage || '') +
                '</strong><br>' +
                esc(f.msg || '') +
                '</td>' +

                '<td>' +

                (
                    f.rawText
                        ? '<button class="btn" data-raw="' +
                          esc(f.key) +
                          '">Text</button> '
                        : ''
                ) +

                (
                    running
                        ? ''
                        : '<button class="btn" data-rm="' +
                          esc(f.key) +
                          '">Remove</button>'
                ) +

                '</td>' +

                '</tr>'

            ).join('') +

            (
                all.length > 300
                    ? '<tr><td colspan="5">… and ' +
                      (all.length - 300) +
                      ' more (use the filter)</td></tr>'
                    : ''
            );
    }

    function getView() {

        const q = $('search').value.trim().toLowerCase();
        const st = $('statusFilter').value;

        return records.filter(r => {

            // Status filter
            let statusMatch = true;

            if (st === 'Error') {
                statusMatch = r._status === 'Error';
            } else if (st === 'Warning') {
                statusMatch = r._status === 'Warning';
            } else if (st === 'Valid') {
                statusMatch = r._status === 'Valid';
            } else if (st === 'Return') {
                statusMatch = r._status === 'Return';
            }

            // Search filter
            const searchMatch =
                !q ||

                MI.COLUMNS.some(c =>
                    String(show(r[c.key], c.type))
                        .toLowerCase()
                        .includes(q)
                ) ||

                String(r._file || '')
                    .toLowerCase()
                    .includes(q) ||

                String(r.orderId || '')
                    .toLowerCase()
                    .includes(q) ||

                String(r.sku || '')
                    .toLowerCase()
                    .includes(q);

            return statusMatch && searchMatch;
        });
    }

    function renderTable() {

        const t = $('dataTable');

        if (!t.tHead.rows.length) {

            t.tHead.innerHTML =
                '<tr><th>Status</th>' +

                MI.COLUMNS.map(c =>
                    '<th>' + esc(c.label) + '</th>'
                ).join('') +

                '<th>Review notes</th>' +
                '<th>File</th>' +
                '</tr>';
        }

        view = getView();

        const pages = Math.max(
            1,
            Math.ceil(view.length / PAGE)
        );

        page = Math.min(page, pages - 1);

        $('pageInfo').textContent =
            (page + 1) +
            ' / ' +
            pages +
            ' (' +
            view.length +
            ' rows)';

        t.tBodies[0].innerHTML =

            view.slice(
                page * PAGE,
                (page + 1) * PAGE
            ).map(r =>

                '<tr data-id="' +
                esc(r._id) +
                '">' +

                '<td class="st">' +
                statusCell(r) +
                '</td>' +

                MI.COLUMNS.map(c =>

                    '<td class="' +
                    (c.key === 'itemName' ? 'name' : '') +
                    '">' +

                    '<input data-k="' +
                    esc(c.key) +
                    '" value="' +
                    esc(show(r[c.key], c.type)) +
                    '">' +

                    '</td>'

                ).join('') +

                '<td class="note">' +
                esc(
                    Array.isArray(r._msgs)
                        ? r._msgs.join('; ')
                        : ''
                ) +
                '</td>' +

                '<td>' +
                esc(r._file) +
                '</td>' +

                '</tr>'

            ).join('');
    }

    function statusCell(r) {

        return (
            '<span class="b ' +
            esc(r._status || '') +
            '">' +
            esc(r._status || '') +
            '</span>'
        );
    }

    function renderAll() {

        page = 0;
        renderTable();
    }

    /* ---------- Editing ---------- */

    function onEdit(e) {

        const inp = e.target;

        if (!inp.dataset || !inp.dataset.k) return;

        const tr = inp.closest('tr');

        if (!tr) return;

        const r = records.find(
            x => x._id === tr.dataset.id
        );

        if (!r) return;

        const col = MI.COLUMNS.find(
            c => c.key === inp.dataset.k
        );

        if (!col) return;

        const v = inp.value.trim();

        if (col.type === 'num') {

            r[col.key] =
                v === ''
                    ? null
                    : (
                        isFinite(Number(v.replace(/,/g, '')))
                            ? Number(v.replace(/,/g, ''))
                            : NaN
                    );

        } else if (col.type === 'date') {

            const d = v === ''
                ? null
                : parseDate(v);

            r[col.key] =
                d === undefined
                    ? new Date(NaN)
                    : d;

        } else {

            r[col.key] = v;
        }

        MI.validateRecord(r);

        // Preserve Return status
        if (r.transactionType === 'Return') {
            r._status = 'Return';
        }

        tr.querySelector('.st').innerHTML =
            statusCell(r);

        tr.querySelector('.note').textContent =
            Array.isArray(r._msgs)
                ? r._msgs.join('; ')
                : '';

        renderSummary();
    }

    /* ---------- Old Excel Export ---------- */

    function exportToExcel(recs) {

        if (!window.XLSX) {
            throw new Error(
                'SheetJS (XLSX) did not load. Check your internet connection / CDN access.'
            );
        }

        const rows = recs;

        const cell = (r, c) => {

            const v = r[c.key];

            if (c.type === 'date') {
                return (
                    v instanceof Date && !isNaN(v)
                        ? v
                        : ''
                );
            }

            if (c.type === 'num') {
                return (
                    typeof v === 'number' && isFinite(v)
                        ? v
                        : ''
                );
            }

            return v == null ? '' : v;
        };

        const aoa = [
            MI.COLUMNS.map(c => c.label)
        ].concat(
            rows.map(r =>
                MI.COLUMNS.map(c => cell(r, c))
            )
        );

        const ws = XLSX.utils.aoa_to_sheet(
            aoa,
            { cellDates: true }
        );

        for (let i = 1; i < aoa.length; i++) {

            const a = ws['A' + (i + 1)];

            if (a && a.t === 'd') {
                a.z = 'dd-mm-yyyy';
            }
        }

        ws['!cols'] = MI.COLUMNS.map(c => ({
            wch:
                c.key === 'itemName' ? 50 :
                c.type === 'text' ? 18 :
                14
        }));

        const vs = XLSX.utils.aoa_to_sheet([

            [
                'Row',
                'File',
                'Meesho Order ID',
                'Status',
                'Notes'
            ],

            ...rows.map((r, i) => [

                i + 2,
                r._file,
                r.orderId,
                r._status,

                Array.isArray(r._msgs)
                    ? r._msgs.join('; ')
                    : ''
            ])
        ]);

        vs['!cols'] = [
            { wch: 6 },
            { wch: 22 },
            { wch: 22 },
            { wch: 10 },
            { wch: 90 }
        ];

        const wb = XLSX.utils.book_new();

        XLSX.utils.book_append_sheet(
            wb,
            ws,
            'Tally Import'
        );

        XLSX.utils.book_append_sheet(
            wb,
            vs,
            'Validation'
        );

        const d = new Date();

        const name =
            'Meesho_Tally_' +
            d.getFullYear() +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getDate()).padStart(2, '0') +
            '_' +
            String(d.getHours()).padStart(2, '0') +
            String(d.getMinutes()).padStart(2, '0') +
            '.xlsx';

        // FAILED FILES SHEET
        const failedFiles = [...files.values()]
            .filter(f => f.status === 'failed');

        const failedSheetData = [

            [
                'File Name',
                'Processing Stage',
                'Error Reason',
                'Extracted Rows',
                'Raw PDF Text'
            ],

            ...failedFiles.map(f => [

                f.file.name,
                f.stage || '',
                f.msg || '',
                f.rows || 0,
                f.rawText || ''
            ])
        ];

        const fs = XLSX.utils.aoa_to_sheet(
            failedSheetData
        );

        fs['!cols'] = [
            { wch: 30 },
            { wch: 25 },
            { wch: 60 },
            { wch: 15 },
            { wch: 100 }
        ];

        XLSX.utils.book_append_sheet(
            wb,
            fs,
            'Failed Files'
        );

        XLSX.writeFile(
            wb,
            name,
            { cellDates: true }
        );

        return rows.length;
    }

    /* ---------- Library Error ---------- */

    function showLibError() {

        const miss = [
            !window.pdfjsLib && 'PDF.js',
            !window.XLSX && 'SheetJS'
        ].filter(Boolean);

        if (!miss.length) return;

        const b = $('libError');

        if (!b) {
            console.error(
                miss.join(' and ') +
                ' failed to load.'
            );
            return;
        }

        b.hidden = false;

        b.textContent =
            miss.join(' and ') +
            ' failed to load from cdnjs.cloudflare.com. ' +
            'Check your internet connection or download the libraries and edit the script tags in index.html.';
    }

    /* ---------- Wiring ---------- */

    function init() {

        if (!MI) {
            console.error(
                'MI is undefined. Check that schema.js and extractor.js load before app.js.'
            );
            return;
        }

        showLibError();

        if (window.pdfjsLib) {

            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
                'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        $('btnFiles').onclick = () =>
            $('inFiles').click();

        $('btnFolder').onclick = () =>
            $('inFolder').click();

        $('inFiles').onchange = (e) => {

            addFiles(e.target.files);
            e.target.value = '';
        };

        $('inFolder').onchange = (e) => {

            addFiles(e.target.files);
            e.target.value = '';
        };

        const drop = $('drop');

        ['dragenter', 'dragover'].forEach(ev => {

            drop.addEventListener(ev, (e) => {

                e.preventDefault();
                drop.classList.add('over');
            });
        });

        ['dragleave', 'drop'].forEach(ev => {

            drop.addEventListener(ev, (e) => {

                e.preventDefault();
                drop.classList.remove('over');
            });
        });

        drop.addEventListener('drop', async (e) => {

            const entries = [...e.dataTransfer.items]
                .map(i =>
                    i.webkitGetAsEntry
                        ? i.webkitGetAsEntry()
                        : null
                )
                .filter(Boolean);

            const plain = [...e.dataTransfer.files];

            setStatus('Reading dropped items…');

            const out = [];

            try {

                if (entries.length) {

                    for (const en of entries) {
                        await readEntry(en, out);
                    }

                } else {

                    out.push(...plain);
                }

            } catch (err) {

                console.error(
                    'Folder reading error:',
                    err
                );

                out.push(...plain);
            }

            addFiles(out);
        });

        window.addEventListener(
            'dragover',
            e => e.preventDefault()
        );

        window.addEventListener(
            'drop',
            e => e.preventDefault()
        );

        // Process PDFs
        $('btnProcess').onclick = () => {

            processAll(
                [...files.values()].filter(
                    f => f.status === 'pending'
                )
            );
        };

        // Retry failed PDFs
        $('btnRetry').onclick = () => {

            const l = [...files.values()].filter(
                f => f.status === 'failed'
            );

            l.forEach(f => {
                f.status = 'pending';
            });

            processAll(l);
        };

        // Stop processing
        $('btnStop').onclick = () => {

            stop = true;

            setStatus(
                'Stopping after current files…'
            );
        };

        // Clear all
        $('btnClear').onclick = () => {

            if (
                confirm(
                    'Remove all files and extracted rows?'
                )
            ) {

                files.clear();
                records = [];

                $('bar').value = 0;

                setStatus('Cleared');

                refresh(true);
            }
        };

        $('fileFilter').onchange = renderFiles;

        $('search').oninput = renderAll;

        $('statusFilter').onchange = renderAll;

        $('prev').onclick = () => {

            page = Math.max(0, page - 1);

            renderTable();
        };

        $('next').onclick = () => {

            page++;

            renderTable();
        };

        $('dataTable')
            .tBodies[0]
            .addEventListener('change', onEdit);

        $('fileTable').addEventListener('click', (e) => {

            const b = e.target.closest('button');

            if (!b) return;

            if (b.dataset.rm) {

                files.delete(b.dataset.rm);

                records = records.filter(
                    r => r._key !== b.dataset.rm
                );

                refresh(true);
            }

            if (b.dataset.raw) {

                const f = files.get(b.dataset.raw);

                if (f) {

                    $('dlgText').textContent =
                        f.rawText || '';

                    $('dlg').showModal();
                }
            }
        });

        $('dlgClose').onclick = () =>
            $('dlg').close();

        /*--------- Valid + Invalid Excel Download -----*/

        const downloadBtn = $('downloadAllBtn');

        if (downloadBtn) {

            downloadBtn.onclick = () => {

                try {

                    downloadValidInvalidExcel();

                } catch (e) {

                    console.error(
                        'Excel export error:',
                        e
                    );

                    alert(
                        'Excel export failed: ' + e.message
                    );
                }
            };
        }

        /*--------- Old Excel Export -----*/

        // $('btnExport').onclick = () => {

        //     try {

        //         const n = exportToExcel(records);

        //         setStatus(
        //             'Exported ' + n + ' rows'
        //         );

        //     } catch (e) {

        //         setStatus('Export failed');

        //         alert(
        //             'Excel export failed: ' + e.message
        //         );
        //     }
        // };

        // Initial rendering
        refresh(true);
    }

    // Expose old export function
    window.MI.exportToExcel = exportToExcel;

    // Initialize app
    document.addEventListener(
        'DOMContentLoaded',
        init
    );

})();
