import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

// Adds/updates the company's website in AITrainingData for Sarah to recall.
// Usage (frontend): await addCompanyWebsiteMemory({ websiteUrl: 'https://yicnroofing.com', companyId?: string })
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { websiteUrl, companyId: inputCompanyId } = await req.json();
    if (!websiteUrl || typeof websiteUrl !== 'string') {
      return Response.json({ error: 'websiteUrl is required' }, { status: 400 });
    }

    const normalized = websiteUrl.match(/^https?:\/\//i) ? websiteUrl : `https://${websiteUrl}`;

    // Resolve companyId: prefer explicit, else owned company, else staff profile company
    let companyId = inputCompanyId || null;
    if (!companyId) {
      const companies = await base44.entities.Company.list('-created_date', 50);
      const owned = companies.find(c => c.created_by === user.email);
      if (owned) companyId = owned.id;
      if (!companyId) {
        const staff = await base44.entities.StaffProfile.filter({ user_email: user.email });
        if (staff[0]?.company_id) companyId = staff[0].company_id;
      }
    }

    if (!companyId) {
      return Response.json({ error: 'Could not resolve companyId for current user' }, { status: 400 });
    }

    // Upsert AITrainingData record
    const existing = await base44.asServiceRole.entities.AITrainingData.filter({ company_id: companyId, is_active: true });
    const match = existing.find(r => (r.content || '').toLowerCase().includes('website'));
    if (match) {
      await base44.asServiceRole.entities.AITrainingData.update(match.id, {
        content: `Official website: ${normalized}`,
        is_active: true,
      });
    } else {
      await base44.asServiceRole.entities.AITrainingData.create({
        company_id: companyId,
        content: `Official website: ${normalized}`,
        is_active: true,
      });
    }

    return Response.json({ success: true, company_id: companyId, website: normalized });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});