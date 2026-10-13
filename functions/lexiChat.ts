import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { fetchActivityLog, formatActivityLogForPrompt } from './utils/activityLogUtils.ts';
import { canonicalizeGenericEntityType, normalizeGenericEntityData } from './utils/expenseNormalize.ts';
import { calendarBuildRouteGuard, manageEntityBuildRouteGuard } from './utils/buildIntent.ts';
import { buildScheduleConfirmationGuard, isBuildSchedulingMutation } from './utils/buildConfirmation.ts';

function buildDayRange(buildDate: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(buildDate)) throw new Error('build_date must be a valid YYYY-MM-DD date');
  const [year, month, day] = buildDate.split('-').map(Number);
  const dateProbe = new Date(Date.UTC(year, month - 1, day));
  if (dateProbe.getUTCFullYear() !== year || dateProbe.getUTCMonth() !== month - 1 || dateProbe.getUTCDate() !== day) throw new Error('build_date must be a valid YYYY-MM-DD date');
  const toUtc = (hour: number) => {
    const target = Date.parse(`${buildDate}T${String(hour).padStart(2, '0')}:00:00Z`);
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    let ms = target;
    for (let i = 0; i < 2; i++) { const p = Object.fromEntries(fmt.formatToParts(new Date(ms)).filter(x => x.type !== 'literal').map(x => [x.type, x.value])); ms += target - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second); }
    return new Date(ms).toISOString();
  };
  return { start_time: toUtc(7), end_time: toUtc(17) };
}

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
    const { message, conversationHistory, companyId, userEmail, userName, userIdentity, mode, file_urls, confirmation_token } = body;

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
    // The request body is untrusted. Never allow a browser caller to select a
    // different employee/company by supplying userIdentity or userEmail.
    const effectiveUserEmail = user.email;
    const effectiveUserName = user.full_name || user.email;
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
        isAdmin = (effectiveUserEmail === companyOwnerEmail)
          || userStaffProfile.is_administrator === true
          || userStaffProfile.is_super_admin === true;
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

    // Build creation must not rely on an exact database name match. Staff often
    // say a last name or vary whitespace/case. Resolve only a unique match so
    // Lexi can ask a short follow-up instead of scheduling the wrong customer.
    const resolveBuildCustomer = async (customerId?: string, customerName?: string) => {
      if (customerId) {
        const byId = await base44.asServiceRole.entities.Customer.filter(
          { company_id: actualCompanyId, id: customerId }, 'name', 1
        );
        const customer = byId[0];
        const assigned = Array.isArray(customer?.assigned_to_users) ? customer.assigned_to_users : [];
        const canAccess = isAdmin || customer?.assigned_to === effectiveUserEmail || assigned.includes(effectiveUserEmail);
        return { customer: canAccess ? customer : null, candidates: [] as any[] };
      }
      const needle = (customerName || '').toLowerCase().trim().replace(/\s+/g, ' ');
      const tokens = needle.split(' ').filter(Boolean);
      const all = await base44.asServiceRole.entities.Customer.filter(
        { company_id: actualCompanyId }, '-created_date', 1000
      );
      const candidates = all.filter((item: any) => {
        const name = (item.name || '').toLowerCase().trim().replace(/\s+/g, ' ');
        const assigned = Array.isArray(item.assigned_to_users) ? item.assigned_to_users : [];
        const canAccess = isAdmin || item.assigned_to === effectiveUserEmail || assigned.includes(effectiveUserEmail);
        return canAccess && (name.includes(needle) || tokens.every(token => name.includes(token)));
      }).slice(0, 3);
      return { customer: candidates.length === 1 ? candidates[0] : null, candidates };
    };
    
    // Get customer context for Lexi - with timeout to prevent hanging
    let customerList = '(Customer context loading...)';
    try {
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('(Customer context unavailable)'), 3000));
      const loadPromise = base44.asServiceRole.entities.Customer.filter({ company_id: actualCompanyId }, '-created_date', 100);
      const companyCustomers = await Promise.race([loadPromise, timeoutPromise]);
      
      if (Array.isArray(companyCustomers) && companyCustomers.length > 0) {
        customerList = companyCustomers.map(c => `${c.name} (${c.email || c.phone || 'no contact'}${c.claim_number ? ', claim: ' + c.claim_number : ''}${c.insurance_claim_number ? ', ins claim: ' + c.insurance_claim_number : ''})`).join(', ');
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
          description: 'Get counts and details from CRM - customers, leads, estimates, invoices, tasks, projects, payments, etc. Supports filtering by city, state, status, assigned_to, and more.',
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
                description: 'Optional filters. Supported: city, state, status, assigned_to, lead_source, name (keyword search on name/customer_name), date_from (YYYY-MM-DD), date_to (YYYY-MM-DD). All are case-insensitive partial matches.',
                properties: {
                  city: { type: 'string', description: 'Filter by city name (case-insensitive, partial match)' },
                  state: { type: 'string', description: 'Filter by state name or abbreviation' },
                  status: { type: 'string', description: 'Filter by lead/estimate/invoice/task status' },
                  assigned_to: { type: 'string', description: 'Filter by assigned staff name or email' },
                  lead_source: { type: 'string', description: 'Filter by lead source' },
                  name: { type: 'string', description: 'Keyword search on name or customer_name field (partial match). Use for "estimates for John Smith", "tasks for Jane", etc.' },
                  date_from: { type: 'string', description: 'Only return records created on or after this date (YYYY-MM-DD). Use for "this month", "last 30 days", etc.' },
                  date_to: { type: 'string', description: 'Only return records created on or before this date (YYYY-MM-DD).' }
                }
              }
            },
            required: ['data_type']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'get_build_schedule',
          description: 'List Build Schedule entries for build/install questions. Filter by optional customer, status, job type, or dates.',
          parameters: { type: 'object', properties: {
            customer_id: { type: 'string' }, customer_name: { type: 'string' }, status: { type: 'string' }, job_type: { type: 'string' },
            date_from: { type: 'string', description: 'YYYY-MM-DD' }, date_to: { type: 'string', description: 'YYYY-MM-DD' },
            limit: { type: 'integer', description: 'Maximum 50; defaults to 20.' }
          }}
        }
      },
      {
        type: 'function',
        function: {
          name: 'create_build_schedule',
          description: 'Prepare or confirm a Build Schedule build/install. The first call writes nothing; repeat with confirmation_token only after the user explicitly confirms the exact customer and date.',
          parameters: { type: 'object', properties: {
            customer_id: { type: 'string' }, customer_name: { type: 'string' }, build_date: { type: 'string', description: 'YYYY-MM-DD' },
            job_types: { type: 'array', items: { type: 'string' } }, address: { type: 'string' }, customer_phone: { type: 'string' },
            customer_email: { type: 'string' }, rep: { type: 'string' }, crew: { type: 'array', items: { type: 'string' } },
            assigned_to: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' },
            status: { type: 'string', enum: ['scheduled', 'confirmed', 'in_progress', 'postponed', 'completed', 'cancelled'] },
            confirmation_token: { type: 'string', description: 'Use only after the user clearly confirms the exact customer and build date returned by the prior call.' }
          }, required: ['build_date', 'job_types'] }
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
              ,
              assigned_to: { type: 'string', description: 'Tenant staff email assigned to the event; defaults to the speaking user.' },
              confirmation_token: { type: 'string', description: 'Required only when confirming a calendar-conflict alternative.' },
              customer_id: { type: 'string', description: 'Tenant-owned customer to notify after a confirmed reschedule.' },
              lead_id: { type: 'string', description: 'Tenant-owned lead to notify after a confirmed reschedule.' },
              reschedule_sms_message: { type: 'string', description: 'Text to send only after a successful confirmed booking.' },
              not_a_build_token: { type: 'string', description: 'Only valid after this tool returned BUILD_ROUTE_REQUIRED with a retry_token. Echo that retry_token here, with the same title and start_time, when the event genuinely is a meeting, walkthrough, or inspection rather than an installation job. Never use it to force a real build through.' }
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
          name: 'route_lead_to_sequence',
          description: 'Prepare enrollment of one company-owned lead in one active company follow-up or nurture workflow. Requires user confirmation before enrollment.',
          parameters: { type: 'object', properties: { lead_id: { type: 'string' }, sequence_name: { type: 'string' } }, required: ['lead_id', 'sequence_name'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'trigger_document_packet',
          description: 'Prepare delivery of a standard restoration packet. Requires user confirmation before sending.',
          parameters: { type: 'object', properties: { recipient_type: { type: 'string', enum: ['lead', 'customer'] }, recipient_id: { type: 'string' }, channel: { type: 'string', enum: ['email', 'sms'] }, estimate_id: { type: 'string' }, inspection_id: { type: 'string' }, material_list_id: { type: 'string' }, document_id: { type: 'string' }, matching_note: { type: 'string' } }, required: ['recipient_type', 'recipient_id', 'channel'] }
        }
      },
      {
        type: 'function',
        function: {
          name: 'dispatch_team_notification',
          description: 'Create and notify a structured operational ticket for one verified company teammate.',
          parameters: { type: 'object', properties: { assignee: { type: 'string' }, title: { type: 'string' }, context_note: { type: 'string' }, priority: { type: 'string', enum: ['low', 'medium', 'high'] }, due_date: { type: 'string' }, lead_id: { type: 'string' }, customer_id: { type: 'string' } }, required: ['assignee', 'title', 'context_note'] }
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
              id: { type: 'string', description: 'ID of the entity (required for update)' },
              confirmation_token: { type: 'string', description: 'For a BuildSchedule date/customer change, use only after the user explicitly confirms the prior prompt.' }
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
          description: 'Search and rank subcontractors by service area, work radius, specialty, active status, and rating. Use before suggesting a crew. If a date is requested, also call get_build_schedule before claiming the team is available.',
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
          description: 'Create and assign a PhotoSync inspection job to a staff member. Use this when user asks to "assign an inspection", "create a PhotoSync job", "schedule an inspection", "create an assignment", "create photosync assignment", or mentions PhotoSync or CrewCam. This is part of the CRM system.',
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
          name: 'get_entity_detail',
          description: 'Fetch the complete details of a single CRM record by its ID. Use when the user asks for "all details on estimate #X", "full info on that invoice", "everything about this customer", "what are the line items on this estimate", or any deep-dive into one specific record. Requires the entity type and entity ID.',
          parameters: {
            type: 'object',
            properties: {
              entity_type: {
                type: 'string',
                enum: ['Customer', 'Lead', 'Estimate', 'Invoice', 'Task', 'Project', 'Payment', 'CalendarEvent', 'StaffProfile'],
                description: 'The type of entity to fetch'
              },
              entity_id: {
                type: 'string',
                description: 'The ID of the record to retrieve'
              }
            },
            required: ['entity_type', 'entity_id']
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
    const userTimeZone = company.timezone || 'America/New_York';

    // Compute the current UTC offset for the company timezone (e.g. "-04:00" for EDT)
    const getUtcOffset = (tz: string, date: Date = new Date()): string => {
      try {
        const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
        const tzStr  = date.toLocaleString('en-US', { timeZone: tz });
        const diffMs = new Date(tzStr).getTime() - new Date(utcStr).getTime();
        const diffMin = Math.round(diffMs / 60000);
        const sign = diffMin >= 0 ? '+' : '-';
        const abs = Math.abs(diffMin);
        return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
      } catch {
        return '-04:00'; // EDT fallback
      }
    };
    const tzOffset = getUtcOffset(userTimeZone);

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

    const systemPrompt = `You are Lexi, the AI assistant built into CompanySync for ${company.company_name}. You talk like a real person — warm, direct, and natural. Think of yourself as the smartest colleague on the team: you know everything about the business, you get things done fast, and you don't waste words.

WHO YOU'RE TALKING TO:
- ${effectiveUserName || effectiveUserEmail} (${isAdmin ? 'Admin' : userStaffProfile?.role_name || 'Staff'})
- Company: ${company.company_name}
- Their customers: ${customerList}${knowledgeBase}${recentActivityContext}

HOW TO TALK:
- Sound like a real person having a real conversation. Short sentences. Natural rhythm.
- Match the energy of the message. Quick question? Quick answer. Deep question? Take a breath and explain it well.
- Never start a reply with "Certainly!", "Of course!", "Great question!", "Absolutely!", or any hollow filler phrase. Just answer.
- Keep it brief by default — 1 to 3 sentences is usually right. If they want more, they'll ask.
- Don't use bullet points or headers for simple answers. Just talk. Use a list only when there are 4+ distinct items and listing them genuinely helps.
- If something is unclear, ask ONE focused follow-up question — don't guess and don't write a paragraph of caveats.
- Never repeat back what the user just said before answering. Get straight to it.
- Use plain language. "Tomorrow at 10" not "2026-07-09T10:00:00-05:00". "Two meetings" not "2 calendar_event entities".
- You have memory of this conversation — reference it naturally like a human would ("like you mentioned earlier…").

WHAT YOU CAN DO:
- Look up and update anything: customers, leads, estimates, invoices, tasks, calendar, notes, payments
- Send emails and SMS (with confirmation first)
- Create inspection jobs (PhotoSync / CrewCam) — use the assign_inspection tool
- Find or recommend subcontractor crews with find_subcontractors. Use its rating, active status, specialty, completed jobs, and work-radius fields to explain the ranking. If a date is involved, also call get_build_schedule and check crew assignments before saying a team is available.
- Builds/installs: use create_build_schedule, never manage_entity or create_calendar_event. Before any new build or build date/customer change, repeat the exact resolved customer name and date and ask for a clear yes/no. The first tool call writes nothing and returns a confirmation token. Use it only after a separate user reply clearly says yes. If the user says no or corrects any detail, discard it and confirm the corrected details again.
- Read PDFs and documents — when a file is attached, its text is already in the message between "--- ATTACHED PDF CONTENT ---" markers. Just read it.
- Staff = internal employees. Subcontractors = external vendors. Never mix them up.

TOOL RULES (follow exactly, silently):
- Always use tools — never guess or fake a confirmation.
- Calendars: call create_calendar_event for meetings, appointments, calls, personal reminders, and other non-build events. Never use it for a build or installation; those must use create_build_schedule.
- Calendar conflicts: when create_calendar_event returns CALENDAR_CONFLICT, say who is already booked and offer one returned alternative. Ask for a clear yes before retrying with confirmation_token. Do not text the customer, create a substitute event, or say it is booked before that confirmed call succeeds. Never reveal internal reasoning or tokens.
- Never say an event was created unless you actually called the tool.
- Dates: ALWAYS include the timezone offset. Current offset for ${userTimeZone}: ${tzOffset}. "tomorrow at 4pm" → "${tomorrowISO}T16:00:00${tzOffset}". "at 8am" → "${todayISO}T08:00:00${tzOffset}". NEVER emit bare times like T08:00:00 with no offset — they are parsed as UTC and will display 4 hours early to the user.
- Include the person's name in event titles: "Meeting with Marcus".
- Updates: use manage_entity. Deletes: use propose_action (never delete directly — human must approve).
- Recent activity / "what's been happening": call get_activity_log or use the context already injected above.
- Deep detail on one record: use get_entity_detail with entity_type + entity_id.
- Filters: get_crm_data supports name, city, state, status, assigned_to, lead_source, date_from (YYYY-MM-DD), date_to.
- Protected (never touch): BillingSettings, SecuritySettings, StripeConfig, TwilioConfig, StaffProfile permissions.
- Proposed deletes: use propose_action → tell the user it's queued for approval in the Lexi Approvals panel.
- You work only for ${company.company_name}. Never reference other CRMs or companies.

TODAY: ${currentDateString} | Time: ${now.toLocaleString('en-US', { timeZone: userTimeZone })} | Timezone: ${userTimeZone}
ISO today: ${todayISO} | ISO tomorrow: ${tomorrowISO}`;
    
    const formattedHistory = (conversationHistory || [])
      .slice(-20)
      .filter(msg => msg?.role && msg?.content)
      .map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      }));

    // 📎 PROCESS ATTACHED FILES (images + PDFs)
    // If no files on the current message, look back in conversation history for the most recent user message that had files
    let effectiveFileUrls = file_urls;
    if ((!effectiveFileUrls || effectiveFileUrls.length === 0) && conversationHistory && conversationHistory.length > 0) {
      const recentWithFiles = [...conversationHistory].reverse().find(
        (msg: { role: string; file_urls?: unknown[] }) => msg.role === 'user' && Array.isArray(msg.file_urls) && msg.file_urls.length > 0
      );
      if (recentWithFiles && Array.isArray((recentWithFiles as { file_urls: unknown[] }).file_urls)) {
        effectiveFileUrls = (recentWithFiles as { file_urls: unknown[] }).file_urls as typeof file_urls;
        console.log('📎 Using file(s) from conversation history for context');
      }
    }

    let fileContextText = '';
    let imageUrls: { type: string; image_url: { url: string; detail: string } }[] = [];

    if (effectiveFileUrls && Array.isArray(effectiveFileUrls) && effectiveFileUrls.length > 0) {
      const file_urls = effectiveFileUrls;
      console.log('📎 Processing', file_urls.length, 'attached file(s)');
      for (const fileObj of file_urls) {
        const fileUrl = typeof fileObj === 'string' ? fileObj : fileObj.url;
        const fileName = typeof fileObj === 'string' ? fileObj : (fileObj.name || '');
        if (!fileUrl) continue;

        const mimeType = typeof fileObj === 'object' && fileObj.type ? fileObj.type : '';
        const isPDF = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf') || fileUrl.toLowerCase().includes('.pdf') || fileUrl.toLowerCase().includes('application/pdf');
        const isImage = mimeType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(fileUrl) || /\.(jpg|jpeg|png|gif|webp)$/i.test(fileName);

        if (isPDF) {
          // Read PDF — try Anthropic first, fall back to Gemini
          let pdfExtracted = false;
          try {
            const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
            const geminiKey = Deno.env.get('GOOGLE_GEMINI_API_KEY') || Deno.env.get('GEMINI_API_KEY');

            const pdfResponse = await fetch(fileUrl);
            if (!pdfResponse.ok) throw new Error(`Could not fetch PDF: ${pdfResponse.status}`);
            const pdfBuffer = await pdfResponse.arrayBuffer();
            const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));

            if (anthropicKey) {
              console.log('📄 Reading PDF via Claude:', fileUrl);
              const { default: Anthropic } = await import('npm:@anthropic-ai/sdk@0.32.1');
              const anthropic = new Anthropic({ apiKey: anthropicKey });
              const claudeResp = await anthropic.messages.create({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 4096,
                messages: [{
                  role: 'user',
                  content: [
                    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
                    { type: 'text', text: 'Please read this PDF document carefully and extract all the text and important information from it. Preserve the structure, names, numbers, and all details accurately.' }
                  ]
                }]
              });
              const extractedText = claudeResp.content.find((b: { type: string }) => b.type === 'text');
              if (extractedText && 'text' in extractedText) {
                fileContextText += `\n\n--- ATTACHED PDF CONTENT ---\n${(extractedText as { text: string }).text}\n--- END OF PDF ---`;
                console.log('✅ PDF extracted via Claude');
                pdfExtracted = true;
              }
            }

            if (!pdfExtracted && geminiKey) {
              console.log('📄 Reading PDF via Gemini (Claude unavailable):', fileUrl);
              const geminiResp = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    contents: [{
                      parts: [
                        { inline_data: { mime_type: 'application/pdf', data: pdfBase64 } },
                        { text: 'Please read this PDF document carefully and extract all the text and important information from it. Preserve the structure, names, numbers, and all details accurately.' }
                      ]
                    }]
                  })
                }
              );
              const geminiData = await geminiResp.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
              const geminiText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (geminiText) {
                fileContextText += `\n\n--- ATTACHED PDF CONTENT ---\n${geminiText}\n--- END OF PDF ---`;
                console.log('✅ PDF extracted via Gemini');
                pdfExtracted = true;
              }
            }

            if (!pdfExtracted) {
              console.warn('⚠️ No AI key available for PDF extraction (need ANTHROPIC_API_KEY or GOOGLE_GEMINI_API_KEY)');
              fileContextText += '\n\n[Note: A PDF was attached but no AI key is configured to read it]';
            }
          } catch (pdfErr) {
            console.error('❌ PDF read error:', pdfErr);
            fileContextText += '\n\n[Note: A PDF was attached but could not be read — ' + (pdfErr as Error).message + ']';
          }
        } else if (isImage) {
          // Include image for vision
          imageUrls.push({ type: 'image_url', image_url: { url: fileUrl, detail: 'high' } });
          console.log('🖼️ Image added for vision:', fileUrl);
        }
      }
    }

    // Build the user message content (text + optional images)
    const confirmationInstruction = confirmation_token
      ? `\n\n[Internal confirmation context: the user explicitly confirmed the exact pending build request. When calling the build scheduling tool, include confirmation_token="${confirmation_token}". Never reveal this token.]`
      : '';
    const userTextContent = (message || 'Hello') + fileContextText + confirmationInstruction;
    const userMessageContent = imageUrls.length > 0
      ? [{ type: 'text', text: userTextContent }, ...imageUrls]
      : userTextContent;

    // Use gpt-4o for all conversations — better natural language quality
    let selectedModel = 'gpt-4o';

    // Helper: call OpenAI with retry on capacity errors, then fall back to Claude vision if needed
    const callOpenAI = async (messages: unknown[], model: string, attempt = 0): Promise<unknown> => {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0.7, max_tokens: 2048 })
      });
      const d = await resp.json() as { error?: { message?: string; code?: string; type?: string }; choices?: unknown[] };
      if (d.error) {
        const isCapacity = d.error.code === 'insufficient_quota' ||
          (d.error.message || '').toLowerCase().includes('high demand') ||
          (d.error.message || '').toLowerCase().includes('rate limit') ||
          resp.status === 429 || resp.status === 503;
        if (isCapacity && attempt < 3) {
          const delay = (attempt + 1) * 2500;
          console.warn(`⚠️ ${model} capacity error, retrying in ${delay}ms (attempt ${attempt + 1}/3)...`);
          await new Promise(r => setTimeout(r, delay));
          return callOpenAI(messages, model, attempt + 1);
        }
        // All retries exhausted with images — try Claude claude-3-5-sonnet as fallback
        if (isCapacity && imageUrls.length > 0) {
          console.warn('⚠️ gpt-4o exhausted — falling back to Claude claude-3-5-sonnet for vision...');
          const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
          if (anthropicKey) {
            const { default: Anthropic } = await import('npm:@anthropic-ai/sdk@0.32.1');
            const anthropic = new Anthropic({ apiKey: anthropicKey });
            // Build Claude-compatible content array for the user message
            const userMsg = messages[messages.length - 1] as { role: string; content: unknown };
            const claudeContent: unknown[] = [];
            if (Array.isArray(userMsg.content)) {
              for (const part of userMsg.content as Array<{ type: string; text?: string; image_url?: { url: string } }>) {
                if (part.type === 'text') claudeContent.push({ type: 'text', text: part.text });
                else if (part.type === 'image_url' && part.image_url?.url) {
                  claudeContent.push({ type: 'image', source: { type: 'url', url: part.image_url.url } });
                }
              }
            } else {
              claudeContent.push({ type: 'text', text: userMsg.content as string });
            }
            const systemMsg = (messages[0] as { role: string; content: string }).content;
            const claudeResp = await anthropic.messages.create({
              model: 'claude-3-5-sonnet-20241022',
              max_tokens: 2048,
              system: systemMsg,
              messages: [{ role: 'user', content: claudeContent as Parameters<typeof anthropic.messages.create>[0]['messages'][0]['content'] }]
            });
            const textBlock = claudeResp.content.find((b: { type: string }) => b.type === 'text') as { type: string; text: string } | undefined;
            const claudeText = textBlock?.text || 'I analyzed the image but could not produce a response.';
            console.log('✅ Claude vision fallback succeeded');
            // Return an OpenAI-compatible structure so the loop can handle it
            return { choices: [{ message: { role: 'assistant', content: claudeText, tool_calls: null }, finish_reason: 'stop' }] };
          }
        }
        console.error('OpenAI Error:', d.error);
        throw new Error(`OpenAI Error: ${d.error.message}`);
      }
      return d;
    };

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
      console.log(`📞 Turn ${turnCount}: Calling OpenAI (${selectedModel})...`);
      
      const data = await callOpenAI(currentMessages, selectedModel) as { choices: Array<{ message: { role: string; content: string | null; tool_calls?: unknown[] | null }; finish_reason: string }> };
      if (!data.choices) {
        throw new Error('No choices returned from AI');
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

            // Shared date/name filter helper
            const applyCommonFilters = (items: any[], f: any, nameField = 'name') => {
              if (f.name) { const n = f.name.toLowerCase().trim(); items = items.filter((r: any) => (r[nameField] || r.name || '').toLowerCase().includes(n)); }
              if (f.status) { const st = f.status.toLowerCase().trim(); items = items.filter((r: any) => r.status?.toLowerCase() === st || r.status?.toLowerCase().includes(st)); }
              if (f.assigned_to) { const a = f.assigned_to.toLowerCase().trim(); items = items.filter((r: any) => r.assigned_to?.toLowerCase().includes(a)); }
              if (f.date_from) { const df = new Date(f.date_from).getTime(); items = items.filter((r: any) => r.created_date && new Date(r.created_date).getTime() >= df); }
              if (f.date_to) { const dt = new Date(f.date_to); dt.setHours(23,59,59,999); items = items.filter((r: any) => r.created_date && new Date(r.created_date).getTime() <= dt.getTime()); }
              return items;
            };

            if (dataType === 'customers') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              console.log('🔍 Customer query:', JSON.stringify(query));
              let allCustomers = await base44.asServiceRole.entities.Customer.filter(query, '-created_date', 500);
              console.log('👥 Found', allCustomers.length, 'customers');
              const f = args.filters || {};
              if (f.name) { const n = f.name.toLowerCase().trim(); allCustomers = allCustomers.filter((c: any) => c.name?.toLowerCase().includes(n)); }
              if (f.date_from) { const df = new Date(f.date_from).getTime(); allCustomers = allCustomers.filter((c: any) => c.created_date && new Date(c.created_date).getTime() >= df); }
              if (f.date_to) { const dt = new Date(f.date_to); dt.setHours(23,59,59,999); allCustomers = allCustomers.filter((c: any) => c.created_date && new Date(c.created_date).getTime() <= dt.getTime()); }
              result = { count: allCustomers.length, filter_applied: f, customers: allCustomers.slice(0, 100).map((c: any) => ({ id: c.id, name: c.name, email: c.email, phone: c.phone, city: c.city, state: c.state, claim_number: c.claim_number || null, insurance_claim_number: c.insurance_claim_number || null, created_date: c.created_date })) } as any;
              actionsExecuted.push({ tool_name: 'get_customers', result: `Found ${allCustomers.length} customers` });
            } else if (dataType === 'leads') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              let filtered = await base44.asServiceRole.entities.Lead.filter(query, '-created_date', 1000);

              // Apply optional client-side filters (case-insensitive partial match)
              const f = args.filters || {};
              if (f.city) { const c = f.city.toLowerCase().trim(); filtered = filtered.filter((l: any) => l.city?.toLowerCase().includes(c)); }
              if (f.state) { const s = f.state.toLowerCase().trim(); filtered = filtered.filter((l: any) => l.state?.toLowerCase().includes(s) || l.state?.toUpperCase() === s.toUpperCase()); }
              if (f.lead_source) { const ls = f.lead_source.toLowerCase().trim(); filtered = filtered.filter((l: any) => l.lead_source?.toLowerCase().includes(ls)); }
              filtered = applyCommonFilters(filtered, f, 'name');

              // Sort by created_date descending so "last added" queries work correctly
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              const filterDesc = Object.keys(f).length ? ` (filtered by: ${Object.entries(f).map(([k,v]) => `${k}="${v}"`).join(', ')})` : '';
              result = {
                count: filtered.length,
                filter_applied: f,
                most_recent: filtered[0] ? { name: filtered[0].name, status: filtered[0].status, phone: filtered[0].phone, email: filtered[0].email, created_date: filtered[0].created_date, lead_source: filtered[0].lead_source } : null,
                leads: filtered.map((l: any) => ({ id: l.id, name: l.name, status: l.status, phone: l.phone, email: l.email, assigned_to: l.assigned_to, created_date: l.created_date, lead_source: l.lead_source, address: l.address, city: l.city, state: l.state, notes: l.notes, claim_number: l.claim_number || null, insurance_claim_number: l.insurance_claim_number || null }))
              } as any;
              actionsExecuted.push({ tool_name: 'get_leads', result: `Found ${filtered.length} leads${filterDesc}` });
            } else if (dataType === 'estimates') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              let filtered = await base44.asServiceRole.entities.Estimate.filter(query, '-created_date', 500);
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              const f = args.filters || {};
              filtered = applyCommonFilters(filtered, f, 'customer_name');
              const filterDesc = Object.keys(f).length ? ` (filtered by: ${Object.entries(f).map(([k,v]) => `${k}="${v}"`).join(', ')})` : '';
              result = {
                count: filtered.length,
                filter_applied: f,
                most_recent: filtered[0] ? { id: filtered[0].id, customer_name: filtered[0].customer_name, status: filtered[0].status, total: filtered[0].total, created_date: filtered[0].created_date } : null,
                estimates: filtered.slice(0, 100).map((e: any) => ({ id: e.id, customer_name: e.customer_name, status: e.status, total: e.total, created_date: e.created_date, assigned_to: e.assigned_to }))
              } as any;
              actionsExecuted.push({ tool_name: 'get_estimates', result: `Found ${filtered.length} estimates${filterDesc}` });
            } else if (dataType === 'invoices') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              let filtered = await base44.asServiceRole.entities.Invoice.filter(query, '-created_date', 500);
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              const f = args.filters || {};
              filtered = applyCommonFilters(filtered, f, 'customer_name');
              const totalRevenue = filtered.reduce((sum: number, inv: any) => sum + (inv.amount || 0), 0);
              const totalPaid = filtered.reduce((sum: number, inv: any) => sum + (inv.amount_paid || 0), 0);
              const filterDesc = Object.keys(f).length ? ` (filtered by: ${Object.entries(f).map(([k,v]) => `${k}="${v}"`).join(', ')})` : '';
              result = {
                count: filtered.length,
                filter_applied: f,
                total_revenue: totalRevenue,
                total_paid: totalPaid,
                most_recent: filtered[0] ? { id: filtered[0].id, customer_name: filtered[0].customer_name, amount: filtered[0].amount, status: filtered[0].status, created_date: filtered[0].created_date } : null,
                invoices: filtered.slice(0, 100).map((i: any) => ({ id: i.id, customer_name: i.customer_name, amount: i.amount, amount_paid: i.amount_paid, status: i.status, created_date: i.created_date }))
              } as any;
              actionsExecuted.push({ tool_name: 'get_invoices', result: `Found ${filtered.length} invoices${filterDesc}` });
            } else if (dataType === 'tasks') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              let filtered = await base44.asServiceRole.entities.Task.filter(query, '-created_date', 500);
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              const f = args.filters || {};
              filtered = applyCommonFilters(filtered, f, 'name');
              const filterDesc = Object.keys(f).length ? ` (filtered by: ${Object.entries(f).map(([k,v]) => `${k}="${v}"`).join(', ')})` : '';
              result = {
                count: filtered.length,
                filter_applied: f,
                most_recent: filtered[0] ? { id: filtered[0].id, name: filtered[0].name, status: filtered[0].status, assigned_to: filtered[0].assigned_to, due_date: filtered[0].due_date } : null,
                tasks: filtered.slice(0, 100).map((t: any) => ({ id: t.id, name: t.name, status: t.status, assigned_to: t.assigned_to, due_date: t.due_date, priority: t.priority, created_date: t.created_date }))
              } as any;
              actionsExecuted.push({ tool_name: 'get_tasks', result: `Found ${filtered.length} tasks${filterDesc}` });
            } else if (dataType === 'projects') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              let filtered = await base44.asServiceRole.entities.Project.filter(query, '-created_date', 500);
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              const f = args.filters || {};
              filtered = applyCommonFilters(filtered, f, 'customer_name');
              const filterDesc = Object.keys(f).length ? ` (filtered by: ${Object.entries(f).map(([k,v]) => `${k}="${v}"`).join(', ')})` : '';
              result = {
                count: filtered.length,
                filter_applied: f,
                most_recent: filtered[0] ? { id: filtered[0].id, name: filtered[0].name, status: filtered[0].status, customer_name: filtered[0].customer_name, created_date: filtered[0].created_date } : null,
                projects: filtered.slice(0, 100).map((p: any) => ({ id: p.id, name: p.name, status: p.status, customer_name: p.customer_name, assigned_to: p.assigned_to, created_date: p.created_date }))
              } as any;
              actionsExecuted.push({ tool_name: 'get_projects', result: `Found ${filtered.length} projects${filterDesc}` });
            } else if (dataType === 'payments') {
              const query = applyRoleFilter({ company_id: actualCompanyId });
              let filtered = await base44.asServiceRole.entities.Payment.filter(query, '-created_date', 500);
              filtered.sort((a: any, b: any) => new Date(b.created_date || 0).getTime() - new Date(a.created_date || 0).getTime());
              const f = args.filters || {};
              filtered = applyCommonFilters(filtered, f, 'customer_name');
              const totalPayments = filtered.reduce((sum: number, pmt: any) => sum + (pmt.amount || 0), 0);
              const filterDesc = Object.keys(f).length ? ` (filtered by: ${Object.entries(f).map(([k,v]) => `${k}="${v}"`).join(', ')})` : '';
              result = {
                count: filtered.length,
                filter_applied: f,
                total_amount: totalPayments,
                most_recent: filtered[0] ? { id: filtered[0].id, customer_name: filtered[0].customer_name, amount: filtered[0].amount, created_date: filtered[0].created_date } : null,
                payments: filtered.slice(0, 100).map((p: any) => ({ id: p.id, customer_name: p.customer_name, amount: p.amount, payment_method: p.payment_method, created_date: p.created_date }))
              } as any;
              actionsExecuted.push({ tool_name: 'get_payments', result: `Found ${filtered.length} payments${filterDesc}` });
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

          } else if (fname === 'get_entity_detail') {
            const { entity_type, entity_id } = args;
            console.log(`🔍 get_entity_detail: ${entity_type} ${entity_id}`);
            try {
              const record = await base44.asServiceRole.entities[entity_type].get(entity_id);
              if (!record || record.company_id !== actualCompanyId) {
                toolResultContent = JSON.stringify({ error: 'Record not found or access denied' });
              } else {
                actionsExecuted.push({ tool_name: 'get_entity_detail', result: `Fetched ${entity_type} ${entity_id}` });
                toolResultContent = JSON.stringify({ entity_type, record });
              }
            } catch (e: any) {
              toolResultContent = JSON.stringify({ error: `Failed to fetch ${entity_type}: ${e.message}` });
            }

          } else if (fname === 'get_build_schedule') {
            const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
            const baseFilter = { company_id: actualCompanyId };
            const allBuilds = isAdmin
              ? await base44.asServiceRole.entities.BuildSchedule.filter(baseFilter, 'build_date', 1000)
              : (await Promise.all([
                base44.asServiceRole.entities.BuildSchedule.filter({ ...baseFilter, created_by: effectiveUserEmail }, 'build_date', 1000),
                base44.asServiceRole.entities.BuildSchedule.filter({ ...baseFilter, rep_email: effectiveUserEmail }, 'build_date', 1000),
                base44.asServiceRole.entities.BuildSchedule.filter({ ...baseFilter, assigned_to_users: { $contains: effectiveUserEmail } }, 'build_date', 1000),
              ])).flat().filter((b: any, i: number, a: any[]) => a.findIndex(x => x.id === b.id) === i);
            const builds = allBuilds.filter((b: any) => (!args.customer_id || b.customer_id === args.customer_id) && (!args.customer_name || (b.customer_name || '').toLowerCase().includes(args.customer_name.toLowerCase())) && (!args.status || (b.status || '').toLowerCase() === args.status.toLowerCase()) && (!args.job_type || JSON.stringify(b.job_type || b.job_types || []).toLowerCase().includes(args.job_type.toLowerCase())) && (!args.date_from || b.build_date >= args.date_from) && (!args.date_to || b.build_date <= args.date_to)).slice(0, limit);
            toolResultContent = JSON.stringify({ count: builds.length, builds: builds.map((b: any) => ({ id: b.id, customer_name: b.customer_name, build_date: b.build_date, status: b.status, job_type: b.job_type || b.job_types || [], address: b.address, rep: b.rep, crew: b.crew || b.assigned_to || [], notes: b.notes || null })) });
          } else if (fname === 'create_build_schedule') {
            const jobTypes = Array.isArray(args.job_types) ? args.job_types.filter(Boolean) : (args.job_type ? [args.job_type] : []);
            if (!(args.customer_id || args.customer_name) || !args.build_date || !jobTypes.length) {
              toolResultContent = JSON.stringify({ error: 'Build requires customer_name or customer_id, build_date, and one or more job_types.' });
            } else {
              try { buildDayRange(args.build_date, userTimeZone); } catch (e: any) { toolResultContent = JSON.stringify({ error: e.message }); continue; }
               const resolved = await resolveBuildCustomer(args.customer_id, args.customer_name);
               const customer = resolved.customer;
               if (!customer && resolved.candidates.length > 1) toolResultContent = JSON.stringify({ error: 'More than one customer matches that name. Please ask which customer they mean.', code: 'CUSTOMER_AMBIGUOUS', candidates: resolved.candidates.map((c: any) => ({ id: c.id, name: c.name })) });
               else if (!customer) toolResultContent = JSON.stringify({ error: 'Customer was not found in this company.' });
              else {
                const confirmation = buildScheduleConfirmationGuard({
                  companyId: actualCompanyId, userEmail: effectiveUserEmail, action: 'create',
                  customerId: customer.id, customerName: customer.name,
                  buildDate: args.build_date, jobTypes,
                }, args.confirmation_token);
                if (confirmation) {
                  // Stop this request at the confirmation boundary. Feeding the
                  // tool result back to the model lets it immediately replay the
                  // token in the same AI turn, which is not a user confirmation.
                  return Response.json({
                    response: confirmation.message,
                    requires_confirmation: true,
                    proposed_action: {
                      type: 'build_schedule',
                      action: 'create',
                      confirmation_token: confirmation.confirmation_token,
                      customer_id: confirmation.customer_id,
                      customer_name: confirmation.customer_name,
                      build_date: confirmation.build_date,
                      job_types: confirmation.job_types,
                    },
                    actions_executed: actionsExecuted,
                  });
                }
                const assigned = isAdmin ? (Array.isArray(args.assigned_to) ? args.assigned_to : [args.assigned_to || effectiveUserEmail]) : [effectiveUserEmail];
                const build = await base44.asServiceRole.entities.BuildSchedule.create({ company_id: actualCompanyId, customer_id: customer.id, customer_name: customer.name, build_date: args.build_date, job_type: jobTypes, address: args.address || customer.address || '', customer_phone: args.customer_phone || customer.phone || '', customer_email: args.customer_email || customer.email || '', rep: isAdmin ? (args.rep || effectiveUserName || effectiveUserEmail) : (effectiveUserName || effectiveUserEmail), rep_email: effectiveUserEmail, crew: args.crew || [], assigned_to: assigned, assigned_to_users: assigned, notes: args.notes || '', status: args.status || 'scheduled', created_by: effectiveUserEmail, created_by_name: effectiveUserName || effectiveUserEmail });
                let calendarEventId: string | null = null;
                try {
                  const day = buildDayRange(args.build_date, userTimeZone);
                  const event = await base44.asServiceRole.entities.CalendarEvent.create({ company_id: actualCompanyId, title: `${jobTypes.join(' & ')}: ${customer.name}`, start_time: day.start_time, end_time: day.end_time, event_type: 'build', location: args.address || customer.address || '', description: args.notes || '', assigned_to: assigned[0], attendees: assigned, related_customer: customer.name, status: 'scheduled', created_by: effectiveUserEmail });
                  calendarEventId = event.id;
                  await base44.asServiceRole.entities.BuildSchedule.update(build.id, { calendar_event_id: event.id });
                   const [verifiedBuilds, verifiedEvents] = await Promise.all([
                     base44.asServiceRole.entities.BuildSchedule.filter({ id: build.id, company_id: actualCompanyId }, '-created_date', 1),
                     base44.asServiceRole.entities.CalendarEvent.filter({ id: event.id, company_id: actualCompanyId }, '-created_date', 1),
                   ]);
                   if (verifiedBuilds[0]?.calendar_event_id !== event.id || !verifiedEvents[0]) {
                     throw new Error('Saved build records could not be verified');
                   }
                  toolResultContent = JSON.stringify({ success: true, build_id: build.id, calendar_event_id: event.id, customer_name: customer.name, build_date: args.build_date, job_type: jobTypes });
                } catch (calendarError: any) {
                  const cleanup = await Promise.allSettled([
                    calendarEventId ? base44.asServiceRole.entities.CalendarEvent.delete(calendarEventId) : Promise.resolve(),
                    base44.asServiceRole.entities.BuildSchedule.delete(build.id),
                  ]);
                  const cleanedUp = cleanup.every(r => r.status === 'fulfilled');
                  toolResultContent = JSON.stringify({ success: false, error: `No build was created: calendar setup failed (${calendarError.message}). Cleanup ${cleanedUp ? 'completed' : 'may require manual review'}.` });
                }
              }
            }
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

            // Safety net: if the AI emitted a bare local time (no Z, no ±HH:MM offset),
            // treat it as company-local and append the correct offset so it stores as intended.
            // e.g. "2026-07-14T08:00:00" → "2026-07-14T08:00:00-04:00"
            if (startTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(startTime)) {
              startTime = startTime + tzOffset;
              console.log(`📅 Bare datetime detected — appended tz offset: ${startTime}`);
            }
            if (endTime && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(endTime)) {
              endTime = endTime + tzOffset;
            }

            if (!endTime) {
              const d = new Date(startTime);
              d.setHours(d.getHours() + 1);
              endTime = d.toISOString();
            }
            
            // Validate required fields
            const buildRouteBlock = calendarBuildRouteGuard(args);
            if (buildRouteBlock) {
              toolResultContent = JSON.stringify(buildRouteBlock);
            } else if (!args.title || !startTime) {
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

          } else if (fname === 'route_lead_to_sequence') {
            if (!isAdmin) toolResultContent = JSON.stringify({ success: false, error: 'Only an administrator can approve lead routing or document delivery.' });
            else {
              const leads = await base44.asServiceRole.entities.Lead.filter({ id: args.lead_id, company_id: actualCompanyId });
              const workflows = await base44.asServiceRole.entities.Workflow.filter({ company_id: actualCompanyId });
              const workflow = workflows.find((item: any) => item.is_active !== false && String(item.workflow_name || item.name || '').toLowerCase() === String(args.sequence_name || '').toLowerCase());
              if (!leads[0]) toolResultContent = JSON.stringify({ success: false, error: 'That lead is not in this company.' });
              else if (!workflow) toolResultContent = JSON.stringify({ success: false, error: 'I could not find an active company follow-up sequence with that name.' });
              else return Response.json({ response: `I’m ready to enroll **${leads[0].name}** in **${args.sequence_name}**. Shall I start that follow-up sequence?`, requires_confirmation: true, proposed_action: { type: 'lexi_sequence', lead_id: args.lead_id, workflow_id: workflow.id, sequence_name: args.sequence_name }, actions_executed: actionsExecuted });
            }

          } else if (fname === 'trigger_document_packet') {
            if (!isAdmin) toolResultContent = JSON.stringify({ success: false, error: 'Only an administrator can approve lead routing or document delivery.' });
            else {
              const Entity = args.recipient_type === 'lead' ? base44.asServiceRole.entities.Lead : args.recipient_type === 'customer' ? base44.asServiceRole.entities.Customer : null;
              const recipient = Entity ? (await Entity.filter({ id: args.recipient_id, company_id: actualCompanyId }))[0] : null;
              if (!recipient) toolResultContent = JSON.stringify({ success: false, error: 'That recipient is not in this company.' });
              else if (args.channel === 'email' && !recipient.email) toolResultContent = JSON.stringify({ success: false, error: 'That recipient has no email address.' });
              else if (args.channel === 'sms' && !recipient.phone) toolResultContent = JSON.stringify({ success: false, error: 'That recipient has no phone number.' });
              else return Response.json({ response: `I’m ready to send a restoration packet to **${recipient.name}** by ${String(args.channel).toUpperCase()}. Shall I send it?`, requires_confirmation: true, proposed_action: { type: 'lexi_packet', ...args }, actions_executed: actionsExecuted });
            }

          } else if (fname === 'dispatch_team_notification') {
            if (!isAdmin) toolResultContent = JSON.stringify({ success: false, error: 'Only an administrator can route work to a teammate.' });
            else {
              const needle = String(args.assignee || '').trim().toLowerCase();
              const matches = (await base44.asServiceRole.entities.StaffProfile.filter({ company_id: actualCompanyId })).filter((staff: any) => staff.is_active !== false && [staff.user_email, staff.email, staff.full_name].some(value => String(value || '').toLowerCase() === needle));
              if (matches.length !== 1) toolResultContent = JSON.stringify({ success: false, error: matches.length ? 'More than one teammate matches that name; please use their email.' : 'That teammate is not an active member of this company.' });
              else {
                const assignee = matches[0];
                const task = await base44.asServiceRole.entities.Task.create({ name: args.title, description: args.context_note, due_date: args.due_date || null, priority: args.priority || 'medium', status: 'not_started', company_id: actualCompanyId, assigned_to: assignee.user_email || assignee.email });
                await base44.asServiceRole.entities.Notification.create({ company_id: actualCompanyId, user_email: assignee.user_email || assignee.email, title: 'New operational ticket', message: `${args.title}: ${args.context_note}`, type: 'task_assigned', related_entity_type: 'Task', related_entity_id: task.id, link_url: '/Tasks', is_read: false });
                toolResultContent = JSON.stringify({ success: true, task_id: task.id, assignee: assignee.full_name, message: `Operational ticket assigned to ${assignee.full_name}.` });
              }
            }

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
            const normalizedEntity = canonicalizeGenericEntityType(entity_name.charAt(0).toUpperCase() + entity_name.slice(1));

            // 🔒 Block writes to protected system entities
            const PROTECTED_WRITE_ENTITIES = ['BillingSettings', 'SecuritySettings', 'SecurityConfig', 'StripeConfig', 'TwilioConfig'];
            // A build must not reach the calendar through the generic CRUD tool either.
            const entityBuildRouteBlock = manageEntityBuildRouteGuard(normalizedEntity, action, data);
            if (entityBuildRouteBlock) {
              toolResultContent = JSON.stringify(entityBuildRouteBlock);
            } else if ((action === 'create' || action === 'update' || action === 'delete') && PROTECTED_WRITE_ENTITIES.includes(normalizedEntity)) {
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
                // Expense: map LLM alias fields (vendor/date) → canonical schema + default
                // category, or the Expenses page crashes on undefined category
                const payload = normalizeGenericEntityData(normalizedEntity, { id: entityId, ...data, company_id: actualCompanyId }, { applyDefaults: true });
                if (normalizedEntity === 'BuildSchedule' && isBuildSchedulingMutation(data)) {
                  const confirmation = buildScheduleConfirmationGuard({
                    companyId: actualCompanyId, userEmail: effectiveUserEmail, action: 'create',
                    customerId: payload.customer_id, customerName: payload.customer_name,
                    buildDate: payload.build_date, jobTypes: payload.job_type || payload.job_types,
                  }, args.confirmation_token);
                  if (confirmation) {
                    return Response.json({
                      response: confirmation.message,
                      requires_confirmation: true,
                      proposed_action: {
                        type: 'build_schedule',
                        action: 'create',
                        confirmation_token: confirmation.confirmation_token,
                        customer_id: confirmation.customer_id,
                        customer_name: confirmation.customer_name,
                        build_date: confirmation.build_date,
                        job_types: confirmation.job_types,
                      },
                      actions_executed: actionsExecuted,
                    });
                  }
                  payload.created_by = payload.created_by || effectiveUserEmail;
                  payload.created_by_name = payload.created_by_name || effectiveUserName || effectiveUserEmail;
                }
                if (!isAdmin && !payload.assigned_to && !payload.assigned_to_users) {
                  payload.assigned_to = effectiveUserEmail;
                  payload.assigned_to_users = [effectiveUserEmail];
                }
                result = await base44.asServiceRole.entities[normalizedEntity].create(payload);
                actionsExecuted.push({ tool_name: 'manage_entity', result: `Created ${normalizedEntity}` });
              } else if (action === 'update') {
                const existing = await base44.asServiceRole.entities[normalizedEntity].filter({ id, company_id: actualCompanyId });
                if (!existing?.[0]) throw new Error(`${normalizedEntity} with ID "${id}" not found.`);
                if (normalizedEntity === 'BuildSchedule' && isBuildSchedulingMutation(data)) {
                  const proposed = { ...existing[0], ...data };
                  const confirmation = buildScheduleConfirmationGuard({
                    companyId: actualCompanyId, userEmail: effectiveUserEmail, action: 'update',
                    recordId: id, customerId: proposed.customer_id, customerName: proposed.customer_name,
                    buildDate: proposed.build_date, jobTypes: proposed.job_type || proposed.job_types,
                  }, args.confirmation_token);
                  if (confirmation) {
                    toolResultContent = JSON.stringify(confirmation);
                    continue;
                  }
                }
                if (!isAdmin) {
                  if (!existing[0].assigned_to_users?.includes(effectiveUserEmail) && existing[0].assigned_to !== effectiveUserEmail) {
                    throw new Error(`You don't have permission to update this ${normalizedEntity}`);
                  }
                }
                const safeData = normalizeGenericEntityData(normalizedEntity, { ...existing[0], ...data });
                delete safeData.id;
                delete safeData.company_id;
                result = await base44.asServiceRole.entities[normalizedEntity].update(id, safeData);
                if (normalizedEntity === 'BuildSchedule') {
                  const previousBuild = { ...existing[0] };
                  const verifiedRows = await base44.asServiceRole.entities.BuildSchedule.filter({ id, company_id: actualCompanyId }, '-created_date', 1);
                  const verified = verifiedRows[0];
                  const requestedEntries = Object.entries(data || {}).filter(([key]) => !['id', 'company_id', 'calendar_event_id'].includes(key));
                  const confirmed = verified && requestedEntries.every(([key, value]) => JSON.stringify(verified[key]) === JSON.stringify(value));
                  if (!confirmed) {
                    delete previousBuild.id;
                    delete previousBuild.company_id;
                    await base44.asServiceRole.entities.BuildSchedule.update(id, previousBuild);
                    throw new Error('The build update could not be verified. Please review the Build Schedule before trying again.');
                  }
                  if (verified.calendar_event_id) {
                    const calendarPatch: any = {};
                    if (data.build_date) {
                      const day = buildDayRange(data.build_date, userTimeZone);
                      calendarPatch.start_time = day.start_time;
                      calendarPatch.end_time = day.end_time;
                    }
                    if (data.address !== undefined) calendarPatch.location = data.address;
                    if (data.notes !== undefined) calendarPatch.description = data.notes;
                    if (data.status !== undefined) calendarPatch.status = data.status;
                    if (data.assigned_to !== undefined) {
                      const assigned = Array.isArray(data.assigned_to) ? data.assigned_to : [data.assigned_to];
                      calendarPatch.assigned_to = assigned[0];
                      calendarPatch.attendees = assigned;
                    }
                    const priorEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ id: verified.calendar_event_id, company_id: actualCompanyId }, '-created_date', 1);
                    const previousCalendar = { ...priorEvents[0] };
                    try {
                      if (Object.keys(calendarPatch).length) await base44.asServiceRole.entities.CalendarEvent.update(verified.calendar_event_id, calendarPatch);
                      const linkedEvents = await base44.asServiceRole.entities.CalendarEvent.filter({ id: verified.calendar_event_id, company_id: actualCompanyId }, '-created_date', 1);
                      const calendarConfirmed = linkedEvents[0] && Object.entries(calendarPatch).every(([key, value]) => JSON.stringify(linkedEvents[0][key]) === JSON.stringify(value));
                      if (!calendarConfirmed) throw new Error('The linked calendar event could not be verified.');
                    } catch (calendarError) {
                      delete previousBuild.id;
                      delete previousBuild.company_id;
                      await base44.asServiceRole.entities.BuildSchedule.update(id, previousBuild);
                      delete previousCalendar.id;
                      delete previousCalendar.company_id;
                      if (Object.keys(previousCalendar).length) await base44.asServiceRole.entities.CalendarEvent.update(verified.calendar_event_id, previousCalendar);
                      throw calendarError;
                    }
                  } else {
                    let createdEvent: any = null;
                    try {
                      const day = buildDayRange(verified.build_date, userTimeZone);
                      const jobTypes = Array.isArray(verified.job_type) ? verified.job_type : (verified.job_type ? [verified.job_type] : ['Build']);
                      const assigned = Array.isArray(verified.assigned_to) ? verified.assigned_to : [verified.assigned_to || effectiveUserEmail];
                      createdEvent = await base44.asServiceRole.entities.CalendarEvent.create({
                        company_id: actualCompanyId,
                        title: `${jobTypes.join(' & ')}: ${verified.customer_name || 'Build'}`,
                        start_time: day.start_time,
                        end_time: day.end_time,
                        event_type: 'build',
                        location: verified.address || '',
                        description: verified.notes || '',
                        assigned_to: assigned[0],
                        attendees: assigned,
                        related_customer: verified.customer_name || '',
                        status: verified.status || 'scheduled',
                        created_by: verified.created_by || effectiveUserEmail,
                      });
                      await base44.asServiceRole.entities.BuildSchedule.update(id, { calendar_event_id: createdEvent.id });
                      const [linkedBuilds, linkedEvents] = await Promise.all([
                        base44.asServiceRole.entities.BuildSchedule.filter({ id, company_id: actualCompanyId }, '-created_date', 1),
                        base44.asServiceRole.entities.CalendarEvent.filter({ id: createdEvent.id, company_id: actualCompanyId }, '-created_date', 1),
                      ]);
                      if (linkedBuilds[0]?.calendar_event_id !== createdEvent.id || !linkedEvents[0]) throw new Error('The calendar link could not be verified');
                    } catch (calendarError) {
                      if (createdEvent?.id) await base44.asServiceRole.entities.CalendarEvent.delete(createdEvent.id).catch(() => {});
                      delete previousBuild.id;
                      delete previousBuild.company_id;
                      await base44.asServiceRole.entities.BuildSchedule.update(id, previousBuild);
                      throw calendarError;
                    }
                  }
                }
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

            matched.sort((a: any, b: any) =>
              Number(b.is_active !== false) - Number(a.is_active !== false)
              || (Number(b.rating) || 0) - (Number(a.rating) || 0)
              || (Number(b.total_jobs_completed) || 0) - (Number(a.total_jobs_completed) || 0)
            );
            const summary = matched.map((sub: any) => ({
              id: sub.id,
              name: sub.name,
              contact: sub.contact_person || '',
              phone: sub.phone || '',
              email: sub.email || '',
              base_address: sub.base_address || '',
              rating: Number(sub.rating) || 0,
              rating_count: Number(sub.rating_count) || 0,
              service_radius_miles: Number(sub.service_radius_miles ?? sub.service_radius) || 0,
              specialty: sub.specialty || [],
              availability: sub.availability || '',
              hourly_rate: sub.hourly_rate || null,
              per_sq_rate: sub.per_sq_rate || null,
              total_jobs_completed: Number(sub.total_jobs_completed) || 0,
              is_active: sub.is_active !== false
            }));

            const filterDesc = [area && `area: "${area}"`, specialty && `specialty: "${specialty}"`].filter(Boolean).join(', ');
            actionsExecuted.push({ tool_name: 'find_subcontractors', result: `Found ${matched.length} subcontractors${filterDesc ? ` matching ${filterDesc}` : ''}` });
            toolResultContent = JSON.stringify({
              success: true,
              total_in_company: allSubs?.length || 0,
              matched_count: matched.length,
              filter: { area, specialty },
              subcontractors: summary,
              recommended_teams: summary.filter((sub: any) => sub.is_active).slice(0, 3),
              recommendation_basis: 'Active crews are ranked by rating, then completed jobs. Compare work radius with the job location and call get_build_schedule for the requested date before confirming availability.'
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