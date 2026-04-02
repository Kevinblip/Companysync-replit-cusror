import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
    try {
        console.log('🤖 Lexi Workflow Agent started');
        
        const base44 = createClientFromRequest(req);
        
        const body = await req.json();
        const { workflowId, entityType, entityId, entityData, instructions } = body;

        console.log('📋 Entity:', entityType, entityId);
        console.log('📝 Instructions:', instructions);

        // Get company knowledge base
        const knowledgeBase = await base44.asServiceRole.entities.KnowledgeBaseArticle.filter({
            is_ai_training: true
        }, "-priority", 100);

        console.log('📚 Loaded', knowledgeBase.length, 'knowledge base articles');

        // Build context for Lexi
        const kbContext = knowledgeBase.map(article => 
            `ARTICLE: ${article.title}\nCATEGORY: ${article.category}\nCONTENT: ${article.content}`
        ).join('\n\n---\n\n');

        // Get related data based on entity type
        let entityContext = '';
        if (entityType === 'Lead') {
            const leads = await base44.asServiceRole.entities.Lead.filter({ id: entityId });
            const lead = leads[0];
            entityContext = `LEAD DETAILS:\nName: ${lead.name}\nEmail: ${lead.email}\nPhone: ${lead.phone}\nStatus: ${lead.status}\nSource: ${lead.source}\nValue: $${lead.value || 0}\nNotes: ${lead.notes || 'None'}`;
        } else if (entityType === 'Customer') {
            const customers = await base44.asServiceRole.entities.Customer.filter({ id: entityId });
            const customer = customers[0];
            entityContext = `CUSTOMER DETAILS:\nName: ${customer.name}\nEmail: ${customer.email}\nPhone: ${customer.phone}\nAddress: ${customer.address}\nTotal Revenue: $${customer.total_revenue}\nInsurance: ${customer.insurance_company || 'None'}`;
        }

        const prompt = `You are Lexi, the AI Chief Operating Officer for this roofing/construction company.

You have FULL access to the CRM and can take ANY action needed to help the business succeed.

YOUR KNOWLEDGE BASE:
${kbContext}

CURRENT SITUATION:
${entityContext}

WORKFLOW INSTRUCTIONS:
${instructions}

YOUR JOB:
Analyze this situation and decide what actions to take. You can:
1. Send personalized emails (write the full email with proper HTML)
2. Send SMS messages (keep under 160 chars)
3. Create tasks for staff with detailed instructions
4. Update lead/customer records
5. Schedule appointments
6. Log communications
7. Create estimates

Return your response as JSON with this structure:
{
  "analysis": "Your analysis of the situation",
  "recommended_actions": [
    {
      "action_type": "send_email" | "send_sms" | "create_task" | "update_record" | "schedule_appointment" | "log_communication",
      "reason": "Why you're taking this action",
      "data": {
        // Action-specific data
      }
    }
  ],
  "next_steps": "What should happen next",
  "confidence_score": 0-100
}

Be proactive, professional, and focus on converting leads and delighting customers!`;

        console.log('🤖 Calling AI for decision making...');

        const response = await base44.integrations.Core.InvokeLLM({
            prompt,
            response_json_schema: {
                type: "object",
                properties: {
                    analysis: { type: "string" },
                    recommended_actions: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                action_type: { type: "string" },
                                reason: { type: "string" },
                                data: { type: "object" }
                            }
                        }
                    },
                    next_steps: { type: "string" },
                    confidence_score: { type: "number" }
                }
            }
        });

        console.log('✅ Lexi decision:', JSON.stringify(response, null, 2));

        // Execute the recommended actions
        const executionResults = [];
        
        for (const action of response.recommended_actions || []) {
            try {
                if (action.action_type === 'send_email') {
                    await base44.asServiceRole.integrations.Core.SendEmail({
                        to: action.data.to,
                        subject: action.data.subject,
                        body: action.data.body,
                        from_name: action.data.from_name || 'Lexi - AI Assistant'
                    });
                    executionResults.push({ action: 'send_email', status: 'success', to: action.data.to });
                }
                
                if (action.action_type === 'send_sms') {
                    await base44.functions.invoke('sendSMS', {
                        to: action.data.to,
                        message: action.data.message,
                        contactName: action.data.contact_name
                    });
                    executionResults.push({ action: 'send_sms', status: 'success', to: action.data.to });
                }
                
                if (action.action_type === 'create_task') {
                    await base44.asServiceRole.entities.Task.create(action.data);
                    executionResults.push({ action: 'create_task', status: 'success' });
                }
                
                if (action.action_type === 'update_record' && entityType === 'Lead') {
                    await base44.asServiceRole.entities.Lead.update(entityId, action.data);
                    executionResults.push({ action: 'update_lead', status: 'success' });
                }
                
                if (action.action_type === 'log_communication') {
                    await base44.asServiceRole.entities.Communication.create(action.data);
                    executionResults.push({ action: 'log_communication', status: 'success' });
                }
            } catch (actionError) {
                console.error('❌ Action failed:', action.action_type, actionError.message);
                executionResults.push({ action: action.action_type, status: 'failed', error: actionError.message });
            }
        }

        return Response.json({
            success: true,
            lexi_analysis: response.analysis,
            actions_taken: executionResults.length,
            next_steps: response.next_steps,
            confidence: response.confidence_score,
            execution_results: executionResults
        });

    } catch (error) {
        console.error('💥 Lexi Agent Error:', error);
        return Response.json({ 
            error: error.message,
            details: error.toString()
        }, { status: 500 });
    }
});