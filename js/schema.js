
/* Central Tally + Invalid Review Schemas */
(function (root) {
    'use strict';

    const MI = (root.MI = root.MI || {});

    // VALID DATA: Tally Import Schema
    MI.COLUMNS = [
        { key: 'purchaseDate', label: 'Purchase Date', type: 'date' },
        { key: 'voucherNo', label: 'Voucher Number', type: 'text' },
        { key: 'orderId', label: 'Meesho Order ID', type: 'text' },
        { key: 'partyName', label: 'Party Name', type: 'text' },
        { key: 'salesLedger', label: 'Sales Ledger', type: 'text' },
        { key: 'itemName', label: 'Item Basic Name', type: 'text' },
        { key: 'sku', label: 'Item SKU', type: 'text' },
        { key: 'itemHSN', label: 'HSN Number', type: 'text' },
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
        { key: 'custGstin', label: 'Customer GSTIN', type: 'text' },
        // { key: 'documentType', label: 'Document Type', type: 'text' },
        // { key: 'transactionType', label: 'Transaction Type', type: 'text' },
        // { key: 'invoiceNumber', label: 'Invoice Number', type: 'text' },
        // { key: 'creditNoteNumber', label: 'Credit Note Number', type: 'text' },
        // { key: 'originalInvoiceNumber', label: 'Original Invoice Number', type: 'text' }
    ];

    // INVALID DATA: Review Schema
    MI.INVALID_COLUMNS = [
        { key: '_file', label: 'PDF File Name', type: 'text' },
        { key: 'purchaseDate', label: 'Purchase Date', type: 'date' },
        { key: 'orderId', label: 'Meesho Order ID', type: 'text' },
        { key: 'invoiceNumber', label: 'Invoice Number', type: 'text' },
        { key: 'documentType', label: 'Document Type', type: 'text' },
        { key: 'transactionType', label: 'Transaction Type', type: 'text' },
        { key: 'itemName', label: 'Item Basic Name', type: 'text' },
        { key: 'sku', label: 'Item SKU', type: 'text' },
        { key: 'itemHSN', label: 'HSN Number', type: 'text' },
        { key: 'qty', label: 'Item Quantity', type: 'num' },
        { key: 'rate', label: 'Item Rate', type: 'num' },
        { key: 'amount', label: 'Item Basic Amount', type: 'num' },
        { key: 'sgst', label: 'SGST', type: 'num' },
        { key: 'cgst', label: 'CGST', type: 'num' },
        { key: 'igst', label: 'IGST', type: 'num' },
        { key: 'totalBill', label: 'Total Bill Value', type: 'num' },
        { key: 'shipState', label: 'Ship State', type: 'text' },
        { key: 'shipPin', label: 'Ship Postal Code', type: 'text' },
        { key: 'shipCountry', label: 'Ship Country', type: 'text' },
        { key: 'custGstin', label: 'Customer GSTIN', type: 'text' },
        { key: '_status', label: 'Validation Status', type: 'text' },
        { key: '_msgs', label: 'Validation Errors / Warnings', type: 'text' }
    ];

    // Failed PDF processing schema
    MI.FAILED_FILE_COLUMNS = [
        { key: 'fileName', label: 'PDF File Name', type: 'text' },
        { key: 'stage', label: 'Processing Stage', type: 'text' },
        { key: 'msg', label: 'Processing Error', type: 'text' },
        { key: 'rows', label: 'Extracted Rows', type: 'num' },
        { key: 'rawText', label: 'Raw PDF Text', type: 'text' }
    ];

    MI.CONFIG = {
        warnMissingSku: false,
        warnMissingCustGstin: false,
        tolerance: 0.06
    };

})(typeof window !== 'undefined' ? window : globalThis);
