const crypto = require('node:crypto');

const SETTINGS_ENTITY_TYPE = 'InsuranceClaimWelcomeSettings';
const SEND_ENTITY_TYPE = 'InsuranceClaimWelcomeEmailSend';
const REQUIRED_ROLES = [
  { key: 'office_manager', title: 'Office Manager' },
  { key: 'production_manager', title: 'Production Manager' },
  { key: 'project_manager', title: 'Project Manager' },
];

function recordData(record) {
  if (!record) return {};
  if (record.data && typeof record.data === 'object' && !Array.isArray(record.data)) return record.data;
  if (typeof record.data === 'string') {
    try {
      const parsed = JSON.parse(record.data);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function recordValue(record, key) {
  return record?.[key] ?? recordData(record)[key];
}

function projectType(project) {
  return String(recordValue(project, 'project_type') || '').trim().toLowerCase();
}

function claimNumber(record) {
  return cleanText(recordValue(record, 'claim_number'))
    || cleanText(recordValue(record, 'insurance_claim_number'));
}

function customerClaimIsNew({ mutationType, previousCustomer, customer }) {
  if (!claimNumber(customer)) return false;
  if (mutationType === 'create') return true;
  return mutationType === 'update' && Boolean(previousCustomer) && !claimNumber(previousCustomer);
}

function cleanText(value) {
  const text = String(value ?? '').trim();
  return !text || /^(?:null|undefined)$/i.test(text) ? '' : text;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function publicProfilePhone(profile) {
  // Deliberately never use cell_phone: the welcome email is customer-facing.
  return cleanText(recordValue(profile, 'phone') || recordValue(profile, 'twilio_number'));
}

function claimTransitionIsNew({ mutationType, previousProject, project }) {
  if (projectType(project) !== 'sedgwick_claim') return false;
  if (mutationType === 'create') return true;
  if (mutationType !== 'update' || !previousProject) return false;
  return projectType(previousProject) !== 'sedgwick_claim';
}

function settingsWriteGuard(ctx, entityType, body, existing) {
  if (entityType !== SETTINGS_ENTITY_TYPE) return { blocked: false };
  if (!ctx?.authenticated || ctx.isImpersonating) {
    return { blocked: true, reason: 'An authenticated company administrator is required.' };
  }
  if (ctx.isSuperAdmin || ctx.viaServiceToken) return { blocked: false };
  if (Array.isArray(body)) return { blocked: true, reason: 'Save one company’s welcome-email settings at a time.' };
  const companyId = existing?.company_id || body?.company_id
    || (ctx.allowedCompanyIds?.size === 1 ? [...ctx.allowedCompanyIds][0] : null);
  const allowed = companyId && ctx.administratorCompanyIds instanceof Set
    && ctx.administratorCompanyIds.has(companyId);
  return allowed
    ? { blocked: false }
    : { blocked: true, reason: 'Only administrators for this company can change welcome-email settings.' };
}

function renderTeamCards(team) {
  return team.map(({ title, name, photoUrl, phone, responsibilities }) => {
    const photo = photoUrl
      ? `<img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(name)}" width="76" height="76" style="display:block;width:76px;height:76px;border-radius:50%;object-fit:cover;border:3px solid #dbeafe;">`
      : '';
    const phoneLine = phone
      ? `<p style="margin:8px 0 0;color:#334155;font-size:14px;"><strong>Call:</strong> <a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(phone)}</a></p>`
      : '';
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:1px solid #dbeafe;border-radius:10px;background:#f8fbff;"><tr><td width="96" valign="top" style="padding:16px 8px 16px 16px;">${photo}</td><td valign="top" style="padding:16px 16px 16px 8px;"><p style="margin:0;color:#0f172a;font-size:16px;font-weight:700;">${escapeHtml(name)}</p><p style="margin:3px 0 8px;color:#1d4ed8;font-size:13px;font-weight:600;">${escapeHtml(title)}</p><p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">${escapeHtml(responsibilities)}</p>${phoneLine}</td></tr></table>`;
  }).join('');
}

function canonicalPhone(value) {
  const text = String(value || '').trim();
  const digits = text.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (text.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return '';
}

async function getVerifiedLexiChannels(pool, companyId, lexiSettings) {
  if (!pool || !companyId) {
    return { phone: '', voice: false, sms: false };
  }
  try {
    if (!lexiSettings) {
      const settingsResult = await pool.query(
        `SELECT data FROM generic_entities
          WHERE entity_type = $1 AND company_id = $2
          ORDER BY updated_date DESC NULLS LAST, created_date DESC
          LIMIT 1`,
        [SETTINGS_ENTITY_TYPE, companyId],
      );
      lexiSettings = recordData(settingsResult.rows?.[0]).lexi;
    }
    if (lexiSettings?.enabled !== true) {
      return { phone: '', voice: false, sms: false };
    }
    const result = await pool.query(
      `SELECT data FROM generic_entities
        WHERE entity_type = 'TwilioSettings' AND company_id = $1
        ORDER BY updated_date DESC NULLS LAST, created_date DESC
        LIMIT 1`,
      [companyId],
    );
    const twilio = recordData(result.rows?.[0]);
    const configuredPhone = canonicalPhone(twilio.main_phone_number);
    const verifiedPhone = canonicalPhone(lexiSettings.public_phone);
    if (!configuredPhone || configuredPhone !== verifiedPhone) {
      return { phone: '', voice: false, sms: false };
    }
    return {
      phone: configuredPhone,
      voice: lexiSettings.voice_enabled === true
        && lexiSettings.voice_verified === true
        && twilio.enable_calling !== false,
      sms: lexiSettings.sms_enabled === true
        && lexiSettings.sms_verified === true
        && twilio.enable_sms !== false,
    };
  } catch (error) {
    console.warn('[Insurance claim welcome] Could not verify Lexi phone channels:', error.message);
    return { phone: '', voice: false, sms: false };
  }
}

function renderLexiCard(channels) {
  if (!channels?.phone || (!channels.voice && !channels.sms)) return '';
  const contact = [
    channels.voice ? `<p style="margin:8px 0 0;color:#334155;font-size:14px;"><strong>Call Lexi:</strong> <a href="tel:${escapeHtml(channels.phone)}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(channels.phone)}</a></p>` : '',
    channels.sms ? `<p style="margin:5px 0 0;color:#334155;font-size:14px;"><strong>Text Lexi:</strong> <a href="sms:${escapeHtml(channels.phone)}" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(channels.phone)}</a></p>` : '',
  ].join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:1px solid #ddd6fe;border-radius:10px;background:#faf8ff;"><tr><td style="padding:16px;"><p style="margin:0;color:#0f172a;font-size:16px;font-weight:700;">Lexi · AI Project Update Assistant</p><p style="margin:6px 0 0;color:#475569;font-size:14px;line-height:1.6;">Lexi can share the current project milestone and updates your team has published for homeowners. She is an AI assistant, not a person.</p>${contact}<p style="margin:5px 0 0;color:#64748b;font-size:12px;">For other questions, contact your project team above.</p></td></tr></table>`;
}

function extractCustomerId(project) {
  return cleanText(
    recordValue(project, 'related_customer_id')
    || recordValue(project, 'customer_id')
  );
}

async function loadTeam(pool, companyId, settings) {
  const configuredRoles = settings?.roles || {};
  const team = [];
  for (const role of REQUIRED_ROLES) {
    const selected = configuredRoles[role.key] || {};
    const staffId = cleanText(selected.staff_profile_id);
    const responsibilities = cleanText(selected.responsibilities);
    if (!staffId || !responsibilities) {
      return { error: `The ${role.title} profile and responsibilities must be set up first.` };
    }
    const staffResult = await pool.query(
      `SELECT * FROM staff_profiles
         WHERE id = $1 AND company_id = $2 AND is_active IS NOT FALSE
         LIMIT 1`,
      [staffId, companyId],
    );
    const profile = staffResult.rows?.[0];
    if (!profile) return { error: `The selected ${role.title} is not active in this company.` };
    const profileData = recordData(profile);
    if (profileData.is_active === false) return { error: `The selected ${role.title} is inactive.` };
    const name = cleanText(profile.full_name || profile.name || profileData.full_name || profileData.name);
    const photoUrl = cleanText(profile.avatar_url || profileData.avatar_url);
    const configuredPhone = cleanText(selected.public_phone);
    const phone = configuredPhone || publicProfilePhone(profile);
    if (!name) return { error: `The selected ${role.title} has no display name.` };
    if (!photoUrl || !/^https:\/\//i.test(photoUrl)) {
      return { error: `Add a public HTTPS profile photo for ${name} before enabling the welcome email.` };
    }
    team.push({ title: role.title, name, photoUrl, phone, responsibilities });
  }
  if (team[0].phone.replace(/\D/g, '').length < 7) return { error: 'Add a valid public customer-service phone number for the Office Manager.' };
  return { team };
}

async function updateSendStatus(pool, sendId, companyId, data) {
  await pool.query(
    `UPDATE generic_entities
        SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb,
            updated_date = NOW()
      WHERE id = $1 AND company_id = $3 AND entity_type = '${SEND_ENTITY_TYPE}'`,
    [sendId, JSON.stringify(data), companyId],
  );
}

async function sendInsuranceClaimWelcomeEmail({
  pool,
  companyId,
  projectId,
  mutationType,
  previousProject,
  entityType = 'Project',
  previousCustomer,
  executeEmail,
}) {
  if (!pool || !companyId || !projectId || typeof executeEmail !== 'function') {
    return { sent: false, skipped: true, reason: 'Missing project send context.' };
  }

  if (!['Project', 'Customer'].includes(entityType)) {
    return { sent: false, skipped: true, reason: 'Unsupported claim source.' };
  }
  let currentProject;
  try {
    const projectResult = await pool.query(
      `SELECT * FROM ${entityType === 'Customer' ? 'customers' : 'projects'} WHERE id = $1 AND company_id = $2 LIMIT 1`,
      [projectId, companyId],
    );
    currentProject = projectResult.rows?.[0];
  } catch (error) {
    return { sent: false, skipped: true, reason: `Could not load project: ${error.message}` };
  }
  const isNewClaim = entityType === 'Customer'
    ? customerClaimIsNew({ mutationType, previousCustomer, customer: currentProject })
    : claimTransitionIsNew({ mutationType, previousProject, project: currentProject });
  if (!currentProject || !isNewClaim) {
    return { sent: false, skipped: true, reason: 'Not a newly created or newly marked insurance claim.' };
  }

  const settingsResult = await pool.query(
    `SELECT data FROM generic_entities
       WHERE entity_type = $1 AND company_id = $2
       ORDER BY updated_date DESC NULLS LAST, created_date DESC
       LIMIT 1`,
    [SETTINGS_ENTITY_TYPE, companyId],
  );
  const settings = recordData(settingsResult.rows?.[0]);
  if (settings.enabled !== true) {
    return { sent: false, skipped: true, reason: 'Insurance-claim welcome email is not enabled.' };
  }

  const customerId = entityType === 'Customer' ? projectId : extractCustomerId(currentProject);
  if (!customerId) return { sent: false, skipped: true, reason: 'Project is not linked to a customer.' };
  const linkedIds = [recordValue(currentProject, 'related_customer_id'), recordValue(currentProject, 'customer_id')]
    .map(cleanText).filter(Boolean);
  if (entityType === 'Project' && new Set(linkedIds).size > 1) {
    return { sent: false, skipped: true, reason: 'Project customer links disagree; confirm the customer before sending.' };
  }
  const customerResult = await pool.query(
    'SELECT * FROM customers WHERE id = $1 AND company_id = $2 LIMIT 1',
    [customerId, companyId],
  );
  const customer = customerResult.rows?.[0];
  const customerData = recordData(customer);
  const customerName = [customer?.full_name, customer?.name, customerData.full_name, customerData.name]
    .map(cleanText).find(Boolean) || '';
  const customerEmail = cleanText(customer?.email) || cleanText(customerData.email);
  if (!customer || !customerName || !isValidEmail(customerEmail)) {
    return { sent: false, skipped: true, reason: 'Linked customer needs a real name and email address.' };
  }

  const { team, error } = await loadTeam(pool, companyId, settings);
  if (error) return { sent: false, skipped: true, reason: error };

  const servicePhone = team[0].phone;
  const lexiChannels = await getVerifiedLexiChannels(pool, companyId, settings.lexi);
  const teamCards = renderTeamCards(team) + renderLexiCard(lexiChannels);
  const html = `<div style="font-family:Arial,sans-serif;color:#334155;"><h1 style="margin:0 0 18px;color:#1e3a8a;font-size:24px;">Welcome — your claim team is here to help</h1><p style="font-size:15px;line-height:1.7;">Hi ${escapeHtml(customerName)},</p><p style="font-size:15px;line-height:1.7;">Thank you for trusting us with your insurance project. We’d like to introduce the people who will help guide you through the process. You can contact our office manager with questions about your claim and next steps.</p><div style="margin:24px 0;">${teamCards}</div><p style="font-size:15px;line-height:1.7;">For customer-service questions, call <a href="tel:${escapeHtml(servicePhone.replace(/[^\d+]/g, ''))}" style="color:#1d4ed8;text-decoration:none;font-weight:700;">${escapeHtml(servicePhone)}</a>. We look forward to keeping you informed as your project moves forward.</p></div>`;
  const number = claimNumber(customer);
  const normalizedNumber = number.toLowerCase().replace(/\s+/g, '');
  const provisionalId = `icw_${crypto.createHash('sha256').update(`${companyId}:${customerId}:unnumbered`).digest('hex').slice(0, 40)}`;
  const sendId = normalizedNumber
    ? `icw_${crypto.createHash('sha256').update(`${companyId}:${customerId}:${normalizedNumber}`).digest('hex').slice(0, 40)}`
    : provisionalId;
  // If an insurance project welcomed this customer before their claim number was
  // available, attach the first numbered claim to that attempt, rather than sending
  // a second introduction when the customer claim field is filled in.
  let inheritedAttempt = null;
  if (normalizedNumber) {
    const prior = await pool.query(
      `SELECT data FROM generic_entities
        WHERE id = $1 AND entity_type = $2 AND company_id = $3
          AND NOT EXISTS (
            SELECT 1 FROM generic_entities numbered
             WHERE numbered.entity_type = $2 AND numbered.company_id = $3
               AND numbered.data->>'customer_id' = $4
               AND COALESCE(numbered.data->>'claim_number', '') <> ''
          ) LIMIT 1`,
      [provisionalId, SEND_ENTITY_TYPE, companyId, customerId],
    );
    inheritedAttempt = prior.rows?.[0];
  }
  const claimResult = await pool.query(
    `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
     VALUES ($1, $2, $3, $4::jsonb, NOW(), NOW())
     ON CONFLICT (id, entity_type) DO NOTHING
     RETURNING id`,
    [sendId, SEND_ENTITY_TYPE, companyId, JSON.stringify({
      status: inheritedAttempt ? 'already_attempted' : 'sending',
      source_entity_type: entityType, source_entity_id: projectId,
      customer_id: customerId, claim_number: normalizedNumber,
    })],
  );
  if (!claimResult.rows?.length || inheritedAttempt) {
    return { sent: false, skipped: true, reason: 'Welcome email was already attempted for this claim.' };
  }

  try {
    const result = await executeEmail({
      action: {
        action_type: 'send_email',
        recipient: 'customer',
        email_subject: 'Welcome — your insurance claim team is here to help',
        email_body: html,
      },
      entityData: {
        ...currentProject,
        customer_name: customerName,
        contact_name: customerName,
        customer_email: customerEmail,
        contact_email: customerEmail,
        insurance_claim_welcome_team_html: teamCards,
        insurance_claim_welcome_service_phone: servicePhone,
      },
      companyId,
      entityType,
      entityId: projectId,
    });
    if (result?.success !== true) {
      await updateSendStatus(pool, sendId, companyId, { status: 'failed', reason: result.reason || 'Email sender returned failure.' });
      return { sent: false, reason: result.reason || 'Email sender returned failure.' };
    }
    await updateSendStatus(pool, sendId, companyId, { status: 'accepted', accepted_at: new Date().toISOString() });
    return { sent: true };
  } catch (error) {
    await updateSendStatus(pool, sendId, companyId, { status: 'failed', reason: error.message });
    return { sent: false, reason: error.message };
  }
}

module.exports = {
  SETTINGS_ENTITY_TYPE,
  SEND_ENTITY_TYPE,
  REQUIRED_ROLES,
  recordData,
  projectType,
  claimNumber,
  customerClaimIsNew,
  claimTransitionIsNew,
  settingsWriteGuard,
  renderTeamCards,
  canonicalPhone,
  getVerifiedLexiChannels,
  renderLexiCard,
  sendInsuranceClaimWelcomeEmail,
};
