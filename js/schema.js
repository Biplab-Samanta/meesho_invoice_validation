/* Central Tally schema: exact 19 columns, exact order. */
(function (root) {
  'use strict';
  const MI = (root.MI = root.MI || {});
  MI.COLUMNS = [
    { key: 'purchaseDate', label: 'Purchase Date', type: 'date' },
    { key: 'voucherNo', label: 'Voucher Number', type: 'text' },
    { key: 'orderId', label: 'Meesho Order ID', type: 'text' },
    { key: 'partyName', label: 'Party Name', type: 'text' },
    { key: 'salesLedger', label: 'Sales Ledger', type: 'text' },
    { key: 'itemName', label: 'Item Basic Name', type: 'text' },
    { key: 'sku', label: 'Item SKU', type: 'text' },
    { key: 'qty', label: 'Item Quantity', type: 'num' },
    { key: 'rate', label: 'Item Rate', type: 'num' },
    { key: 'per', label: 'Per', type: 'text' },
    { key: 'amount', label: 'Item Basic Amount', type: 'num' },
    { key: 'sgst', label: 'SGST', type: 'num' },
    { key: 'cgst', label: 'CGST', type: 'num' },
    { key: 'igst', label: 'IGST', type: 'num' },
    { key: 'totalBill', label: 'Total Bill Value', type: 'num' },
    { key: 'shipState', label: 'Ship State', type: 'text' },
    { key: 'shipPin', label: 'Ship Postal Code', type: 'text' },
    { key: 'shipCountry', label: 'Ship Country', type: 'text' },
    { key: 'custGstin', label: 'Customer GSTIN', type: 'text' }
  ];
  /* Missing SKU / customer GSTIN are normal for Meesho B2C invoices. Set true to flag them as Warning. */
  MI.CONFIG = { warnMissingSku: false, warnMissingCustGstin: false, tolerance: 0.06 };
})(typeof window !== 'undefined' ? window : globalThis);
