import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    console.log('🚀 exportToXactimate started');
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    console.log('👤 User auth:', user ? user.email : 'None');

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { estimateId } = await req.json();
    console.log('📄 Request estimateId:', estimateId);

    if (!estimateId) {
      return Response.json({ error: 'estimateId is required' }, { status: 400 });
    }

    // Fetch the estimate
    console.log('🔍 Fetching estimate...');
    const estimates = await base44.entities.Estimate.filter({ id: estimateId });
    const estimate = estimates[0];

    if (!estimate) {
      console.log('❌ Estimate not found');
      return Response.json({ error: 'Estimate not found' }, { status: 404 });
    }
    console.log('✅ Estimate found:', estimate.estimate_number);

    // Fetch company info (Optimized)
    let company = null;
    if (estimate.company_id) {
        console.log('🏢 Fetching company by ID:', estimate.company_id);
        const companies = await base44.entities.Company.filter({ id: estimate.company_id });
        company = companies[0];
    } else {
        console.log('⚠️ No company_id in estimate, searching by user email...');
        const companies = await base44.entities.Company.filter({ created_by: user.email });
        company = companies[0];
    }
    console.log('✅ Company found:', company ? company.company_name : 'None');

    // Build proper Xactimate ESX XML format (simplified and compatible)
    console.log('📝 Generating XML...');
    const esxXml = `<?xml version="1.0" encoding="UTF-8"?>
<ESXProject xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <ProjectInformation>
    <ClaimNumber>${escapeXml(estimate.claim_number || '')}</ClaimNumber>
    <PolicyNumber>${escapeXml(estimate.policy_number || '')}</PolicyNumber>
    <InsuredName>${escapeXml(estimate.customer_name || '')}</InsuredName>
    <InsuredAddress>${escapeXml(estimate.property_address || '')}</InsuredAddress>
    <InsuranceCarrier>${escapeXml(estimate.insurance_company || '')}</InsuranceCarrier>
    <AdjusterName>${escapeXml(estimate.adjuster_name || '')}</AdjusterName>
    <AdjusterPhone>${escapeXml(estimate.adjuster_phone || '')}</AdjusterPhone>
    <ContractorName>${escapeXml(company?.company_name || 'AI CRM Pro')}</ContractorName>
    <ContractorPhone>${escapeXml(company?.phone || '')}</ContractorPhone>
    <EstimateNumber>${escapeXml(estimate.estimate_number || '')}</EstimateNumber>
    <DateOfLoss>${estimate.created_date ? estimate.created_date.split('T')[0] : ''}</DateOfLoss>
  </ProjectInformation>
  <Estimate>
    <Items>
${generateXactimateItems(estimate.items || [])}
    </Items>
    <Totals>
      <RCVTotal>${(estimate.amount || 0).toFixed(2)}</RCVTotal>
      <ACVTotal>${(estimate.amount || 0).toFixed(2)}</ACVTotal>
      <Tax>${(estimate.total_tax || 0).toFixed(2)}</Tax>
      <TotalAmount>${((estimate.amount || 0) + (estimate.total_tax || 0)).toFixed(2)}</TotalAmount>
    </Totals>
  </Estimate>
  <Notes>${escapeXml(estimate.notes || '')}</Notes>
</ESXProject>`;

    console.log('🚀 Sending response');
    return new Response(esxXml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml',
        'Content-Disposition': `attachment; filename="${estimate.estimate_number || 'estimate'}.esx"`
      }
    });

  } catch (error) {
    console.error('💥 Export error:', error);
    return Response.json({
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
});

function generateXactimateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '';
  }

  return items.map((item, index) => {
    const quantity = item.quantity || 0;
    const rate = item.rate || item.price || 0;
    const rcv = item.rcv || item.amount || (quantity * rate);
    const depreciation = item.depreciation || 0;
    const acv = item.acv || (rcv - depreciation);

    return `      <Item>
        <LineNumber>${index + 1}</LineNumber>
        <Code>${escapeXml(item.code || '')}</Code>
        <Description>${escapeXml(item.description || '')}</Description>
        <Quantity>${quantity.toFixed(2)}</Quantity>
        <UnitOfMeasure>${escapeXml(item.unit || 'EA')}</UnitOfMeasure>
        <UnitPrice>${rate.toFixed(2)}</UnitPrice>
        <RCV>${rcv.toFixed(2)}</RCV>
        <Depreciation>${depreciation.toFixed(2)}</Depreciation>
        <ACV>${acv.toFixed(2)}</ACV>
      </Item>`;
  }).join('\n');
}

function escapeXml(unsafe) {
  if (!unsafe) return '';
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}