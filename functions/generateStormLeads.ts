import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { stormId } = body;

    console.log('📥 Full request body:', JSON.stringify(body));
    console.log('🔍 Storm ID:', stormId, 'Type:', typeof stormId);

    if (!stormId) {
      return Response.json({ error: 'Storm ID required' }, { status: 400 });
    }

    // Get user's company
    const companies = await base44.asServiceRole.entities.Company.list();
    const myCompany = companies.find(c => c.created_by === user.email);
    
    console.log('🏢 Found company:', myCompany?.company_name);
    
    if (!myCompany) {
      return Response.json({ error: 'Company not found for user' }, { status: 404 });
    }

    // Get storm - try multiple methods
    console.log('🔍 Fetching storm with ID:', stormId);
    
    let stormEvent = null;
    
    // Try filter first
    const storms = await base44.asServiceRole.entities.StormEvent.filter({ id: stormId });
    console.log('📊 Filter result count:', storms?.length || 0);
    
    if (storms && storms.length > 0) {
      stormEvent = storms[0];
    } else {
      // Try listing all and finding manually
      const allStorms = await base44.asServiceRole.entities.StormEvent.list('-created_date', 1000);
      console.log('📊 Total storms in database:', allStorms.length);
      stormEvent = allStorms.find(s => s.id === stormId);
      
      if (stormEvent) {
        console.log('✅ Found storm via list method:', stormEvent.title);
      } else {
        console.log('❌ Storm not found. Sample IDs:', allStorms.slice(0, 5).map(s => s.id));
        return Response.json({ 
          error: 'Storm not found in database',
          requestedId: stormId,
          totalStorms: allStorms.length,
          sampleStormIds: allStorms.slice(0, 5).map(s => s.id)
        }, { status: 404 });
      }
    }

    console.log('✅ Storm found:', stormEvent.title);
    
    const affectedAreas = stormEvent.affected_areas || [];
    
    // Generate leads using AI
    const prompt = `Generate 10 realistic roofing leads in these storm-affected areas: ${affectedAreas.join(', ')}

Storm: ${stormEvent.event_type}, Severity: ${stormEvent.severity}

For each lead provide:
- Property owner name
- Full address in affected areas
- Phone (555-XXX-XXXX format)
- Email
- Damage level (minor/moderate/severe)
- Brief damage notes`;

    console.log('🤖 Calling AI to generate leads...');
    
    const aiResponse = await base44.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: false,
      response_json_schema: {
        type: "object",
        properties: {
          leads: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                address: { type: "string" },
                phone: { type: "string" },
                email: { type: "string" },
                damage_level: { type: "string" },
                notes: { type: "string" }
              }
            }
          }
        }
      }
    });

    const generatedLeads = aiResponse.leads || [];
    console.log('✅ AI generated', generatedLeads.length, 'leads');
    
    const createdLeads = [];

    // Create leads in database
    for (const property of generatedLeads) {
      try {
        const estimatedJobValue = property.damage_level === 'severe' ? 15000 :
                                  property.damage_level === 'moderate' ? 8000 : 3000;

        const leadPayload = {
          company_id: myCompany.id,
          name: property.name,
          company: property.address,
          email: property.email || "",
          phone: property.phone || "",
          status: "new",
          source: "storm_tracker",
          lead_source: `Storm Tracker - ${stormEvent.title}`,
          value: estimatedJobValue,
          is_active: true,
          assigned_to: user.email,
          assigned_to_users: [user.email],
          notes: [
            `Property affected by: ${stormEvent.title}`,
            `Storm Type: ${stormEvent.event_type}`,
            `Severity: ${stormEvent.severity}`,
            stormEvent.hail_size_inches ? `Hail: ${stormEvent.hail_size_inches}"` : "",
            stormEvent.wind_speed_mph ? `Wind: ${stormEvent.wind_speed_mph} mph` : "",
            `Property: ${property.address}`,
            `Est. Value: $${estimatedJobValue.toLocaleString()}`,
            `Damage: ${property.damage_level}`,
            property.notes || ""
          ].filter(Boolean).join("\n")
        };

        const lead = await base44.asServiceRole.entities.Lead.create(leadPayload);
        createdLeads.push(lead);
        console.log('✅ Created lead:', lead.name);
      } catch (error) {
        console.error('❌ Error creating lead:', error.message);
      }
    }

    console.log('✅ Total leads created:', createdLeads.length);

    // Update storm
    await base44.asServiceRole.entities.StormEvent.update(stormId, {
      leads_generated: (stormEvent.leads_generated || 0) + createdLeads.length
    });

    return Response.json({
      success: true,
      leadsGenerated: createdLeads.length,
      leads: createdLeads,
      stormTitle: stormEvent.title
    });

  } catch (error) {
    console.error('❌ Lead generation error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});