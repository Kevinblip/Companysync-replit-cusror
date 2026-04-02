function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return esc(str);
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function generateEstimateHTML({
  customerInfo,
  lineItems,
  descriptions,
  satelliteAnalysis,
  satelliteAddress,
  companyName,
  companyLogoUrl,
  companyAddress = '',
  companyPhone = '',
  estimateNumber,
  lang = 'en',
  isInsuranceJob = false,
}) {
  const isEs = lang === 'es';
  const L = isEs ? {
    title: 'ESTIMACION DE TECHO', estimate: 'Estimacion', customer: 'Cliente',
    propertyAddress: 'Direccion', phone: 'Telefono', email: 'Correo',
    insuranceCompany: 'Compania de Seguros', claimNumber: 'Numero de Reclamacion',
    lineItems: 'Detalles del Presupuesto', code: 'Codigo', description: 'Descripcion',
    qty: 'Cant.', unit: 'Unidad', rate: 'Precio', rcv: 'VCR', acv: 'VCA',
    totalRcv: 'Total VCR', totalAcv: 'Total VCA', printSave: 'Imprimir / Guardar como PDF',
    roofSummary: 'Resumen del Techo', roofArea: 'Area del Techo', pitch: 'Pendiente',
    roofType: 'Tipo de Techo', wasteTable: 'Tabla de Desperdicio', measurements: 'Mediciones Lineales',
    propertyImage: 'Imagen de la Propiedad',
    preparedFor: 'Preparado Para', preparedBy: 'Preparado Por', estimateDate: 'Fecha',
    orderQty: 'Cantidad de Pedido', confidence: 'Confianza', ridge: 'Caballete',
    hip: 'Cadera', valley: 'Valle', rake: 'Inclinacion', eave: 'Alero',
    stepFlash: 'Tapajuntas', sqft: 'pies cuad.', sq: 'CU', lf: 'PL',
    coverPage: 'INFORME DE TECHO', measurement: 'Medicion', length: 'Longitud',
    areaLabel: 'Area', squares: 'Cuadrados',
  } : {
    title: 'ROOF ESTIMATE', estimate: 'Estimate', customer: 'Customer',
    propertyAddress: 'Property Address', phone: 'Phone', email: 'Email',
    insuranceCompany: 'Insurance Company', claimNumber: 'Claim Number',
    lineItems: 'Estimate Details', code: 'Code', description: 'Description',
    qty: 'Qty', unit: 'Unit', rate: 'Rate', rcv: 'RCV', acv: 'ACV',
    totalRcv: 'Total RCV', totalAcv: 'Total ACV', printSave: 'Print / Save as PDF',
    roofSummary: 'Roof Summary', roofArea: 'Roof Area', pitch: 'Pitch',
    roofType: 'Roof Type', wasteTable: 'Waste Calculation', measurements: 'Linear Measurements',
    propertyImage: 'Property Image',
    preparedFor: 'Prepared For', preparedBy: 'Prepared By', estimateDate: 'Estimate Date',
    orderQty: 'Order Quantity', confidence: 'Confidence', ridge: 'Ridge',
    hip: 'Hip', valley: 'Valley', rake: 'Rake', eave: 'Eave',
    stepFlash: 'Step Flashing', sqft: 'sq ft', sq: 'SQ', lf: 'LF',
    coverPage: 'ROOF REPORT', measurement: 'Measurement', length: 'Length',
    areaLabel: 'Area', squares: 'Squares',
  };

  const totalRcv = lineItems.reduce((acc, i) => acc + (Number(i.rcv) || 0), 0);
  const totalAcv = lineItems.reduce((acc, i) => acc + (Number(i.acv) || 0), 0);
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const nowShort = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' });

  const gmapsKey = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('_gmaps_key') : '';
  const lat = satelliteAddress?.coordinates?.lat;
  const lng = satelliteAddress?.coordinates?.lng;
  const addr = esc(satelliteAddress?.address || customerInfo?.property_address || '');
  const sa = satelliteAnalysis || {};

  const satelliteImgUrl = (lat && lng && gmapsKey)
    ? `https://maps.googleapis.com/maps/api/staticmap?center=${encodeURIComponent(lat)},${encodeURIComponent(lng)}&zoom=20&size=640x480&maptype=satellite&markers=color:red|${encodeURIComponent(lat)},${encodeURIComponent(lng)}&key=${encodeURIComponent(gmapsKey)}`
    : '';

  const roofAreaSq = Number(sa.roof_area_sq) || 0;
  const roofAreaSqFt = Number(sa.roof_area_sqft) || Math.round(roofAreaSq * 100);
  const wastePct = Number(sa.waste_percentage) || 10;
  const orderQty = (Number(sa.final_order_quantity_sq) > 0)
    ? Number(sa.final_order_quantity_sq)
    : Math.round(roofAreaSq * (1 + wastePct / 100) * 100) / 100;
  const pitchStr = esc(sa.pitch || '\u2014');
  const roofType = esc((sa.roof_type || '\u2014').replace(/_/g, ' '));
  const confGrade = (sa.overall_confidence || 0) >= 80 ? 'A' : (sa.overall_confidence || 0) >= 65 ? 'B' : 'C';
  const escapedCompany = esc(companyName);
  const escapedEstNum = esc(estimateNumber);

  const meas = [
    { label: L.ridge, val: sa.ridge_lf, conf: sa.ridge_confidence, color: '#9333ea' },
    { label: L.hip, val: sa.hip_lf, conf: sa.hip_confidence, color: '#3b82f6' },
    { label: L.valley, val: sa.valley_lf, conf: sa.valley_confidence, color: '#10b981' },
    { label: L.rake, val: sa.rake_lf, conf: sa.rake_confidence, color: '#f97316' },
    { label: L.eave, val: sa.eave_lf, conf: sa.eave_confidence, color: '#ef4444' },
    { label: L.stepFlash, val: sa.step_flashing_lf, conf: sa.step_flashing_confidence, color: '#ec4899' },
  ];

  const wasteRows = [5, 10, 12, 15, 17, 20].map(w => {
    const area = Math.round(roofAreaSqFt * (1 + w / 100));
    return `<td style="text-align:center;padding:6px;border:1px solid #e5e7eb;${w === wastePct ? 'background:#dbeafe;font-weight:700' : ''}">${area.toLocaleString()}</td>`;
  });
  const wasteSqRows = [5, 10, 12, 15, 17, 20].map(w => {
    const area = Math.round(roofAreaSqFt * (1 + w / 100));
    const sq = (area / 100).toFixed(1);
    return `<td style="text-align:center;padding:6px;border:1px solid #e5e7eb;${w === wastePct ? 'background:#dbeafe;font-weight:700' : ''}">${sq}</td>`;
  });

  const measRows = meas.map(m => {
    const v = Number(m.val) || 0;
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">
        <span style="display:inline-block;width:12px;height:12px;background:${m.color};border-radius:50%;margin-right:8px;vertical-align:middle"></span>
        ${m.label}
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600">${v > 0 ? v.toFixed(1) : '0'} ${L.lf}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#6b7280">${m.conf || '\u2014'}%</td>
    </tr>`;
  }).join('');

  // ─── Xactimate / State Farm format ──────────────────────────────────────────
  if (isInsuranceJob) {
    // Per-item calculations
    let lineItemTotal = 0;
    let totalTax = 0;

    const xactRows = lineItems.map((item, idx) => {
      const desc = esc(descriptions?.[idx] || item.description || '');
      const qty = parseFloat(item.quantity) || 0;
      const unit = esc(item.unit || 'EA');

      // Determine rate: use replace_rate if present, else rate
      const rate = parseFloat(item.replace_rate) || parseFloat(item.rate) || 0;

      // Tax: use stored tax field, else calculate from tax_rate, else derive from rcv - (qty*rate)
      let tax = 0;
      if (item.tax != null && String(item.tax).trim() !== '') {
        tax = parseFloat(item.tax) || 0;
      } else if (item.tax_rate) {
        tax = qty * rate * (parseFloat(item.tax_rate) / 100);
      } else {
        const rcvField = parseFloat(item.rcv) || 0;
        const removeTotal = qty * (parseFloat(item.remove_rate) || 0);
        const derivedTax = rcvField - removeTotal - qty * rate;
        tax = derivedTax > 0 ? derivedTax : 0;
      }

      const removeTotal = qty * (parseFloat(item.remove_rate) || 0);
      const rcvLine = parseFloat(item.rcv) || (qty * rate + tax + removeTotal);

      lineItemTotal += rcvLine - tax;
      totalTax += tax;

      const bg = idx % 2 === 0 ? '#ffffff' : '#f9fafb';
      const qtyStr = qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2);

      return `<tr style="background:${bg}">
        <td style="padding:7px 10px;border-bottom:1px solid #d1d5db;font-size:12px">${idx + 1}. ${desc}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #d1d5db;font-size:12px;text-align:right;white-space:nowrap">${qtyStr} ${unit}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #d1d5db;font-size:12px;text-align:right">${fmt(rate)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #d1d5db;font-size:12px;text-align:right">${tax > 0 ? fmt(tax) : '0.00'}</td>
        <td style="padding:7px 10px;border-bottom:1px solid #d1d5db;font-size:12px;text-align:right;font-weight:600">${fmt(rcvLine)}</td>
      </tr>`;
    }).join('');

    const rcvTotal = lineItemTotal + totalTax;
    const deductible = parseFloat(customerInfo?.deductible || customerInfo?.deductible_amount || 0);
    const netPayment = rcvTotal - deductible;

    const insuredName = esc(customerInfo?.customer_name || '\u2014');
    const propertyAddr = esc(customerInfo?.property_address || satelliteAddress?.address || '\u2014');
    const homePhone = esc(customerInfo?.customer_phone || '\u2014');
    const typeOfLoss = esc(customerInfo?.type_of_loss || customerInfo?.loss_type || 'Wind');
    const claimNum = esc(customerInfo?.claim_number || '\u2014');
    const policyNum = esc(customerInfo?.policy_number || '\u2014');
    const dateOfLoss = esc(customerInfo?.date_of_loss || '\u2014');
    const dateInspected = esc(customerInfo?.date_inspected || '\u2014');
    const adjusterName = esc(customerInfo?.adjuster_name || companyName || '\u2014');
    const adjusterPhone = esc(customerInfo?.adjuster_phone || '\u2014');
    const insuranceCo = esc(customerInfo?.insurance_company || 'Insurance Carrier');
    const priceList = esc(customerInfo?.price_list || 'Current Price List');

    // Split address into line1 / city-state-zip for display
    const addrParts = (customerInfo?.property_address || satelliteAddress?.address || '').split(',');
    const addrLine1 = esc(addrParts[0] || '');
    const addrLine2 = esc(addrParts.slice(1).join(',').trim());

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${insuredName} - ${escapedEstNum || 'Estimate'}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #1a1a1a; line-height: 1.4; }
    @media print {
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      body { margin: 0; }
    }
    @page { margin: 0.6in; size: letter; }
    .page { max-width: 780px; margin: 0 auto; padding: 32px; }
    .print-btn { position: fixed; bottom: 20px; right: 20px; background: #1e3a8a; color: #fff; border: none; padding: 10px 20px; border-radius: 6px; font-size: 13px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 999; }
    .print-btn:hover { background: #1e40af; }
    /* Running header on pages 2+ */
    @media print {
      thead.running-head { display: table-header-group; }
    }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Print / Save as PDF</button>

  <!-- ═══════════════════ PAGE 1 — COVER / SUMMARY ═══════════════════ -->
  <div class="page">

    <!-- Letterhead -->
    <div style="text-align:center;border-bottom:1px solid #9ca3af;padding-bottom:12px;margin-bottom:16px">
      ${companyLogoUrl ? `<img src="${escAttr(companyLogoUrl)}" style="max-height:48px;max-width:200px;margin-bottom:6px;display:block;margin-left:auto;margin-right:auto" onerror="this.style.display='none'" />` : ''}
      <div style="font-size:15px;font-weight:700">${escapedCompany || 'Your Insurance Claims Network'}</div>
      ${companyAddress ? `<div style="font-size:11px;color:#374151;margin-top:2px">${esc(companyAddress)}</div>` : ''}
      ${companyPhone ? `<div style="font-size:11px;color:#374151;margin-top:1px">${esc(companyPhone)}</div>` : ''}
      <div style="font-size:11px;color:#6b7280;margin-top:2px">${nowShort} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
    </div>

    <!-- Two-column insured / claim info grid -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      <tbody>
        <tr>
          <td style="width:50%;vertical-align:top;padding:0 16px 0 0">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700;vertical-align:top">Insured:</td>
                <td style="padding:2px 0">${insuredName}</td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700;vertical-align:top">Property:</td>
                <td style="padding:2px 0">${addrLine1}${addrLine2 ? `<br><span style="padding-left:0">${addrLine2}</span>` : ''}</td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Home:</td>
                <td style="padding:2px 0">${homePhone}</td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Type of Loss:</td>
                <td style="padding:2px 0">${typeOfLoss}</td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Deductible:</td>
                <td style="padding:2px 0">${deductible > 0 ? '$' + fmt(deductible) : '\u2014'}</td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Date of Loss:</td>
                <td style="padding:2px 0">${dateOfLoss}</td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Date Inspected:</td>
                <td style="padding:2px 0">${dateInspected}</td>
              </tr>
            </table>
          </td>
          <td style="width:50%;vertical-align:top;padding:0 0 0 16px;border-left:1px solid #d1d5db">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Estimate:</td>
                <td style="padding:2px 0">${escapedEstNum || '\u2014'}</td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Claim Number:</td>
                <td style="padding:2px 0">${claimNum}</td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Policy Number:</td>
                <td style="padding:2px 0">${policyNum}</td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Insurance:</td>
                <td style="padding:2px 0">${insuranceCo}</td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Price List:</td>
                <td style="padding:2px 0">${priceList}<br><span style="color:#6b7280;font-size:11px">Restoration/Service/Remodel</span></td>
              </tr>
              <tr>
                <td style="padding:2px 8px 2px 0;white-space:nowrap;font-weight:700">Date:</td>
                <td style="padding:2px 0">${nowShort}</td>
              </tr>
            </table>
          </td>
        </tr>
      </tbody>
    </table>

    <!-- Summary for Dwelling box -->
    <div style="margin-bottom:20px">
      <div style="font-size:13px;font-weight:700;text-align:center;margin-bottom:8px;text-decoration:underline">Summary for Dwelling</div>
      <table style="width:360px;border-collapse:collapse;margin:0 auto;font-size:12px">
        <tr>
          <td style="padding:3px 12px">Line Item Total</td>
          <td style="padding:3px 12px;text-align:right">${fmt(lineItemTotal)}</td>
        </tr>
        <tr>
          <td style="padding:3px 12px">Material Sales Tax</td>
          <td style="padding:3px 12px;text-align:right">${fmt(totalTax)}</td>
        </tr>
        <tr style="border-top:1px solid #9ca3af">
          <td style="padding:3px 12px">Replacement Cost Value</td>
          <td style="padding:3px 12px;text-align:right">${fmt(rcvTotal)}</td>
        </tr>
        ${deductible > 0 ? `<tr>
          <td style="padding:3px 12px">Less Deductible</td>
          <td style="padding:3px 12px;text-align:right">(${fmt(deductible)})</td>
        </tr>` : ''}
        <tr style="border-top:1px solid #374151">
          <td style="padding:4px 12px;font-weight:700">Net Payment</td>
          <td style="padding:4px 12px;text-align:right;font-weight:700;border-top:1px solid #374151">$${fmt(netPayment > 0 ? netPayment : rcvTotal)}</td>
        </tr>
      </table>
    </div>

    <!-- Adjuster sign-off -->
    <div style="margin-top:24px;font-size:12px">
      <div style="font-weight:700">${adjusterName}</div>
      ${adjusterPhone !== '\u2014' ? `<div>${adjusterPhone}</div>` : ''}
    </div>

    <!-- Footer disclaimer -->
    <div style="margin-top:20px;font-size:11px;font-weight:700;border-top:1px solid #9ca3af;padding-top:10px">
      ALL AMOUNTS PAYABLE ARE SUBJECT TO THE TERMS, CONDITIONS AND LIMITS OF YOUR POLICY.
    </div>
  </div>

  <!-- ═══════════════════ PAGE 2 — LINE ITEMS ═══════════════════ -->
  <div class="page page-break">

    <!-- Page header -->
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #374151;padding-bottom:6px;margin-bottom:14px">
      <div style="font-size:13px;font-weight:700">${insuredName}</div>
      <div style="font-size:11px;color:#6b7280">${escapedCompany || ''}</div>
      <div style="font-size:11px;color:#6b7280">${nowShort}</div>
    </div>

    ${satelliteImgUrl ? `
    <img src="${escAttr(satelliteImgUrl)}" style="width:100%;max-height:260px;object-fit:cover;border:1px solid #d1d5db;margin-bottom:12px" alt="Satellite view" />
    <div style="font-size:10px;color:#9ca3af;text-align:center;margin-bottom:12px">${addr} &mdash; Satellite imagery</div>
    ` : ''}

    ${roofAreaSq > 0 ? `
    <div style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:14px;font-size:12px">
      <span><strong>${fmt(roofAreaSqFt)}</strong> Surface Area</span>
      <span><strong>${roofAreaSq.toFixed(2)}</strong> Number of Squares</span>
      ${sa.perimeter_lf ? `<span><strong>${sa.perimeter_lf}</strong> Total Perimeter Length</span>` : ''}
      ${sa.ridge_lf ? `<span><strong>${sa.ridge_lf}</strong> Total Ridge Length</span>` : ''}
    </div>
    ` : ''}

    <!-- Line items table — Xactimate style -->
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="border-bottom:2px solid #374151;border-top:2px solid #374151">
          <th style="padding:6px 10px;text-align:left;font-weight:700">DESCRIPTION</th>
          <th style="padding:6px 10px;text-align:right;font-weight:700;white-space:nowrap">QUANTITY</th>
          <th style="padding:6px 10px;text-align:right;font-weight:700;white-space:nowrap">UNIT PRICE</th>
          <th style="padding:6px 10px;text-align:right;font-weight:700">TAX</th>
          <th style="padding:6px 10px;text-align:right;font-weight:700">RCV</th>
        </tr>
      </thead>
      <tbody>
        ${xactRows}
      </tbody>
      <tfoot>
        <tr style="border-top:2px solid #374151;font-weight:700">
          <td colspan="3" style="padding:6px 10px;text-align:right">Totals:</td>
          <td style="padding:6px 10px;text-align:right">${fmt(totalTax)}</td>
          <td style="padding:6px 10px;text-align:right">${fmt(rcvTotal)}</td>
        </tr>
      </tfoot>
    </table>

    <!-- Area / dwelling totals -->
    <div style="margin-top:24px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr style="border-top:1px solid #374151">
          <td style="padding:4px 10px">Line Item Totals: ${escapedEstNum || ''}</td>
          <td style="padding:4px 10px;text-align:right">${fmt(totalTax)}</td>
          <td style="padding:4px 10px;text-align:right">${fmt(rcvTotal)}</td>
        </tr>
      </table>
    </div>

    ${roofAreaSq > 0 ? `
    <!-- Measurement table (if satellite data available) -->
    <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px">
      <div style="font-weight:700;font-size:13px;margin-bottom:10px">Grand Total Areas:</div>
      <div style="font-size:12px;display:flex;gap:24px;flex-wrap:wrap;color:#374151">
        <span>${fmt(roofAreaSqFt)} Surface Area</span>
        <span>${roofAreaSq.toFixed(2)} Number of Squares</span>
        ${sa.perimeter_lf ? `<span>${sa.perimeter_lf} LF Total Perimeter Length</span>` : ''}
        ${sa.ridge_lf ? `<span>${sa.ridge_lf} LF Total Ridge Length</span>` : ''}
      </div>
    </div>
    ` : ''}

    <!-- Page footer -->
    <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:8px;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af">
      <div>${escapedEstNum || ''}</div>
      <div>Page: 2</div>
    </div>
  </div>

</body>
</html>`;
  }

  // ─── Standard (non-insurance) format ────────────────────────────────────────
  const lineItemRows = lineItems.map((item, idx) => {
    const desc = esc(descriptions?.[idx] || item.description || '');
    const code = esc(item.code || '');
    const qty = parseFloat(item.quantity) || 0;
    const rate = parseFloat(item.rate) || 0;
    const rcv = parseFloat(item.rcv) || 0;
    const acv = parseFloat(item.acv) || 0;
    const bg = idx % 2 === 0 ? '#f9fafb' : '#ffffff';
    return `<tr style="background:${bg}">
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#6b7280;font-size:11px">${code || (idx + 1)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${desc}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center">${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center">${esc(item.unit || 'EA')}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">$${rate.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">$${rcv.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">$${acv.toFixed(2)}</td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(L.title)} - ${esc(customerInfo?.customer_name || 'Draft')}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; line-height: 1.5; }
    @media print {
      .no-print { display: none !important; }
      .page-break { page-break-before: always; }
      body { margin: 0; }
    }
    @page { margin: 0.5in; }
    .page { max-width: 850px; margin: 0 auto; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 3px solid #1e3a8a; padding-bottom: 16px; }
    .header-left h1 { font-size: 28px; color: #1e3a8a; font-weight: 800; letter-spacing: -0.5px; }
    .header-left .subtitle { color: #6b7280; font-size: 13px; margin-top: 2px; }
    .header-right { text-align: right; }
    .header-right .est-num { font-size: 14px; color: #1e3a8a; font-weight: 700; }
    .header-right .est-date { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .info-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .info-box h3 { font-size: 11px; text-transform: uppercase; color: #9ca3af; letter-spacing: 1px; margin-bottom: 8px; }
    .info-box .name { font-size: 15px; font-weight: 700; color: #111827; }
    .info-box .detail { font-size: 12px; color: #6b7280; margin-top: 3px; }
    .section-title { font-size: 16px; font-weight: 700; color: #1e3a8a; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
    .sat-img { width: 100%; max-height: 350px; object-fit: cover; border-radius: 8px; border: 2px solid #e5e7eb; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
    .summary-card { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; text-align: center; }
    .summary-card .label { font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
    .summary-card .value { font-size: 22px; font-weight: 800; color: #1e3a8a; margin-top: 4px; }
    .summary-card .sub { font-size: 11px; color: #9ca3af; margin-top: 2px; }
    .grade-badge { display: inline-block; width: 36px; height: 36px; border-radius: 50%; background: ${confGrade === 'A' ? '#16a34a' : confGrade === 'B' ? '#2563eb' : '#f59e0b'}; color: #fff; font-weight: 800; font-size: 18px; line-height: 36px; text-align: center; }
    table.data-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    table.data-table th { background: #1e3a8a; color: #fff; padding: 10px 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }
    table.data-table td { padding: 8px 12px; font-size: 13px; }
    .totals-row { background: #1e3a8a; color: #fff; }
    .totals-row td { padding: 10px 12px; font-weight: 700; font-size: 15px; }
    .footer { text-align: center; color: #9ca3af; font-size: 10px; margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; }
    .print-btn { position: fixed; bottom: 20px; right: 20px; background: #1e3a8a; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 999; }
    .print-btn:hover { background: #1e40af; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">${L.printSave}</button>

  <div class="page">
    <div class="header">
      <div class="header-left">
        ${companyLogoUrl ? `<img src="${escAttr(companyLogoUrl)}" style="max-height:40px;max-width:180px;margin-bottom:8px" onerror="this.style.display='none'" />` : ''}
        <h1>${escapedCompany || L.title}</h1>
        <div class="subtitle">${L.coverPage}</div>
      </div>
      <div class="header-right">
        <div class="est-num"># ${escapedEstNum || 'DRAFT'}</div>
        <div class="est-date">${now}</div>
        <div style="margin-top:8px"><span class="grade-badge">${confGrade}</span></div>
      </div>
    </div>

    <div class="info-section">
      <div class="info-box">
        <h3>${L.preparedFor}</h3>
        <div class="name">${esc(customerInfo?.customer_name || '\u2014')}</div>
        <div class="detail">${addr}</div>
        ${customerInfo?.customer_phone ? `<div class="detail">${esc(customerInfo.customer_phone)}</div>` : ''}
        ${customerInfo?.customer_email ? `<div class="detail">${esc(customerInfo.customer_email)}</div>` : ''}
      </div>
      <div class="info-box">
        <h3>${L.preparedBy}</h3>
        <div class="name">${escapedCompany || '\u2014'}</div>
        ${customerInfo?.insurance_company ? `<div class="detail">${L.insuranceCompany}: ${esc(customerInfo.insurance_company)}</div>` : ''}
        ${customerInfo?.claim_number ? `<div class="detail">${L.claimNumber}: ${esc(customerInfo.claim_number)}</div>` : ''}
        <div class="detail">${L.estimateDate}: ${now}</div>
      </div>
    </div>

    ${satelliteImgUrl ? `
    <div class="section-title">${L.propertyImage}</div>
    <img src="${escAttr(satelliteImgUrl)}" class="sat-img" alt="${escAttr('Satellite view of ' + (satelliteAddress?.address || ''))}" />
    <div style="font-size:11px;color:#9ca3af;margin-top:4px;text-align:center">${addr} &mdash; Satellite imagery</div>
    ` : ''}

    ${roofAreaSq > 0 ? `
    <div class="section-title">${L.roofSummary}</div>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="label">${L.roofArea}</div>
        <div class="value">${roofAreaSq.toFixed(1)}</div>
        <div class="sub">${L.sq} (${roofAreaSqFt.toLocaleString()} ${L.sqft})</div>
      </div>
      <div class="summary-card">
        <div class="label">${L.orderQty}</div>
        <div class="value">${orderQty.toFixed(1)}</div>
        <div class="sub">${L.sq} (+${wastePct}% waste)</div>
      </div>
      <div class="summary-card">
        <div class="label">${L.pitch}</div>
        <div class="value">${pitchStr}</div>
        <div class="sub">${roofType}</div>
      </div>
      <div class="summary-card">
        <div class="label">${L.confidence}</div>
        <div class="value"><span class="grade-badge">${confGrade}</span></div>
        <div class="sub">${sa.overall_confidence || 0}%</div>
      </div>
    </div>
    ` : ''}
  </div>

  ${roofAreaSq > 0 ? `
  <div class="page page-break">
    <div class="header">
      <div class="header-left">
        <h1>${L.measurements}</h1>
        <div class="subtitle">${addr}</div>
      </div>
      <div class="header-right">
        <div class="est-num"># ${escapedEstNum || 'DRAFT'}</div>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th style="width:50%">${L.measurement}</th>
          <th style="width:30%;text-align:right">${L.length}</th>
          <th style="width:20%;text-align:center">${L.confidence}</th>
        </tr>
      </thead>
      <tbody>
        ${measRows}
      </tbody>
    </table>

    <div class="section-title">${L.wasteTable} &mdash; ${roofAreaSqFt.toLocaleString()} ${L.sqft} base</div>
    <table style="width:100%;border-collapse:collapse;margin:12px 0">
      <thead>
        <tr style="background:#1e3a8a;color:#fff">
          <th style="padding:8px;text-align:center;font-size:12px">Waste %</th>
          <th style="padding:8px;text-align:center;font-size:12px">5%</th>
          <th style="padding:8px;text-align:center;font-size:12px">10%</th>
          <th style="padding:8px;text-align:center;font-size:12px">12%</th>
          <th style="padding:8px;text-align:center;font-size:12px">15%</th>
          <th style="padding:8px;text-align:center;font-size:12px">17%</th>
          <th style="padding:8px;text-align:center;font-size:12px">20%</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:6px;border:1px solid #e5e7eb;text-align:center;font-weight:600;background:#f8fafc">${L.areaLabel} (${L.sqft})</td>
          ${wasteRows.join('')}
        </tr>
        <tr>
          <td style="padding:6px;border:1px solid #e5e7eb;text-align:center;font-weight:600;background:#f8fafc">${L.squares}</td>
          ${wasteSqRows.join('')}
        </tr>
      </tbody>
    </table>

    ${sa.analysis_notes ? `<div style="margin-top:16px;padding:12px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;font-size:12px;color:#92400e">${esc(sa.analysis_notes)}</div>` : ''}

    <div class="footer">
      ${escapedCompany || 'CompanySync'} &bull; Generated ${now}
    </div>
  </div>
  ` : ''}

  <div class="page page-break">
    <div class="header">
      <div class="header-left">
        <h1>${L.lineItems}</h1>
        <div class="subtitle">${addr}</div>
      </div>
      <div class="header-right">
        <div class="est-num"># ${escapedEstNum || 'DRAFT'}</div>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th style="width:8%">${L.code}</th>
          <th style="width:32%">${L.description}</th>
          <th style="width:10%;text-align:center">${L.qty}</th>
          <th style="width:10%;text-align:center">${L.unit}</th>
          <th style="width:12%;text-align:right">${L.rate}</th>
          <th style="width:14%;text-align:right">${L.rcv}</th>
          <th style="width:14%;text-align:right">${L.acv}</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemRows}
        <tr class="totals-row">
          <td colspan="5" style="text-align:right">${L.totalRcv}:</td>
          <td style="text-align:right">$${totalRcv.toFixed(2)}</td>
          <td style="text-align:right">$${totalAcv.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      ${escapedCompany || 'CompanySync'} &bull; Generated ${now} &bull; This estimate is valid for 30 days from the date shown.
    </div>
  </div>

</body>
</html>`;
}
