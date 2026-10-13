import { insuranceSettlementHtml } from '../../lib/insuranceSettlement.js';

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

export function generateEstimateHTML({
  insuranceSettlement,
  customerInfo,
  lineItems,
  descriptions,
  satelliteAnalysis,
  satelliteAddress,
  companyName,
  companyLogoUrl,
  companyColor = '#1e3a8a',
  companyFooterText = '',
  estimateNumber,
  lang = 'en',
  presentationRenderUrl = '',
}) {
  const isEs = lang === 'es';
  const L = isEs ? {
    title: 'ESTIMACION DE TECHO', estimate: 'Estimacion', customer: 'Cliente',
    propertyAddress: 'Direccion', phone: 'Telefono', email: 'Correo',
    insuranceCompany: 'Compania de Seguros', claimNumber: 'Numero de Reclamacion',
    lineItems: 'Detalles del Presupuesto', code: 'Codigo', description: 'Descripcion',
    qty: 'Cant.', unit: 'Unidad', rate: 'Precio', amount: 'Importe',
    total: 'Total', printSave: 'Imprimir / Guardar como PDF',
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
    qty: 'Qty', unit: 'Unit', rate: 'Rate', amount: 'Amount',
    total: 'Total', printSave: 'Print / Save as PDF',
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

  // This is the plain retail export. RCV/ACV fields may exist internally for
  // imported carrier estimates, but they are not retail customer-facing terms.
  const lineAmount = (item) => {
    const saved = item.amount ?? item.rcv ?? item.acv;
    return saved == null
      ? (Number(item.quantity) || 0) * (Number(item.rate) || 0)
      : Number(saved) || 0;
  };
  const totalAmount = lineItems.reduce((acc, item) => acc + lineAmount(item), 0);
  const now = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

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
  // Calculate order quantity: use stored value if present, otherwise derive from roof area + waste
  const orderQty = (Number(sa.final_order_quantity_sq) > 0)
    ? Number(sa.final_order_quantity_sq)
    : Math.round(roofAreaSq * (1 + wastePct / 100) * 100) / 100;
  const pitchStr = esc(sa.pitch || '\u2014');
  const roofType = esc((sa.roof_type || '\u2014').replace(/_/g, ' '));
  const confGrade = (sa.overall_confidence || 0) >= 80 ? 'A' : (sa.overall_confidence || 0) >= 65 ? 'B' : 'C';
  const escapedCompany = esc(companyName);
  const escapedEstNum = esc(estimateNumber);
  const primaryColor = /^#[0-9a-fA-F]{6}$/.test(companyColor) ? companyColor : '#1e3a8a';

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

  const lineItemRows = lineItems.map((item, idx) => {
    const desc = esc(descriptions?.[idx] || item.description || '');
    const code = esc(item.code || '');
    const qty = parseFloat(item.quantity) || 0;
    const rate = parseFloat(item.rate) || 0;
    const amount = lineAmount(item);
    const bg = idx % 2 === 0 ? '#f9fafb' : '#ffffff';
    return `<tr style="background:${bg}">
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center;color:#6b7280;font-size:11px">${code || (idx + 1)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb">${desc}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center">${qty % 1 === 0 ? qty.toFixed(0) : qty.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:center">${esc(item.unit || 'EA')}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">$${rate.toFixed(2)}</td>
      <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right">$${amount.toFixed(2)}</td>
    </tr>`;
  }).join('');

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
      thead { display: table-header-group; }
      tr, .info-box, .summary-card, .section-title { break-inside: avoid; page-break-inside: avoid; }
      .print-footer { position: fixed; bottom: 0; left: 0; right: 0; background: white; }
      .page { padding-bottom: 52px; }
    }
    @page { margin: 0.5in; }
    .page { max-width: 850px; margin: 0 auto; padding: 40px; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; border-bottom: 3px solid ${primaryColor}; padding-bottom: 16px; }
    .header-left h1 { font-size: 28px; color: ${primaryColor}; font-weight: 800; letter-spacing: -0.5px; }
    .header-left .subtitle { color: #6b7280; font-size: 13px; margin-top: 2px; }
    .header-right { text-align: right; }
    .header-right .est-num { font-size: 14px; color: ${primaryColor}; font-weight: 700; }
    .header-right .est-date { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .info-section { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
    .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
    .info-box h3 { font-size: 11px; text-transform: uppercase; color: #9ca3af; letter-spacing: 1px; margin-bottom: 8px; }
    .info-box .name { font-size: 15px; font-weight: 700; color: #111827; }
    .info-box .detail { font-size: 12px; color: #6b7280; margin-top: 3px; }
    .section-title { font-size: 16px; font-weight: 700; color: ${primaryColor}; margin: 28px 0 12px; padding-bottom: 6px; border-bottom: 2px solid #e5e7eb; }
    .sat-img { width: 100%; max-height: 350px; object-fit: cover; border-radius: 8px; border: 2px solid #e5e7eb; }
    .presentation-img { width: 100%; max-height: 480px; object-fit: contain; border-radius: 8px; border: 2px solid #e5e7eb; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
    .summary-card { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; text-align: center; }
    .summary-card .label { font-size: 11px; text-transform: uppercase; color: #6b7280; letter-spacing: 0.5px; }
    .summary-card .value { font-size: 22px; font-weight: 800; color: ${primaryColor}; margin-top: 4px; }
    .summary-card .sub { font-size: 11px; color: #9ca3af; margin-top: 2px; }
    .grade-badge { display: inline-block; width: 36px; height: 36px; border-radius: 50%; background: ${confGrade === 'A' ? '#16a34a' : confGrade === 'B' ? '#2563eb' : '#f59e0b'}; color: #fff; font-weight: 800; font-size: 18px; line-height: 36px; text-align: center; }
    table.data-table { width: 100%; border-collapse: collapse; margin: 12px 0; }
    table.data-table th { background: ${primaryColor}; color: #fff; padding: 10px 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; text-align: left; }
    table.data-table td { padding: 8px 12px; font-size: 13px; }
    .totals-row { background: ${primaryColor}; color: #fff; }
    .totals-row td { padding: 10px 12px; font-weight: 700; font-size: 15px; }
    .footer { text-align: center; color: #9ca3af; font-size: 10px; margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; }
    .print-btn { position: fixed; bottom: 20px; right: 20px; background: ${primaryColor}; color: #fff; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 999; }
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

    ${presentationRenderUrl ? `
    <div class="section-title">Presentation Illustration</div>
    <img src="${escAttr(presentationRenderUrl)}" class="presentation-img" alt="Illustration of the property" />
    <div style="font-size:11px;color:#475569;text-align:center;margin-top:6px;font-weight:600">Illustration — not a measurement document</div>
    ` : ''}
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
          <th style="width:28%;text-align:right">${L.amount}</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemRows}
        <tr class="totals-row">
          <td colspan="5" style="text-align:right">${L.total}:</td>
          <td style="text-align:right">$${totalAmount.toFixed(2)}</td>
        </tr>
      </tbody>
    </table>

  </div>

  <div class="footer print-footer">
    ${escapedCompany || 'CompanySync'} &bull; ${esc(companyFooterText || `Generated ${now}`)} &bull; This estimate is valid for 30 days from the date shown.
  </div>
${insuranceSettlementHtml(insuranceSettlement, totalAmount)}
</body>
</html>`;
}
