const { getMilestones } = require('./projectMilestones.cjs');

function phoneVariants(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return [digits, `1${digits}`];
  if (digits.length === 11 && digits.startsWith('1')) return [digits, digits.slice(1)];
  return digits.length >= 8 ? [digits] : [];
}

function parseData(value) {
  if (!value || typeof value !== 'string') return value && typeof value === 'object' ? value : {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function normalizedAddress(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function projectCustomerIds(project) {
  const data = parseData(project.data);
  return [
    project.related_customer_id,
    data.related_customer_id,
    project.customer_id,
    data.customer_id,
  ].map(value => String(value || '').trim()).filter(Boolean);
}

function cleanPublicText(value, maxLength = 900) {
  const text = String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/\b(invoice|payment|paid|price|cost|estimate|deductible|acv|rcv|adjuster|insurance|policy number|claim number|private|internal)\b|\$\s?\d/i.test(text)) {
    return '';
  }
  return text.slice(0, maxLength);
}

function customerProgressFailure(reason) {
  return { ok: false, reason };
}

async function getCustomerPublicProgress(pool, companyId, fromPhone, propertyAddress = '') {
  if (!pool || !companyId || !fromPhone) return customerProgressFailure('unverified_phone');
  const variants = phoneVariants(fromPhone);
  if (!variants.length) return customerProgressFailure('unverified_phone');

  try {
    const customerResult = await pool.query(
      `SELECT id FROM customers
        WHERE company_id = $1
          AND (
            regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g') = ANY($2::text[])
            OR regexp_replace(COALESCE(phone_2, ''), '[^0-9]', '', 'g') = ANY($2::text[])
          )
        LIMIT 3`,
      [companyId, variants],
    );
    if (customerResult.rows.length !== 1) {
      return customerProgressFailure(customerResult.rows.length ? 'ambiguous_customer' : 'unverified_phone');
    }
    const customerId = String(customerResult.rows[0].id || '');
    if (!customerId) return customerProgressFailure('unverified_phone');

    const projectResult = await pool.query(
      `SELECT id, status, project_type, current_milestone, address,
              related_customer_id, customer_id, data
         FROM projects
        WHERE company_id = $1
          AND COALESCE(status, '') <> 'cancelled'
          AND (
            NULLIF(related_customer_id, '') = $2
            OR NULLIF(data->>'related_customer_id', '') = $2
            OR NULLIF(customer_id, '') = $2
            OR NULLIF(data->>'customer_id', '') = $2
          )
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 20`,
      [companyId, customerId],
    );
    if (projectResult.rows.length >= 20) return customerProgressFailure('too_many_projects');

    const linkedProjects = [];
    for (const project of projectResult.rows) {
      const linkedIds = [...new Set(projectCustomerIds(project))];
      if (linkedIds.length !== 1 || linkedIds[0] !== customerId) {
        return customerProgressFailure('conflicting_project_link');
      }
      linkedProjects.push(project);
    }
    if (!linkedProjects.length) return customerProgressFailure('no_project');

    let project = null;
    if (linkedProjects.length === 1) {
      project = linkedProjects[0];
    } else if (propertyAddress) {
      const requested = normalizedAddress(propertyAddress);
      const matches = linkedProjects.filter(candidate => {
        const data = parseData(candidate.data);
        const addresses = [candidate.address, data.address, data.property_address]
          .map(normalizedAddress).filter(Boolean);
        return requested && addresses.includes(requested);
      });
      if (matches.length !== 1) return customerProgressFailure('project_selection_needed');
      project = matches[0];
    } else {
      return customerProgressFailure('project_selection_needed');
    }

    const data = parseData(project.data);
    const milestoneKey = String(project.current_milestone || data.current_milestone || '').trim();
    const milestone = getMilestones(project.project_type || data.project_type)
      .find(item => item.key === milestoneKey)?.label || '';
    const publicStatus = ({
      active: 'in progress',
      in_progress: 'in progress',
      scheduled: 'scheduled',
      completed: 'completed',
      complete: 'completed',
      pending: 'in progress',
    })[String(project.status || '').toLowerCase()] || '';

    const logResult = await pool.query(
      `SELECT content_body, created_at
         FROM project_logs
        WHERE project_id = $1 AND is_public = true
        ORDER BY created_at DESC
        LIMIT 3`,
      [project.id],
    );
    const updates = logResult.rows.map(row => ({
      text: cleanPublicText(row.content_body),
      date: row.created_at ? new Date(row.created_at).toISOString().slice(0, 10) : '',
    })).filter(update => update.text);

    return {
      ok: true,
      status: publicStatus,
      milestone,
      updates,
    };
  } catch (error) {
    console.warn('[Lexi customer progress] public progress lookup failed:', error.message);
    return customerProgressFailure('lookup_failed');
  }
}

function renderCustomerProgressReply(result) {
  if (!result?.ok) {
    if (result?.reason === 'project_selection_needed') {
      return 'I found more than one project on your account. Which property address should I check?';
    }
    if (result?.reason === 'no_project') {
      return 'I could not find a current project linked to this number. I can ask the office team to check for you.';
    }
    return 'I could not safely verify the project information for this number. Please contact the office team so they can help.';
  }

  const pieces = [];
  if (result.status) pieces.push(`Your project is ${result.status}`);
  if (result.milestone) pieces.push(`the current milestone is ${result.milestone}`);
  let reply = pieces.length ? `${pieces.join('; ')}.` : 'I found your project file.';
  if (result.updates?.length) {
    const latest = result.updates[0];
    reply += ` The latest published update${latest.date ? ` from ${latest.date}` : ''} says: ${latest.text}`;
  } else {
    reply += ' There are no published project updates yet.';
  }
  return reply.slice(0, 1500);
}

function buildVoiceProgressScript(result) {
  if (!result?.ok) {
    if (result?.reason === 'project_selection_needed') {
      return 'I found more than one project on your account. Which property address should I check?';
    }
    return 'I could not safely verify your project information. Would you like me to ask the office team to call you?';
  }
  const stage = result.milestone
    ? `The current project milestone is ${result.milestone}.`
    : result.status ? `Your project is ${result.status}.` : 'I found your project file.';
  const update = result.updates?.[0]?.text
    ? ` The latest published update says: ${result.updates[0].text.slice(0, 220)}`
    : ' There are no published project updates yet.';
  return `${stage}${update}`;
}

function normalizeVoiceProgressTranscript(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function isExactVoiceProgressTranscript(actual, expected) {
  const normalizedActual = normalizeVoiceProgressTranscript(actual);
  const normalizedExpected = normalizeVoiceProgressTranscript(expected);
  return Boolean(normalizedExpected && normalizedActual === normalizedExpected);
}

module.exports = {
  phoneVariants,
  getCustomerPublicProgress,
  renderCustomerProgressReply,
  buildVoiceProgressScript,
  isExactVoiceProgressTranscript,
};
