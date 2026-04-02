import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { fetchActivityLog, formatActivityLogForPrompt } from './utils/activityLogUtils.ts';

Deno.serve(async (req) => {
  console.log('🚀 Lexi Chat - Unified Identity Gate (Voice + Text)');
  
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Please log in to use Lexi' }, { status: 401 });
    }
    
    console.log('✅ Authenticated:', user.email);

    const body = await req.json();
    const { message, conversationHistory, companyId, userEmail, userName, userIdentity, mode, file_urls } = body;

    // 🔒 PLATFORM OWNER CHECK
    const isPlatformOwner = user.platform_role === 'super_admin';
    let isSuperAdmin = isPlatformOwner;

    // Check if user is super admin via staff profile
    if (!isSuperAdmin) {
      const allStaffProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ user_email: user.email });
      isSuperAdmin = allStaffProfiles.some(sp => sp.is_super_admin);
    }

    // 🎯 UNIFIED IDENTITY GATE
    // Priority 1: Use the passed userIdentity from the voice stream
    // Priority 2: Use the passed userEmail (legacy)
    // Priority 3: Use the standard auth session (for text chat)
    // This ensures Lexi Voice + Lexi Text use identical CRM access rules.
    const effectiveUserEmail = userIdentity || userEmail || user.email;
    const effectiveUserName = userName || user.full_name;
    const inputMode = mode || 'text'; // Track if this came from voice or text

    console.log('🧠 lexiChat - User:', effectiveUserEmail, '|', effectiveUserName, '| Platform Owner:', isPlatformOwner);

    // 🏢 Company Detection & Security Verification - PARALLEL
    const [ownedCompanies, staffProfiles] = await Promise.all([
      base44.asServiceRole.entities.Company.filter({ created_by: effectiveUserEmail }),
      base44.asServiceRole.entities.StaffProfile.filter({ user_email: effectiveUserEmail })
    ]);
    
    // Build set of allowed company IDs
    const allowedCompanyIds = new Set([
      ...ownedCompanies.map(c => c.id),
      ...staffProfiles.map(sp => sp.company_id)
    ].filter(Boolean));

    let actualCompanyId = null;

    if (companyId) {
      // Platform owners can access ANY company (for impersonation/support)
      if (isSuperAdmin) {
        console.log('🔓 Platform owner access granted to company:', companyId);
        actualCompanyId = companyId;
      } else if (allowedCompanyIds.has(companyId)) {
        actualCompanyId = companyId;
      } else {
        console.warn(`🚨 SECURITY ALERT: User ${user.email} attempted to access unauthorized company ${companyId}`);
        return Response.json({ error: 'Unauthorized: You do not have access to this company.' }, { status: 403 });
      }
    } else {
      actualCompanyId = ownedCompanies[0]?.id || staffProfiles[0]?.company_id;
    }
    
    if (!actualCompanyId) {
      return Response.json({
        response: "I couldn't identify your company. Please set up your company profile first.",
        error: 'No company found'
      });
    }

    const companies = await base44.asServiceRole.entities.Company.filter({ id: actualCompanyId });
    const company = companies?.[0];
    
    if (!company) {
      console.error('❌ CRITICAL: Company not found for ID:', actualCompanyId);
      return Response.json({ error: 'Company not found' }, { status: 404 });
    }
    
    console.log('🏢 VERIFIED Company:', company.company_name, '| ID:', actualCompanyId, '| Owner:', company.created_by);
    
    // SECURITY: Verify this company ID is allowed for this user
    if (!allowedCompanyIds.has(actualCompanyId)) {
      console.error('🚨 SECURITY BREACH ATTEMPT: User tried to access unauthorized company');
      return Response.json({ error: 'Unauthorized company access' }, { status: 403 });
    }

    // 👤 DETERMINE USER ROLE & ACCESS LEVEL
    const isCompanyOwner = company.created_by === effectiveUserEmail;
    let userStaffProfile = null;
    let isAdmin = isCompanyOwner; // Company owners are always admins

    if (!isCompanyOwner) {
      // Check if user has a staff profile for this company
      const userProfiles = await base44.asServiceRole.entities.StaffProfile.filter({ 
        user_email: effectiveUserEmail, 
        company_id: actualCompanyId 
      });
      userStaffProfile = userProfiles?.[0];
      if (userStaffProfile) {
        const ownerCompanies = await base44.asServiceRole.entities.Company.filter({ id: actualCompanyId });
        const companyOwnerEmail = ownerCompanies?.[0]?.created_by;
        isAdmin = (effectiveUserEmail === companyOwnerEmail) || userStaffProfile.is_super_admin;
        console.log(`📋 Staff Role: ${userStaffProfile.role_name || 'N/A'}, Admin: ${isAdmin}`);
      }
    }

    // Helper function to apply role-based filters
    // ⚠️ CRITICAL: All CRM tool calls pass through this filter
    // Whether voice or text, effectiveUserEmail is enforced here
    const applyRoleFilter = (baseFilter) => {
      if (isAdmin) {
        return baseFilter; // Admins see all data
      }
      // Non-admins only see their assigned records
      return { ...baseFilter, assigned_to_users: { "$in": [effectiveUserEmail] } };
    };
    
    // Get customer context for Lexi - with timeout to prevent hanging
    let customerList = '(Customer context loading...)';
    try {
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('(Customer context unavailable)'), 3000));
      const loadPromise = base44.asServiceRole.entities.Customer.filter({ company_id: actualCompanyId }, '-created_date', 50);
      const companyCustomers = await Promise.race([loadPromise, timeoutPromise]);
      
      if (Array.isArray(companyCustomers) && companyCustomers.length > 0) {
        customerList = companyCustomers.map(c => `${c.name} (${c.email || c.phone || 'no contact'})`).join(', ');
      } else {
        customerList = '(No customers yet)';
      }
    } catch (err) {
      console.warn('Customer context load failed:', err.message);
      customerList = '(Customer context unavailable)';
    }

    // 🧠 Load AIMemory knowledge base
    let knowledgeBase = '';
    try {
      const memories = await base44.asServiceRole.entities.AIMemory.filter({ 
        company_id: actualCompanyId,
        is_active: true 
      }, '-importance', 100);
      
      if (memories && memories.length > 0) {
        knowledgeBase = '\n\n📚 COMPANY KNOWLEDGE BASE:\n' + 
          memories.map(m => `- ${m.title}: ${m.content}`).join('\n');
        console.log(`✅ Loaded ${memories.length} knowledge base entries`);
      } else {
        console.log('ℹ️ No knowledge base entries found');
      }
    } catch (err) {
      console.warn('Knowledge base load failed:', err.message);
    }

    const openaiKey = Deno.env.get('Open_AI_Api_Key');
    if (!openaiKey) {
      return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    }

    // 🔍 CHECK LIMITS
    try {
      // Dynamic import to avoid static import errors if file doesn't exist
      const checkLimitModule = await import('./utils/checkSubscriptionLimit.js').catch(() => null);
      if (checkLimitModule) {
        const limitCheck = await checkLimitModule.checkSubscriptionLimit(base44, actualCompanyId, 'lexi');
        if (!limitCheck.allowed) {
          return Response.json({
            response: `You've reached your monthly limit for Lexi messages on the ${limitCheck.plan} plan (${limitCheck.current_usage}/${limitCheck.limit}). Please upgrade to continue chatting.`,
            error: 'Limit reached'
          });
        }
      }
    } catch (e) {
      console.error('Limit check error:', e);
    }

    // 📊 TRACK USAGE (non-blocking)
    try {
      const existingUsage = await base44.asServiceRole.entities.SubscriptionUsage.filter({
        company_id: actualCompanyId
      });

      if (existingUsage && existingUsage.length > 0) {
        const record = existingUsage[0];
        await base44.asServiceRole.entities.SubscriptionUsage.update(record.id, {
          ai_used: (record.ai_used || 0) + 1,
          last_reset_date: new Date().toISOString()
        });
      }
      // Don't create new usage records - handled elsewhere
    } catch (err) {
      // Non-blocking - don't fail the request for tracking issues
      console.warn('Usage tracking skipped:', err.message);
    }

    // 📚 TOOLS
    const tools = [
      {
        type: 'function',
        function: {
          name: 'get_crm_data',
          description: 'Get counts and details from CRM - customers, leads, estimates, invoices, tasks, projects, payments, etc.',
          parameters: {
            type: 'object',
            properties: {
              data_type: { 
                type: 'string', 
                enum: ['customers', 'leads', 'estimates', 'invoices', 'tasks', 'projects', 'payments', 'staff', 'calendar_events'],
                description: 'What type of data to retrieve'
              },
              filters: {
                type: 'object',
                description: 'Optional filters like status, date range, etc.'
              }
            },
            required: ['data_type']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_calendar_events',
          description: 'Get calendar events for a specific date range. ALWAYS use this to check schedule availability.',
          parameters: {
            type: 'object',
            properties: {
              start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
              end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' }
            },
            required: ['start_date']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_calendar_event',
          description: 'Create a calendar event and sync to Google Calendar. ALWAYS extract title, date/time, and attendee info. Use ISO format with timezone. Examples: "schedule meeting tomorrow at 4pm" → title="Meeting", start_time="YYYY-MM-DDT16:00:00-05:00". "meeting with Ali at 3" → title="Meeting with Ali", start_time with 3pm.',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'Event title (include attendee names if mentioned, e.g., "Meeting with Ali")' },
              start_time: { type: 'string', description: 'ISO datetime with timezone (e.g., "2026-02-09T16:00:00-05:00" for 4 PM Eastern)' },
              end_time: { type: 'string', description: 'ISO datetime (optional, defaults to 1 hour after start)' },
              location: { type: 'string', description: 'Meeting location if mentioned' },
              description: { type: 'string', description: 'Additional details about the meeting' },
              event_type: { type: 'string', enum: ['meeting', 'appointment', 'call', 'inspection', 'other'], description: 'Type of event' },
              attendees: { type: 'string', description: 'Names of people attending (extracted from user message)' }
            },
            required: ['title', 'start_time']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_task',
          description: 'Create a new task',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              assigned_to: { type: 'string' },
              due_date: { type: 'string' },
              priority: { type: 'string', enum: ['low', 'medium', 'high'] }
            },
            required: ['name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_lead',
          description: 'Create a new lead. Extract name, phone, email, and address details.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              street: { type: 'string' },
              city: { type: 'string' },
              state: { type: 'string' },
              zip: { type: 'string' },
              notes: { type: 'string' },
              source: { type: 'string', description: 'Source of the lead (e.g., "manual", "referral")' }
            },
            required: ['name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_customer',
          description: 'Create a new customer. Extract name, phone, email, and address details.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              street: { type: 'string' },
              city: { type: 'string' },
              state: { type: 'string' },
              zip: { type: 'string' },
              notes: { type: 'string' }
            },
            required: ['name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'send_email',
          description: 'Send an email to a customer or lead',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string' },
              subject: { type: 'string' },
              message: { type: 'string' },
              contact_name: { type: 'string' }
            },
            required: ['to', 'subject', 'message']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'send_sms',
          description: 'Send a text message to a customer or lead',
          parameters: {
            type: 'object',
            properties: {
              to: { type: 'string' },
              message: { type: 'string' },
              contact_name: { type: 'string' }
            },
            required: ['to', 'message']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'manage_entity',
          description: 'General purpose tool to Create, Update, or List ANY entity in the CRM. Use this for Subcontractor, Lead, Customer, Note, Project, Estimate, Invoice, StaffProfile, Workflow, etc. For Subcontractors: include name, phone, email, contact_person, base_address, service_radius, specialty (array), notes, availability, hourly_rate, per_sq_rate, per_job_rate, is_active. NOTE: For DELETE operations, use propose_action instead — deletions require human approval.',
          parameters: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['create', 'update', 'list'], description: 'Action to perform (use propose_action for deletes)' },
              entity_name: { type: 'string', description: 'Name of the entity (e.g., Subcontractor, Lead, Customer, Project, Note, Task, Workflow)' },
              data: { type: 'object', description: 'Data fields for create/update (e.g., { "name": "John", "status": "active" })' },
              id: { type: 'string', description: 'ID of the entity (required for update)' }
            },
            required: ['action', 'entity_name']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'propose_action',
          description: 'Propose a sensitive action (like deletion or bulk changes) that requires human approval before execution. Use this instead of directly deleting records. The human will see an approval card and must click Approve to proceed.',
          parameters: {
            type: 'object',
            properties: {
              action_type: { type: 'string', enum: ['delete_entity', 'bulk_update', 'reassign'], description: 'Type of action to propose' },
              entity_name: { type: 'string', description: 'Name of the entity affected (e.g., Customer, Lead, Invoice)' },
              entity_id: { type: 'string', description: 'ID of the specific record to act on' },
              entity_label: { type: 'string', description: 'Human-readable label for the record (e.g., the customer name or lead name)' },
              reason: { type: 'string', description: 'Why this action is being proposed — brief explanation' }
            },
            required: ['action_type', 'entity_name', 'entity_id', 'entity_label', 'reason']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'find_subcontractors',
          description: 'Search for subcontractors by service area/territory and/or specialty. Use this ALWAYS when user asks "what subs are in [area]", "find subcontractors near [city/state]", "who covers [territory]", "any roofers in [area]", etc. This is the correct tool for subcontractor territory lookups — NOT manage_entity, NOT get_crm_data.',
          parameters: {
            type: 'object',
            properties: {
              area: { type: 'string', description: 'City, state, zip code, or territory name to search within (e.g. "Ohio", "Cleveland", "44146", "Northeast Ohio")' },
              specialty: { type: 'string', description: 'Optional: trade specialty to filter by (e.g. "Roofing", "Siding", "Gutters")' }
            },
            required: []
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'assign_inspection',
          description: 'Create and assign a CrewCam inspection job to a staff member. Use this when user asks to "assign an inspection", "create a CrewCam job", "schedule an inspection", "create an assignment", "create crewcam assignment", or mentions CrewCam. This is part of the CRM system.',
          parameters: {
            type: 'object',
            properties: {
              client_name: { type: 'string', description: 'Client/customer name' },
              client_phone: { type: 'string', description: 'Client phone number' },
              client_email: { type: 'string', description: 'Client email address' },
              property_address: { type: 'string', description: 'Property address for inspection (can be "TBD" or "Fake Address" for test)' },
              assigned_to_email: { type: 'string', description: 'Email of staff member to assign to. If user provides a name, look up the staff list first using get_crm_data with data_type="staff" to find their email.' },
              inspection_date: { type: 'string', description: 'Scheduled date (YYYY-MM-DD)' },
              inspection_time: { type: 'string', description: 'Scheduled time (HH:MM in 24hr format)' },
              damage_type: { type: 'string', description: 'Type of damage (e.g., hail, wind, water)' },
              special_instructions: { type: 'string', description: 'Special instructions or notes' },
              create_calendar_event: { type: 'boolean', description: 'Whether to create a calendar event' },
              create_lead: { type: 'boolean', description: 'Whether to create a lead in CRM' },
              create_task: { type: 'boolean', description: 'Whether to create a task' }
            },
            required: ['client_name', 'property_address', 'assigned_to_email']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_activity_log',
          description: 'Query the Global Activity Log — a chronological feed of ALL actions taken across the CRM (leads added, SMS sent, estimates created, invoices, tasks, customers, workflow executions) regardless of which user performed them. Use this when the user asks "what have we done?", "what\'s been happening?", "show me recent activity", "what actions were taken today?", "give me a summary of recent changes", or any question about org-wide recent history. This performs a REAL database query across all modules — not just session memory.',
          parameters: {
            type: 'object',
            properties: {
              limit: {
                type: 'number',
                description: 'Number of recent events to return (default 20, max 50)'
              },
              module: {
                type: 'string',
                enum: ['leads', 'communications', 'estimates', 'invoices', 'tasks', 'customers', 'workflow', 'all'],
                description: 'Filter to a specific module. Omit or use "all" for everything.'
              },
              days: {
                type: 'number',
                description: 'Only return events from the last N days (optional)'
              }
            },
            required: []
          }
        }
      }
    ];

    // Dynamic Date Calculation
    const now = new Date();
    const userTimeZone = 'America/New_York';
    const currentDateString = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: userTimeZone });
    const todayISO = now.toISOString().split('T')[0];
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowISO = tomorrow.toISOString().split('T')[0];

    // 📊 INSTRUCTION 3: Load last 15 org-wide events for context injection
    let recentActivityContext = '';
    try {
      const recentEvents = await Promise.race([
        fetchActivityLog(base44, actualCompanyId, 15),
        new Promise<any[]>(resolve => setTimeout(() => resolve([]), 3000))
      ]);
      if (recentEvents.length > 0) {
        recentActivityContext = '\n\n📊 RECENT ORGANIZATION ACTIVITY (last 15 events across all modules):\n' +
          formatActivityLogForPrompt(recentEvents) +
          '\n\nUse this context to answer questions like "what have we done recently?" or "what\'s been happening?" without needing to call a tool first.';
        console.log(`✅ Activity context loaded: ${recentEvents.length} events`);
      }
    } catch (err) {
      console.warn('Activity context load failed:', err.message);
    }

    const systemPrompt = `You are Lexi, a friendly and professional AI assistant for ${company.company_name}.

👤 USER CONTEXT:
- Current User: ${effectiveUserName || effectiveUserEmail}
- Role: ${isAdmin ? 'Administrator' : userStaffProfile?.role_name || 'Staff Member'}
- Access Level: ${isAdmin ? 'Full company access' : 'Own assigned records only'}

📋 COMPANY CONTEXT:
- Company Name: ${company.company_name}
- Your CRM System: CompanySync
- Customers in ${company.company_name}: ${customerList}${knowledgeBase}${recentActivityContext}

🗣️ NATURAL COMMUNICATION STYLE:
- Speak conversationally and naturally, like a helpful colleague
- Summarize information instead of reading raw data verbatim
- Use common phrases: "10 AM Eastern" instead of "10:00 AM (EST)"
- Group similar items: "You have two meetings tomorrow" instead of listing every detail
- Avoid technical jargon - speak like a human, not a database
- Keep responses concise and friendly
- Only provide full details when specifically asked

🔒 CRITICAL SECURITY RULES:
1. You work EXCLUSIVELY for ${company.company_name}. This is your ONLY client.
2. You CANNOT access data from any other company (including Salesforce, HubSpot, or any external systems).
3. When asked "what is the name of this company" or "what company am I with", ALWAYS answer: "${company.company_name}".
4. Your CRM platform is called "CompanySync" - NEVER mention external CRM names like Salesforce or HubSpot.
5. If you don't have information, say you don't know - DO NOT make up information or reference other companies.

✅ FEATURES YOU CAN USE (all part of CompanySync):
- **CrewCam**: This IS part of CompanySync! Use 'assign_inspection' tool to create inspection jobs/assignments
- **Subcontractors**: Use 'manage_entity' with entity_name "Subcontractor" to add/edit subcontractors. Fields: name, phone, email, contact_person, base_address, service_radius, specialty (array like ["Roofing"]), notes, availability, hourly_rate, per_sq_rate, per_job_rate, is_active
  - **⚠️ TERRITORY SEARCHES → USE find_subcontractors TOOL**: When user asks "what subs are in [area]", "find subs near [city]", "who covers [territory]", "any [trade] in [area]" — ALWAYS call the `find_subcontractors` tool. Pass the area and optional specialty. This is the ONLY correct tool for area/territory lookups.
  - **Staff vs Subcontractors**: Staff = internal employees (StaffProfile). Subcontractors = external vendors (Subcontractor entities). NEVER confuse these. If someone asks about subs or vendors, use Subcontractor entities only.
- Calendar events, tasks, leads, customers, estimates, invoices, payments
- Email and SMS communication

🚨 IMPORTANT: When user mentions "CrewCam", "crewcam", "inspection", or "assignment" - these ARE CompanySync features!
Use the 'assign_inspection' tool immediately. Do NOT say you can't help with CrewCam - it's built into this CRM.

🎯 CAPABILITIES:
- You can create, update, and list any CRM entity using 'manage_entity'. You can also read Workflows and update them.
- If a user asks to "add a note" or "change status", use the 'manage_entity' tool.
- Access CRM data, calendar, tasks, emails, and SMS.
- CrewCam inspections: Use 'assign_inspection' tool to create and assign inspection jobs. CrewCam is part of this CRM system.

🔐 EXECUTIVE REVIEW RULES (FOLLOW EXACTLY):
1. NEVER directly delete any record. Always use 'propose_action' with action_type='delete_entity'. The human must approve.
2. You CANNOT modify these protected areas — they require a human: BillingSettings, SecuritySettings, StripeConfig, TwilioConfig, StaffProfile permissions. If asked, politely decline and explain why.
3. When you call 'propose_action', explain to the user that you've queued it for their approval and they can approve it in the Lexi Approvals panel.
4. You can freely read and edit Workflows, Tasks, Leads, Customers, Projects, and Estimates.

🚨 CRITICAL RULES:
1. ALWAYS use tools. Never guess or give fake confirmations.
2. For "how many X", use get_crm_data.
3. For calendar events: IMMEDIATELY use create_calendar_event tool when user says "schedule", "create event", "add to calendar", "meeting at", etc.
4. NEVER confirm an event was created without actually calling create_calendar_event first.
5. Extract date/time naturally: "tomorrow at 4pm" = tomorrow's date + 16:00:00, "at 3" = 15:00:00.
6. Include attendee names in the title (e.g., "Meeting with Ali").
7. If the user asks to modify data (e.g., "update customer phone"), use 'manage_entity'.
8. For DELETE requests: use 'propose_action' — never call manage_entity with action='delete'.
9. When the user asks "what have we done?", "what's been happening?", "show me recent activity", "give me a summary of recent changes", or any question about org-wide history — call get_activity_log to perform a real database query across all modules. You may also use the RECENT ORGANIZATION ACTIVITY context already injected above for a quick answer.

📅 DATE CONTEXT:
- Current Date: ${currentDateString}
- Timezone: ${userTimeZone}
- Today Example: "${todayISO}T16:00:00-05:00" (4 PM)
- Tomorrow Example: "${tomorrowISO}T09:00:00-05:00" (9 AM)
- ALWAYS use ISO format with the correct timezone offset for ${userTimeZone}.

Current Time: ${now.toLocaleString('en-US', { timeZone: userTimeZone })}`;
    
    const formattedHistory = (conversationHistory || [])
      .slice(-10)
      .filter(msg => msg?.role && msg?.content)
      .map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));

    // 📎 PROCESS ATTACHED FILES (images + PDFs)
    let fileContextText = '';
    let imageUrls: { type: string; image_url: { url: string; detail: string } }[] = [];

    if (file_urls && Array.isArray(file_urls) && file_urls.length > 0) {
      console.log('📎 Processing', file_urls.length, 'attached file(s)');
      for (const fileObj of file_urls) {
        const fileUrl = typeof fileObj === 'string' ? fileObj : fileObj.url;
        const fileName = typeof fileObj === 'string' ? fileObj : (fileObj.name || '');
        if (!fileUrl) continue;

        const mimeType = typeof fileObj === 'object' && fileObj.type ? fileObj.type : '';
        const isPDF = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf') || fileUrl.toLowerCase().includes('.pdf') || fileUrl.toLowerCase().includes('application/pdf');
        const isImage = mimeType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(fileUrl) || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);

        if (isPDF) {
          // Read PDF with Claude for text extraction
          try {
            console.log('📄 Reading PDF via Claude:', fileUrl);
            const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
            if (anthropicKey) {
              const pdfResponse = await fetch(fileUrl);
              if (pdfResponse.ok) {
                const pdfBuffer = await pdfResponse.arrayBuffer();
                const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));

                const { default: Anthropic } = await import('npm:@anthropic-ai/sdk@0.32.1');
                const anthropic = new Anthropic({ apiKey: anthropicKey });

                const claudeResp = await anthropic.messages.create({
                  model: 'claude-3-5-sonnet-20241022',
                  max_tokens: 4096,
                  messages: [{
                    role: 'user',
                    content: [
                      {
                        type: 'document',
                        source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 }
                      },
                      {
                        type: 'text',
                        text: 'Please read this PDF document carefully and extract all the text and important information from it. Preserve the structure, names, numbers, and all details accurately.'
                      }
                    ]
                  }]
                });

                const extractedText = claudeResp.content.find((b: { type: string }) => b.type === 'text');
                if (extractedText && 'text' in extractedText) {
                  fileContextText += `\n\n--- ATTACHED PDF CONTENT ---\n${extractedText.text}\n--- END OF PDF ---`;
                  console.log('✅ PDF extracted successfully');
                }
              }
            }
          } catch (pdfErr) {
            console.error('❌ PDF read error:', pdfErr);
            fileContextText += '\n\n[Note: A PDF was attached but could not be read]';
          }
        } else if (isImage) {
          // Include image for vision
          imageUrls.push({ type: 'image_url', image_url: { url: fileUrl, detail: 'high' } });
          console.log('🖼️ Image added for vision:', fileUrl);
        }
      }
    }

    // Build the user message content (text + optional images)
    const userTextContent = (message || 'Hello') + fileContextText;
    const userMessageContent = imageUrls.length > 0
      ? [{ type: 'text', text: userTextContent }, ...imageUrls]
      : userTextContent;

    // Use gpt-4o when vision is needed, otherwise gpt-4o-mini
    const selectedModel = imageUrls.length > 0 ? 'gpt-4o' : 'gpt-4o-mini';

    // 🔄 EXECUTION LOOP
    let currentMessages = [
      { role: 'system', content: systemPrompt },
      ...formattedHistory,
      { role: 'user', content: userMessageContent }
    ];

    let finalResponse = "";
    const actionsExecuted = [];
    const MAX_TURNS = 10; // Increased for longer conversations
    let turnCount = 0;

    while (turnCount < MAX_TURNS) {
      turnCount++;
      console.log(`📞 Turn ${turnCount}: Calling OpenAI...`);
      
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiKey}`
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: currentMessages,
          tools,
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 2048
        })
      });

      const data = await response.json();
      if (data.error) {
        console.error('OpenAI Error:', data.error);
        throw new Error(`OpenAI Error: ${data.error.message}`);
      }

      const choice = data.choices[0];
      const responseMessage = choice.message;
      const toolCalls = responseMessage.tool_calls;

      currentMessages.push(responseMessage);
      finalResponse = responseMessage.content;

      if (!toolCalls || toolCalls.length === 0) {
        break;
      }

      console.log('🔧 Executing', toolCalls.length, 'tools');
      
      // Execute each tool call
      for (const toolCall of toolCalls) {
        const fname = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments || '{}');
        console.log('🔨', fname, JSON.stringify(args));

        try {
          let toolResultContent = null;

          // Special case: tools that require confirmation and exit immediately
          if (fname === 'send_email') {
            return Response.json({
              response: `I'd like to send an email:\n\n**To:** ${args.to}\n**Subject:** ${args.subject}\n\n${args.message}\n\nShall I send this?`,
              requires_confirmation: true,
              proposed_action: { type: 'email', ...args }
            });
          }
          
          if (fname === 'send_sms') {
            return Response.json({
              response: `I'd like to send a text message:\n\n**To:** ${args.to}\n\n${args.message}\n\nShall I send this?`,
              requires_confirmation: true,
              proposed_action: { type: 'sms', ...args }
            });
          }

          // Regular tools
          if (fname === 'get_crm_data') {
            const dataType = args.data_type;
            let result = { count: 0, data: [] };

            if (dataType === 'customers') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              console.log('🔍 Customer query:', JSON.stringify(query));
              const allCustomers = await base44.asServiceRole.entities.Customer.filter(query, '-created_date', 200);
              console.log('👥 Found', allCustomers.length, 'customers');
              result = { count: allCustomers.length, sample: allCustomers.map(c => ({ name: c.name, email: c.email })) };
              actionsExecuted.push({ tool_name: 'get_customers', result: `Found ${allCustomers.length} customers` });
            } else if (dataType === 'leads') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              const filtered = await base44.asServiceRole.entities.Lead.filter(query, '-created_date', 500);
              // Sort by created_date descending so "last added" queries work correctly
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              result = {
                count: filtered.length,
                most_recent: filtered[0] ? { name: filtered[0].name, status: filtered[0].status, phone: filtered[0].phone, email: filtered[0].email, created_date: filtered[0].created_date, lead_source: filtered[0].lead_source } : null,
                leads: filtered.map((l: any) => ({ name: l.name, status: l.status, phone: l.phone, email: l.email, assigned_to: l.assigned_to, created_date: l.created_date, lead_source: l.lead_source, address: l.address, city: l.city, state: l.state, notes: l.notes }))
              };
              actionsExecuted.push({ tool_name: 'get_leads', result: `Found ${filtered.length} leads` });
            } else if (dataType === 'estimates') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              const filtered = await base44.asServiceRole.entities.Estimate.filter(query, '-created_date', 200);
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              result = {
                count: filtered.length,
                most_recent: filtered[0] ? { customer_name: filtered[0].customer_name, status: filtered[0].status, total: filtered[0].total, created_date: filtered[0].created_date } : null,
                estimates: filtered.slice(0, 30).map((e: any) => ({ customer_name: e.customer_name, status: e.status, total: e.total, created_date: e.created_date, assigned_to: e.assigned_to }))
              };
              actionsExecuted.push({ tool_name: 'get_estimates', result: `Found ${filtered.length} estimates` });
            } else if (dataType === 'invoices') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              const filtered = await base44.asServiceRole.entities.Invoice.filter(query, '-created_date', 200);
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              const totalRevenue = filtered.reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
              const totalPaid = filtered.reduce((sum: number, inv: any) => sum + (inv.amount_paid || 0), 0);
              result = {
                count: filtered.length,
                total_revenue: totalRevenue,
                total_paid: totalPaid,
                most_recent: filtered[0] ? { customer_name: filtered[0].customer_name, amount: filtered[0].amount, status: filtered[0].status, created_date: filtered[0].created_date } : null,
                invoices: filtered.slice(0, 30).map((i: any) => ({ customer_name: i.customer_name, amount: i.amount, amount_paid: i.amount_paid, status: i.status, created_date: i.created_date }))
              };
              actionsExecuted.push({ tool_name: 'get_invoices', result: `Found ${filtered.length} invoices` });
            } else if (dataType === 'tasks') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              const filtered = await base44.asServiceRole.entities.Task.filter(query, '-created_date', 200);
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              result = {
                count: filtered.length,
                most_recent: filtered[0] ? { name: filtered[0].name, status: filtered[0].status, assigned_to: filtered[0].assigned_to, due_date: filtered[0].due_date } : null,
                tasks: filtered.slice(0, 30).map((t: any) => ({ name: t.name, status: t.status, assigned_to: t.assigned_to, due_date: t.due_date, priority: t.priority, created_date: t.created_date }))
              };
              actionsExecuted.push({ tool_name: 'get_tasks', result: `Found ${filtered.length} tasks` });
            } else if (dataType === 'projects') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              const filtered = await base44.asServiceRole.entities.Project.filter(query, '-created_date', 200);
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              result = {
                count: filtered.length,
                most_recent: filtered[0] ? { name: filtered[0].name, status: filtered[0].status, customer_name: filtered[0].customer_name, created_date: filtered[0].created_date } : null,
                projects: filtered.slice(0, 30).map((p: any) => ({ name: p.name, status: p.status, customer_name: p.customer_name, assigned_to: p.assigned_to, created_date: p.created_date }))
              };
              actionsExecuted.push({ tool_name: 'get_projects', result: `Found ${filtered.length} projects` });
            } else if (dataType === 'payments') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              const filtered = await base44.asServiceRole.entities.Payment.filter(query, '-created_date', 200);
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              const totalPayments = filtered.reduce((sum: number, pmt: any) => sum + (pmt.amount || 0), 0);
              result = {
                count: filtered.length,
                total_amount: totalPayments,
                most_recent: filtered[0] ? { customer_name: filtered[0].customer_name, amount: filtered[0].amount, created_date: filtered[0].created_date } : null,
                payments: filtered.slice(0, 30).map((p: any) => ({ customer_name: p.customer_name, amount: p.amount, payment_method: p.payment_method, created_date: p.created_date }))
              };
              actionsExecuted.push({ tool_name: 'get_payments', result: `Found ${filtered.length} payments` });
            } else if (dataType === 'staff') {
              const filtered = await base44.asServiceRole.entities.StaffProfile.filter({ company_id: actualCompanyId }, '-created_date', 200);
              console.log('📋 Found', filtered.length, 'staff members');
              result = { count: filtered.length, staff: filtered.map((s: any) => ({ name: s.full_name, email: s.user_email, role: s.role_name, phone: s.phone })) };
              actionsExecuted.push({ tool_name: 'get_staff', result: `Found ${filtered.length} staff` });
            } else if (dataType === 'calendar_events') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              const filtered = await base44.asServiceRole.entities.CalendarEvent.filter(query, '-start_time', 200);
              result = {
                count: filtered.length,
                events: filtered.slice(0, 50).map((e: any) => ({ title: e.title, start: e.start_time, event_type: e.event_type, location: e.location, assigned_to: e.assigned_to }))
              };
              actionsExecuted.push({ tool_name: 'get_events', result: `Found ${filtered.length} events` });
            }
            toolResultContent = JSON.stringify(result);

          } else if (fname === 'get_activity_log') {
            // INSTRUCTION 1 + 2: Global Activity Log — real DB query across all modules
            const limit = Math.min(args.limit || 20, 50);
            const moduleFilter = (args.module && args.module !== 'all') ? args.module : undefined;

            console.log(`📊 get_activity_log: limit=${limit}, module=${moduleFilter || 'all'}`);

            let events = await fetchActivityLog(base44, actualCompanyId, limit, moduleFilter);

            // Optional day filter
            if (args.days && args.days > 0) {
              const cutoff = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);
              events = events.filter(e => new Date(e.timestamp) >= cutoff);
            }

            // Group by module for summary
            const byModule: Record<string, number> = {};
            for (const e of events) {
              byModule[e.module] = (byModule[e.module] || 0) + 1;
            }

            actionsExecuted.push({ tool_name: 'get_activity_log', result: `Retrieved ${events.length} events across ${Object.keys(byModule).length} modules` });
            toolResultContent = JSON.stringify({
              count: events.length,
              summary_by_module: byModule,
              events: events.map(e => ({
                timestamp: e.timestamp,
                module: e.module,
                action: e.action,
                description: e.description,
                actor: e.actor
              }))
            });

          } else if (fname === 'get_calendar_events') {
          const startDate = args.start_date;
          const endDate = args.end_date || startDate;

          console.log('📅 Calendar query for user:', effectiveUserEmail);

          // Sync triggers - use service role but with the effective user context
          try {
             await base44.asServiceRole.functions.invoke('syncGoogleCalendar', { companyId: actualCompanyId, userEmail: effectiveUserEmail });
          } catch (e) { console.log('Sync error:', e.message); }

          // For non-admins, filter to their own events
          const calendarQuery = isAdmin 
            ? { company_id: actualCompanyId }
            : { company_id: actualCompanyId, assigned_to: effectiveUserEmail };
          const allEvents = await base44.asServiceRole.entities.CalendarEvent.filter(calendarQuery, '-start_time', 1000);
            const events = allEvents.filter(e => {
              if (!e.start_time) return false;
              try {
                // Approximate filtering
                const eventDate = new Date(e.start_time).toISOString().split('T')[0];
                return eventDate >= startDate && eventDate <= endDate;
              } catch (err) { return false; }
            }).map(e => ({
              title: e.title,
              start: e.start_time,
              end: e.end_time,
              status: e.status
            }));
            actionsExecuted.push({ tool_name: 'get_calendar', result: `Found ${events.length} events` });
            toolResultContent = JSON.stringify({ count: events.length, events, message: `Found ${events.length} events` });

          } else if (fname === 'create_calendar_event') {
            let startTime = args.start_time;
            let endTime = args.end_time;
            if (!endTime) {
              const d = new Date(startTime);
              d.setHours(d.getHours() + 1);
              endTime = d.toISOString();
            }
            
            // Validate required fields
            if (!args.title || !startTime) {
              toolResultContent = JSON.stringify({ 
                success: false, 
                error: 'Missing required fields: title and start_time are required',
                missing_fields: !args.title ? ['title'] : ['start_time']
              });
            } else {
              const eventData = {
                title: args.title,
                start_time: startTime,
                end_time: endTime,
                location: args.location || '',
                description: args.description || (args.attendees ? `Attendees: ${args.attendees}` : ''),
                event_type: args.event_type || 'meeting',
                status: 'scheduled',
                company_id: actualCompanyId,
                assigned_to: effectiveUserEmail,
                created_by: effectiveUserEmail,
                send_email_notification: true,
                send_browser_notification: true
              };
              
              console.log('📅 Event data with company_id:', actualCompanyId, 'assigned_to:', effectiveUserEmail);
              
              console.log('📅 Creating calendar event:', JSON.stringify(eventData));
              
              const event = await base44.asServiceRole.entities.CalendarEvent.create(eventData);
              console.log('📅 Event created in CRM:', event.id);

              // Sync to Google Calendar
              let googleSyncResult = null;
              try {
                console.log('📅 Syncing to Google Calendar...');
                const syncResponse = await base44.asServiceRole.functions.invoke('syncCRMToGoogleCalendar', { 
                  eventId: event.id 
                });
                googleSyncResult = syncResponse.data;
                console.log('📅 Google sync result:', JSON.stringify(googleSyncResult));
              } catch (syncError) { 
                console.error('📅 Google sync failed:', syncError.message); 
                googleSyncResult = { error: syncError.message };
              }

              actionsExecuted.push({ 
                tool_name: 'create_event', 
                result: `Created: "${args.title}" at ${startTime}`,
                google_sync: googleSyncResult?.success ? 'synced' : 'pending'
              });
              
              toolResultContent = JSON.stringify({ 
                success: true, 
                event_id: event.id, 
                title: args.title,
                start_time: startTime,
                end_time: endTime,
                google_synced: googleSyncResult?.success || false,
                message: `Event "${args.title}" created successfully for ${new Date(startTime).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })}`
              });
            }

          } else if (fname === 'create_task') {
            const taskId = crypto.randomUUID();
            const task = await base44.asServiceRole.entities.Task.create({ id: taskId, ...args, company_id: actualCompanyId, assigned_to: effectiveUserEmail, assigned_to_users: [effectiveUserEmail] });
            actionsExecuted.push({ tool_name: 'create_task', result: `Created task: ${args.name}` });
            toolResultContent = JSON.stringify({ success: true, task_id: task.id });

          } else if (fname === 'create_lead') {
            const leadId = crypto.randomUUID();
            const lead = await base44.asServiceRole.entities.Lead.create({ 
              id: leadId,
              ...args, 
              company_id: actualCompanyId, 
              status: 'new', 
              lead_source: 'Lexi AI',
              assigned_to: effectiveUserEmail,
              assigned_to_users: [effectiveUserEmail]
            });
            actionsExecuted.push({ tool_name: 'create_lead', result: `Created lead: ${args.name}` });
            toolResultContent = JSON.stringify({ success: true, lead_id: lead.id, message: `Lead ${lead.name} created successfully and assigned to you.` });

          } else if (fname === 'create_customer') {
            const customerId = crypto.randomUUID();
            const customer = await base44.asServiceRole.entities.Customer.create({ 
              id: customerId,
              ...args, 
              company_id: actualCompanyId,
              assigned_to: effectiveUserEmail,
              assigned_to_users: [effectiveUserEmail]
            });
            actionsExecuted.push({ tool_name: 'create_customer', result: `Created customer: ${args.name}` });
            toolResultContent = JSON.stringify({ success: true, customer_id: customer.id, message: `Customer ${customer.name} created successfully and assigned to you.` });

          } else if (fname === 'propose_action') {
            const { action_type, entity_name, entity_id, entity_label, reason } = args;
            // Return a confirmation that the action has been queued for human approval
            return Response.json({
              response: `I've queued a **${action_type === 'delete_entity' ? 'deletion' : action_type}** proposal for "${entity_label}" (${entity_name}) for your review.\n\n**Reason:** ${reason}\n\nYou'll see an approval card in the **Lexi Approvals** tab. Please review and approve or reject it there.`,
              requires_confirmation: false,
              proposed_action: {
                type: 'ai_proposed_action',
                action_type,
                entity_name,
                entity_id,
                entity_label,
                reason,
                company_id: actualCompanyId,
                proposed_by: effectiveUserEmail,
              },
              actions_executed: actionsExecuted
            });

          } else if (fname === 'manage_entity') {
            const { action, entity_name, data, id } = args;
            const normalizedEntity = entity_name.charAt(0).toUpperCase() + entity_name.slice(1);

            // 🔒 Block writes to protected system entities
            const PROTECTED_WRITE_ENTITIES = ['BillingSettings', 'SecuritySettings', 'SecurityConfig', 'StripeConfig', 'TwilioConfig'];
            if ((action === 'create' || action === 'update' || action === 'delete') && PROTECTED_WRITE_ENTITIES.includes(normalizedEntity)) {
              toolResultContent = JSON.stringify({
                success: false,
                error: `I'm not allowed to modify ${normalizedEntity} — that table is protected and requires a human administrator. Please update it directly in your Settings page.`
              });
            } else if (action === 'delete') {
              // Redirect delete to propose_action — AI must never delete directly
              return Response.json({
                response: `I can't delete records directly — that requires your approval. Please use the 'propose_action' approach or let me propose it for you. Would you like me to create a deletion proposal for the ${normalizedEntity} record?`,
                requires_confirmation: false,
                actions_executed: actionsExecuted
              });
            } else {
              if (!base44.asServiceRole.entities[normalizedEntity]) {
                throw new Error(`Entity type '${normalizedEntity}' not found.`);
              }

              let result;
              if (action === 'create') {
                const entityId = crypto.randomUUID();
                const payload = { id: entityId, ...data, company_id: actualCompanyId };
                if (!isAdmin && !payload.assigned_to && !payload.assigned_to_users) {
                  payload.assigned_to = effectiveUserEmail;
                  payload.assigned_to_users = [effectiveUserEmail];
                }
                result = await base44.asServiceRole.entities[normalizedEntity].create(payload);
                actionsExecuted.push({ tool_name: 'manage_entity', result: `Created ${normalizedEntity}` });
              } else if (action === 'update') {
                if (!isAdmin) {
                  const existing = await base44.asServiceRole.entities[normalizedEntity].filter({ id });
                  if (existing?.[0] && !existing[0].assigned_to_users?.includes(effectiveUserEmail) && existing[0].assigned_to !== effectiveUserEmail) {
                    throw new Error(`You don't have permission to update this ${normalizedEntity}`);
                  }
                }
                result = await base44.asServiceRole.entities[normalizedEntity].update(id, data);
                actionsExecuted.push({ tool_name: 'manage_entity', result: `Updated ${normalizedEntity}` });
              } else if (action === 'list') {
                const query = applyRoleFilter({ company_id: actualCompanyId });
                result = await base44.asServiceRole.entities[normalizedEntity].filter(query, '-created_date', 20);
                actionsExecuted.push({ tool_name: 'manage_entity', result: `Listed ${normalizedEntity}` });
              }
              toolResultContent = JSON.stringify({ success: true, data: result });
            }
          } else if (fname === 'find_subcontractors') {
            const { area, specialty } = args;
            // Fetch all subcontractors for this company
            const allSubs = await base44.asServiceRole.entities.Subcontractor.filter(
              { company_id: actualCompanyId },
              '-created_date',
              100
            );

            let matched = allSubs || [];

            // Filter by area — match against base_address, city, state, zip (case-insensitive)
            if (area && area.trim()) {
              const keyword = area.trim().toLowerCase();
              matched = matched.filter((sub: any) => {
                const addr = (sub.base_address || sub.city || sub.state || sub.zip || '').toLowerCase();
                const city = (sub.city || '').toLowerCase();
                const state = (sub.state || '').toLowerCase();
                const zip = (sub.zip || '').toLowerCase();
                const notes = (sub.notes || '').toLowerCase();
                // Check keyword in all address-related fields
                return addr.includes(keyword) || city.includes(keyword) ||
                       state.includes(keyword) || zip.includes(keyword) ||
                       notes.includes(keyword) ||
                       // Also try word-level match for abbreviations like "OH" matching "Ohio"
                       addr.split(/[\s,]+/).some((w: string) => w === keyword);
              });
            }

            // Filter by specialty if provided
            if (specialty && specialty.trim()) {
              const spec = specialty.trim().toLowerCase();
              matched = matched.filter((sub: any) => {
                const specs = Array.isArray(sub.specialty) ? sub.specialty : [sub.specialty || ''];
                return specs.some((s: string) => (s || '').toLowerCase().includes(spec));
              });
            }

            const summary = matched.map((sub: any) => ({
              name: sub.name,
              contact: sub.contact_person || '',
              phone: sub.phone || '',
              email: sub.email || '',
              base_address: sub.base_address || '',
              service_radius: sub.service_radius || '',
              specialty: sub.specialty || [],
              availability: sub.availability || '',
              hourly_rate: sub.hourly_rate || null,
              per_sq_rate: sub.per_sq_rate || null,
              is_active: sub.is_active !== false
            }));

            const filterDesc = [area && `area: "${area}"`, specialty && `specialty: "${specialty}"`].filter(Boolean).join(', ');
            actionsExecuted.push({ tool_name: 'find_subcontractors', result: `Found ${matched.length} subcontractors${filterDesc ? ` matching ${filterDesc}` : ''}` });
            toolResultContent = JSON.stringify({
              success: true,
              total_in_company: allSubs?.length || 0,
              matched_count: matched.length,
              filter: { area, specialty },
              subcontractors: summary
            });
          } else if (fname === 'assign_inspection') {
            const inspectionId = crypto.randomUUID();
            const inspectionData = {
              id: inspectionId,
              company_id: actualCompanyId,
              client_name: args.client_name,
              client_phone: args.client_phone || '',
              client_email: args.client_email || '',
              property_address: args.property_address,
              assigned_to_email: args.assigned_to_email,
              scheduled_date: args.inspection_date || null,
              inspection_time: args.inspection_time || null,
              damage_type: args.damage_type || '',
              special_instructions: args.special_instructions || '',
              status: 'assigned'
            };
            
            const inspection = await base44.asServiceRole.entities.InspectionJob.create(inspectionData);
            
            // Create calendar event if requested
            if (args.create_calendar_event && args.inspection_date && args.inspection_time) {
              const dateTime = new Date(`${args.inspection_date}T${args.inspection_time}:00`);
              const endTime = new Date(dateTime.getTime() + 60 * 60 * 1000); // 1 hour duration
              
              await base44.asServiceRole.entities.CalendarEvent.create({
                company_id: actualCompanyId,
                title: `Inspection: ${args.client_name}`,
                description: `Property: ${args.property_address}\nDamage Type: ${args.damage_type || 'N/A'}`,
                start_time: dateTime.toISOString(),
                end_time: endTime.toISOString(),
                event_type: 'inspection',
                assigned_to: args.assigned_to_email,
                location: args.property_address,
                related_customer: args.client_name,
                email_reminder_minutes: [1440, 120],
                send_email_notification: true
              });
            }
            
            // Create lead if requested
            if (args.create_lead) {
              await base44.asServiceRole.entities.Lead.create({
                company_id: actualCompanyId,
                name: args.client_name,
                phone: args.client_phone || '',
                email: args.client_email || '',
                street: args.property_address,
                status: 'new',
                source: 'ai',
                assigned_to: args.assigned_to_email,
                assigned_to_users: [args.assigned_to_email],
                tags: ['lead inspections']
              });
            }
            
            // Create task if requested
            if (args.create_task) {
              await base44.asServiceRole.entities.Task.create({
                company_id: actualCompanyId,
                name: `Inspection: ${args.client_name}`,
                description: `Property: ${args.property_address}\nDamage: ${args.damage_type || 'N/A'}`,
                assigned_to: args.assigned_to_email,
                assigned_to_users: [args.assigned_to_email],
                due_date: args.inspection_date || null,
                status: 'not_started',
                source: 'inspection',
                related_to: args.client_name
              });
            }
            
            actionsExecuted.push({ 
              tool_name: 'assign_inspection', 
              result: `Inspection assigned to ${args.assigned_to_email}` 
            });
            
            toolResultContent = JSON.stringify({ 
              success: true, 
              inspection_id: inspection.id,
              message: `Inspection created and assigned to ${args.assigned_to_email}`
            });
          }

          // Add tool result to conversation history
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultContent || JSON.stringify({ success: true })
          });

        } catch (toolError) {
          console.error('❌ Tool error:', fname, toolError.message);
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: toolError.message })
          });
        }
      }
    }

    return Response.json({
      response: finalResponse || 'Hello! How can I help you?',
      actions_executed: actionsExecuted
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    return Response.json({ 
      response: "I encountered an error. Please try again.",
      error: error.message
    }, { status: 500 });
  }
});