/* Meesho extraction engine. No DOM access. Works with PDF.js text items {str,x,y(top-down),w,h}. */
(function (root) {
  'use strict';
  const MI = (root.MI = root.MI || {});

  /* ---------- generic helpers ---------- */
  const normalizePDFText = (t) => String(t == null ? '' : t).replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/\s+/g, ' ').trim();
  function parseMoney(s) {
    if (s == null) return null;
    const m = String(s).replace(/Rs\.?|₹|INR/gi, '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  }
  const isMoney = (s) => /^(?:Rs\.?|₹)?\s*-?[\d,]+(?:\.\d+)?$/i.test(normalizePDFText(s)) && /\d/.test(s);
  const round2 = (n) => Math.round(n * 100) / 100;

  /* ---------- states / GSTIN / address ---------- */
  const STATES = { 'Jammu and Kashmir': '01', 'Himachal Pradesh': '02', 'Punjab': '03', 'Chandigarh': '04', 'Uttarakhand': '05', 'Haryana': '06', 'Delhi': '07', 'Rajasthan': '08', 'Uttar Pradesh': '09', 'Bihar': '10', 'Sikkim': '11', 'Arunachal Pradesh': '12', 'Nagaland': '13', 'Manipur': '14', 'Mizoram': '15', 'Tripura': '16', 'Meghalaya': '17', 'Assam': '18', 'West Bengal': '19', 'Jharkhand': '20', 'Odisha': '21', 'Chhattisgarh': '22', 'Madhya Pradesh': '23', 'Gujarat': '24', 'Dadra and Nagar Haveli and Daman and Diu': '26', 'Maharashtra': '27', 'Karnataka': '29', 'Goa': '30', 'Lakshadweep': '31', 'Kerala': '32', 'Tamil Nadu': '33', 'Puducherry': '34', 'Andaman and Nicobar Islands': '35', 'Telangana': '36', 'Andhra Pradesh': '37', 'Ladakh': '38' };
  const ALIASES = { 'jammu & kashmir': 'Jammu and Kashmir', 'uttrakhand': 'Uttarakhand', 'uttaranchal': 'Uttarakhand', 'orissa': 'Odisha', 'pondicherry': 'Puducherry', 'nct of delhi': 'Delhi', 'new delhi': 'Delhi', 'chhatisgarh': 'Chhattisgarh', 'telengana': 'Telangana', 'andaman & nicobar islands': 'Andaman and Nicobar Islands', 'dadra & nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu', 'daman & diu': 'Dadra and Nagar Haveli and Daman and Diu', 'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu', 'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu' };
  const stateNorm = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/\s+/g, ' ');
  const STATE_PATTERNS = Object.keys(STATES).map((n) => [stateNorm(n), n]).concat(Object.keys(ALIASES).map((a) => [stateNorm(a), ALIASES[a]]));
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /* Last state name in the address wins (state precedes PIN at the end of Indian addresses). */
  function extractState(text) {
    const t = stateNorm(normalizePDFText(text));
    let best = null;
    for (const [p, canon] of STATE_PATTERNS) {
      const re = new RegExp('(?<![a-z])' + escRe(p) + '(?![a-z])', 'g');
      let m;
      while ((m = re.exec(t))) {
        const end = m.index + p.length;
        if (!best || end > best.end || (end === best.end && p.length > best.len)) best = { end, len: p.length, name: canon };
      }
    }
    return best ? best.name : '';
  }
  function extractPostalCode(text) {
    const all = normalizePDFText(text).match(/(?<!\d)[1-9]\d{2}\s?\d{3}(?!\d)/g);
    return all ? all[all.length - 1].replace(/\s/g, '') : '';
  }
  function extractCountry(text, state, pin) {
    if (/\bIndia\b/i.test(text)) return 'India';
    return state && /^\d{6}$/.test(pin || '') ? 'India' : ''; // confirmed by Indian state + 6-digit PIN
  }
  const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g;
  function gstinChecksumOk(g) {
    const cs = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      let p = cs.indexOf(g[i]) * (i % 2 ? 2 : 1);
      sum += Math.floor(p / 36) + (p % 36);
    }
    return cs[(36 - (sum % 36)) % 36] === g[14];
  }
  function validateGSTIN(g) {
    g = String(g || '').toUpperCase().trim();
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return { valid: false, reason: 'format' };
    const code = Number(g.slice(0, 2));
    if (code < 1 || code > 38) return { valid: false, reason: 'state code' };
    return gstinChecksumOk(g) ? { valid: true } : { valid: false, reason: 'checksum' };
  }
  const findGSTINs = (t) => (String(t || '').toUpperCase().match(GSTIN_RE) || []);

  /* Sections are cut from the text stream (PDF.js content order keeps each address block together). */
  function sliceSection(text, startRe, endRes) {
    const m = text.match(startRe);
    if (!m) return '';
    const from = m.index + m[0].length;
    let to = text.length;
    for (const re of endRes) { const i = text.slice(from).search(re); if (i >= 0) to = Math.min(to, from + i); }
    return normalizePDFText(text.slice(from, to));
  }
  function extractShippingAddress(text) { return sliceSection(text, /SHIP\s*TO\s*:?/i, [/Order\s*Date/i, /Invoice\s*Date/i, /\bSN\.?\s+Description/i]); }
  function extractBillingAddress(text) { return sliceSection(text, /BILL\s*TO\s*:?/i, [/Place\s*of\s*Supply/i, /Tax\s*Invoice/i, /SHIP\s*TO/i]); }
  function extractSellerSection(text) { return sliceSection(text, /Sold\s*by\s*:?/i, [/Tax\s*is\s*not\s*payable/i, /This\s*is\s*a\s*computer/i]); }
  function extractSellerGSTIN(text) {
    const sec = findGSTINs(extractSellerSection(text));
    if (sec.length) return sec[0];
    const cust = new Set(findGSTINs(extractShippingAddress(text) + ' ' + extractBillingAddress(text)));
    return findGSTINs(text).find((g) => !cust.has(g)) || '';
  }
  /* Customer GSTIN only from Bill-To / Ship-To sections (or an explicit buyer/customer label), never the seller's. */
  function extractCustomerGSTIN(text) {
    const seller = extractSellerGSTIN(text);
    const pool = findGSTINs(extractShippingAddress(text) + ' ' + extractBillingAddress(text));
    const labelled = (text.match(/(?:Buyer|Customer|Recipient)\s*GSTIN(?:\/UIN)?\s*:?\s*([0-9A-Z]{15})/i) || [])[1];
    if (labelled) pool.unshift(labelled.toUpperCase());
    return pool.find((g) => g !== seller) || '';
  }
  function extractPlaceOfSupply(text) {
    const m = text.match(/Place\s*of\s*Supply\s*:?\s*(\d{2})\s+([A-Za-z &]+?)(?=\s+Tax\s*Invoice|\s+Original|\s+Order|$)/i);
    return m ? { code: m[1], name: extractState(m[2]) } : { code: '', name: '' };
  }

  /* ---------- order header ---------- */
  function extractOrderNumber(text) {
    const m = text.match(/Order\s*(?:Number|No\.?|ID)\s*:?\s*([A-Za-z0-9_\-]{8,})/i);
    if (m) return m[1];
    const f = text.match(/(?<!\d)\d{15,20}(?!\d)/);
    return f ? f[0] : '';
  }
  function extractOrderDate(text) {
    const m = text.match(/Order\s*Date\s*:?\s*(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/i);
    if (!m) return null;
    const d = +m[1], mo = +m[2], y = +m[3];
    const dt = new Date(y, mo - 1, d, 12, 0, 0); // local noon avoids timezone day-shift in Excel
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
  }
  function findInvoiceHeader(text) { return /Tax\s*Invoice/i.test(text) && /Order\s*(Number|No|ID)/i.test(text); }

  /* ---------- PDF.js reading ---------- */
  async function loadPDFDocument(buf, pdfjsLib) {
    try {
      return await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw new Error('Password-protected PDF');
      if (e && e.name === 'InvalidPDFException') throw new Error('Invalid or corrupted PDF');
      throw new Error('Cannot open PDF: ' + (e && e.message ? e.message : e));
    }
  }
  async function extractTextWithCoordinates(page) {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((i) => i.str !== undefined && normalizePDFText(i.str))
      .map((i) => ({ str: normalizePDFText(i.str), x: i.transform[4], y: vp.height - i.transform[5], w: i.width || 0, h: i.height || Math.abs(i.transform[3]) || 9 }));
    return { items, width: vp.width, height: vp.height };
  }
  async function extractPDFText(pdf) {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      pages.push(await extractTextWithCoordinates(page));
      page.cleanup();
    }
    return pages;
  }
  function groupTextLines(items, tol) {
    tol = tol || 3;
    const s = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of s) {
      const L = lines[lines.length - 1];
      if (L && Math.abs(it.y - L.y) <= tol) L.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.forEach((L) => {
      L.items.sort((a, b) => a.x - b.x);
      L.text = normalizePDFText(L.items.map((i) => i.str).join(' '));
    });
    return lines;
  }
  const streamText = (pages) => normalizePDFText(pages.map((p) => p.items.map((i) => i.str).join(' ')).join(' '));

  /* ---------- product table ---------- */
  const COLS = {
    sn: ['sn', 'srno', 'slno', 'sno'], description: ['description', 'productname', 'itemdescription', 'particulars', 'item'],
    sku: ['sku', 'skuid', 'productsku', 'skucode'], hsn: ['hsn', 'hsncode', 'hsnsac'], qty: ['qty', 'quantity'],
    gross: ['grossamount', 'grossamt'], discount: ['discount'], taxable: ['taxablevalue', 'taxableamount'],
    taxes: ['taxes', 'tax', 'gst'], total: ['total', 'totalamount']
  };
  function identifyColumn(text) {
    const s = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!s) return null;
    for (const k in COLS) if (COLS[k].includes(s)) return k;
    return null;
  }
  function findTableHeader(page) {
    const its = page.items;
    for (const d of its.filter((i) => identifyColumn(i.str) === 'description')) {
      const first = its.filter((i) => Math.abs(i.y - d.y) <= 3).sort((a, b) => a.x - b.x);
      const merged = [];
      for (const it of first) { // merge split one-line headers e.g. "Product" "Name"
        const p = merged[merged.length - 1];
        if (p && it.x - (p.x + p.w) < 8 && !identifyColumn(p.str) && identifyColumn(p.str + ' ' + it.str)) p.str += ' ' + it.str; else merged.push({ ...it });
      }
      const second = its.filter((i) => i.y > d.y + 5 && i.y <= d.y + 16 && /^(amount|amt|value|total|price|code|no\.?|rate)$/i.test(i.str));
      const cols = [];
      let bottom = d.y;
      for (const f of merged) {
        const s = second.filter((i) => Math.abs(i.x - f.x) <= 15).sort((a, b) => Math.abs(a.x - f.x) - Math.abs(b.x - f.x))[0];
        const key = (s && identifyColumn(f.str + ' ' + s.str)) || identifyColumn(f.str);
        if (s) bottom = Math.max(bottom, s.y);
        if (key && !cols.some((c) => c.key === key)) cols.push({ key, x: f.x });
      }
      const k = cols.map((c) => c.key);
      if (k.includes('description') && cols.length >= 4 && (k.includes('gross') || k.includes('taxable') || k.includes('total'))) {
        return { cols: cols.sort((a, b) => a.x - b.x), bottom, y: d.y };
      }
    }
    return null;
  }
  const colFor = (hdr, x) => { let key = hdr.cols[0].key; for (const c of hdr.cols) if (c.x - 6 <= x) key = c.key; return key; };
  const getColumnValue = (cells, key) => normalizePDFText((cells[key] || []).map((i) => i.str).join(' '));

  function parseTaxes(text) {
    const out = { sgst: null, cgst: null, igst: null, cess: null };
    const re = /(UTGST|SGST|CGST|IGST|CESS)\s*@\s*[\d.]+\s*%?\s*:?\s*(?:Rs\.?|₹)?\s*(-?[\d,]+(?:\.\d+)?)/gi;
    let m;
    while ((m = re.exec(text))) {
      const k = m[1].toUpperCase() === 'UTGST' ? 'sgst' : m[1].toLowerCase();
      out[k] = round2((out[k] || 0) + parseMoney(m[2]));
    }
    return out;
  }
  function buildItem(cells) {
    const qtyRaw = getColumnValue(cells, 'qty');
    const tx = getColumnValue(cells, 'taxes');
    const desc = getColumnValue(cells, 'description');
    return {
      sn: getColumnValue(cells, 'sn'), description: desc, sku: getColumnValue(cells, 'sku'), hsn: getColumnValue(cells, 'hsn'),
      qtyRaw, qty: /^\d+(\.\d+)?$/.test(qtyRaw) ? Number(qtyRaw) : null,
      gross: parseMoney(getColumnValue(cells, 'gross')), discount: parseMoney(getColumnValue(cells, 'discount')),
      taxable: parseMoney(getColumnValue(cells, 'taxable')), taxText: tx, tax: parseTaxes(tx),
      rowTotal: parseMoney(getColumnValue(cells, 'total')), isCharge: /^other\s*charges?$/i.test(desc)
    };
  }
  /* Coordinate-based rows: a row starts at an SN cell; wrapped description lines belong to the row above them. */
  function extractProducts(pages) {
    let hdr = null, totals = null, headerFound = false;
    const items = [];
    for (const pg of pages) {
      hdr = findTableHeader(pg) || hdr;
      if (!hdr) continue;
      headerFound = true;
      const hasSN = hdr.cols.some((c) => c.key === 'sn');
      const lines = groupTextLines(pg.items.filter((i) => i.y > hdr.bottom + 1));
      let cur = null;
      const flush = () => { if (cur) items.push(buildItem(cur)); cur = null; };
      for (const L of lines) {
        const first = L.items[0];
        const keys = L.items.map((i) => colFor(hdr, i.x));
        if (/^terms/i.test(first.str)) { flush(); break; }
        if (/^total\b/i.test(first.str) && !keys.includes('hsn') && !keys.includes('qty')) {
          flush();
          totals = { totalTax: null, invoiceTotal: null };
          L.items.forEach((i) => { const k = colFor(hdr, i.x); if (k === 'taxes' && isMoney(i.str)) totals.totalTax = parseMoney(i.str); if (k === 'total' && isMoney(i.str)) totals.invoiceTotal = parseMoney(i.str); });
          break;
        }
        const start = hasSN
          ? L.items.some((i) => colFor(hdr, i.x) === 'sn' && /^\d{1,3}\.?$/.test(i.str))
          : L.items.some((i) => colFor(hdr, i.x) === 'hsn' && /^\d{4,8}$/.test(i.str)) || L.items.some((i) => colFor(hdr, i.x) === 'gross' && isMoney(i.str));
        if (start) { flush(); cur = {}; }
        if (!cur) continue;
        for (const i of L.items) (cur[colFor(hdr, i.x)] = cur[colFor(hdr, i.x)] || []).push(i);
      }
      flush();
    }
    return { items, totals, headerFound };
  }
  /* Fallback when no header is detected: pattern over the text stream. Results are flagged as fallback. */
  function extractProductsFallback(text) {
    const body = (text.match(/Taxes\s+Total\s+(.*?)\s+Total\s+(?:Rs|₹)/i) || [])[1] || '';
    const M = '(?:Rs\\.?|₹)\\s*([\\d,]+(?:\\.\\d+)?)';
    const re = new RegExp('(\\d{1,3})\\s+(.+?)\\s+(\\d{4,8})\\s+(\\d+|NA)\\s+' + M + '\\s+(?:(?:Rs\\.?|₹)\\s*)?([\\d,]+(?:\\.\\d+)?)\\s+' + M + '\\s+((?:(?:UTGST|SGST|CGST|IGST|CESS)\\s*@\\s*[\\d.]+\\s*%\\s*:?\\s*(?:Rs\\.?|₹)?\\s*[\\d,]+(?:\\.\\d+)?\\s*)+)' + M, 'g');
    const items = []; let m;
    while ((m = re.exec(body))) {
      const desc = normalizePDFText(m[2]);
      items.push({ sn: m[1], description: desc, sku: '', hsn: m[3], qtyRaw: m[4], qty: /^\d+$/.test(m[4]) ? +m[4] : null, gross: parseMoney(m[5]), discount: parseMoney(m[6]), taxable: parseMoney(m[7]), taxText: m[8], tax: parseTaxes(m[8]), rowTotal: parseMoney(m[9]), isCharge: /^other\s*charges?$/i.test(desc) });
    }
    return items;
  }
  function extractInvoiceTotals(parsedTotals, text) {
    if (parsedTotals && parsedTotals.invoiceTotal != null) return parsedTotals;
    const all = [...text.matchAll(/\bTotal\s+(?:Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)\s+(?:Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/gi)];
    const l = all[all.length - 1];
    return l ? { totalTax: parseMoney(l[1]), invoiceTotal: parseMoney(l[2]) } : { totalTax: null, invoiceTotal: null };
  }

  /* ---------- whole-invoice extraction ---------- */
  async function extractMeeshoInvoice(buf, pdfjsLib) {
    const pdf = await loadPDFDocument(buf, pdfjsLib);
    try {
      const pages = await extractPDFText(pdf);
      return parseInvoicePages(pages);
    } finally { try { await pdf.destroy(); } catch (e) { /* ignore */ } }
  }
  function parseInvoicePages(pages) {
    const text = streamText(pages);
    if (text.length < 30) throw new Error('No selectable text (scanned/image-only or empty PDF) - OCR is required; not processed');
    if (!findInvoiceHeader(text)) throw new Error('Not recognised as a Meesho tax invoice (no "Tax Invoice"/"Order Number")');
    const notes = [];
    const t = extractProducts(pages);
    let items = t.items, fallback = false;
    if (!items.length) {
      items = extractProductsFallback(text); fallback = items.length > 0;
      if (!items.length) throw new Error('Product table not detected');
      notes.push('Product table read by text-pattern fallback - verify against PDF');
    }
    const totals = extractInvoiceTotals(t.totals, text);
    const ship = extractShippingAddress(text), bill = extractBillingAddress(text);
    if (!ship) notes.push('Ship-To not found; billing address used for ship fields');
    const addr = ship || bill;
    const state = extractState(addr), pin = extractPostalCode(addr);
    const pos = extractPlaceOfSupply(text);
    if (state && pos.name && state !== pos.name) notes.push('Ship state (' + state + ') differs from Place of Supply (' + pos.name + ')');
    return {
      orderId: extractOrderNumber(text), orderDate: extractOrderDate(text), items, totals, fallback, notes,
      shipState: state, shipPin: pin, shipCountry: extractCountry(addr, state, pin),
      sellerGstin: extractSellerGSTIN(text), custGstin: extractCustomerGSTIN(text), rawText: text
    };
  }
  /* One Tally row per table line; invoice-level fields repeated. Missing tax types are 0 only when another tax was read. */
  function normalizeMeeshoInvoice(inv, fileName) {
    const sumRows = round2(inv.items.reduce((a, i) => a + (i.rowTotal || 0), 0));
    const invMsgs = inv.notes.slice();
    const tol = MI.CONFIG ? MI.CONFIG.tolerance : 0.06;
    if (inv.totals.invoiceTotal == null) invMsgs.push('Invoice total not found');
    else if (Math.abs(sumRows - inv.totals.invoiceTotal) > tol) invMsgs.push('Sum of line totals (' + sumRows + ') != invoice total (' + inv.totals.invoiceTotal + ')');
    return inv.items.filter((i) => !i.isCharge).map((i, n) => { // OTHER CHARGES lines are not exported (still counted in the total check above)
      const any = i.tax.sgst != null || i.tax.cgst != null || i.tax.igst != null;
      const z = (v) => (v != null ? v : any ? 0 : null);
      return {
        _id: fileName + '#' + n, _file: fileName, _isCharge: i.isCharge, _seller: inv.sellerGstin,
        _rowTotal: i.rowTotal, _invMsgs: invMsgs, _status: '', _msgs: [],
        purchaseDate: inv.orderDate, voucherNo: '', orderId: inv.orderId, partyName: '', salesLedger: '',
        itemName: i.description, sku: i.sku, qty: i.qty, rate: i.gross, per: 'Nos', amount: i.taxable,
        sgst: z(i.tax.sgst), cgst: z(i.tax.cgst), igst: z(i.tax.igst), totalBill: inv.totals.invoiceTotal,
        shipState: inv.shipState, shipPin: inv.shipPin, shipCountry: inv.shipCountry, custGstin: inv.custGstin
      };
    });
  }

  Object.assign(MI, { normalizePDFText, parseMoney, loadPDFDocument, extractPDFText, extractTextWithCoordinates, groupTextLines, findInvoiceHeader, extractOrderNumber, extractOrderDate, findTableHeader, identifyColumn, getColumnValue, extractProducts, extractInvoiceTotals, extractShippingAddress, extractBillingAddress, extractCustomerGSTIN, extractSellerGSTIN, extractPostalCode, extractState, extractCountry, validateGSTIN, extractMeeshoInvoice, parseInvoicePages, normalizeMeeshoInvoice });
})(typeof window !== 'undefined' ? window : globalThis);
