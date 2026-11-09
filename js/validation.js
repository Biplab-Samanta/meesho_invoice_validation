/* Record validation. Never alters or deletes values; only classifies Valid / Warning / Error. */
(function (root) {
  'use strict';
  const MI = (root.MI = root.MI || {});
  const finite = (v) => typeof v === 'number' && isFinite(v);
  MI.validateRecord = function validateRecord(r) {
    const E = [], W = [], cfg = MI.CONFIG, tol = cfg.tolerance;
    if (!r.orderId) E.push('Missing order number');
    else if (!/^[A-Za-z0-9_\-]{8,}$/.test(r.orderId)) W.push('Unusual order ID format');
    if (!(r.purchaseDate instanceof Date) || isNaN(r.purchaseDate)) W.push('Missing/invalid purchase date');
    if (!r.itemName) E.push('Missing item description');
    if (!finite(r.qty)) (r._isCharge ? W.push('Quantity not applicable (charge line)') : E.push('Invalid quantity'));
    else if (r.qty <= 0) E.push('Quantity must be positive');
    if (!finite(r.rate)) E.push('Invalid Gross Amount (rate)');
    if (!finite(r.amount)) E.push('Invalid Taxable Value');
    if (!finite(r.totalBill)) E.push('Invalid invoice total');
    const taxes = [r.sgst, r.cgst, r.igst];
    if (taxes.some((t) => t != null && t !== '' && !finite(t))) E.push('Invalid GST amount');
    else if (taxes.every((t) => t == null || t === '')) W.push('No GST amounts found');
    if (finite(r.amount) && finite(r._rowTotal)) {
      const tax = taxes.reduce((a, t) => a + (finite(t) ? t : 0), 0);
      if (Math.abs(r.amount + tax - r._rowTotal) > tol) W.push('Taxable + GST (' + (r.amount + tax).toFixed(2) + ') != line total (' + r._rowTotal.toFixed(2) + ')');
    }
    (r._invMsgs || []).forEach((m) => W.push(m));
    if (!r.shipState) W.push('Ship state not identified');
    if (!/^[1-9]\d{5}$/.test(String(r.shipPin || ''))) W.push('Invalid/missing PIN code');
    if (!r.shipCountry) W.push('Ship country not confirmed');
    if (cfg.warnMissingSku && !r.sku) W.push('Missing SKU');
    if (!r.custGstin) { if (cfg.warnMissingCustGstin) W.push('Missing customer GSTIN'); }
    else if (r._seller && r.custGstin === r._seller) E.push('Customer GSTIN equals seller GSTIN');
    else { const v = MI.validateGSTIN(r.custGstin); if (!v.valid) W.push('Invalid customer GSTIN (' + v.reason + ')'); }
    r._status = E.length ? 'Error' : W.length ? 'Warning' : 'Valid';
    r._msgs = E.concat(W);
    return r;
  };
})(typeof window !== 'undefined' ? window : globalThis);
