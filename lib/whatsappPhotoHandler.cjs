'use strict';

/**
 * WhatsApp installer photo upload handler.
 *
 * When an installer texts photos to the company WhatsApp number, this module:
 *   1. Identifies the installer by their phone number (StaffProfile lookup)
 *   2. Finds active BuildSchedule entries for that installer (today + in_progress)
 *   3. If one match: stores photos automatically and replies with a confirmation
 *   4. If multiple matches: replies with a numbered job-picker list
 *   5. When installer replies with a number: routes the pending photos
 *
 * Photos are stored as JobMedia entities (source: 'whatsapp_upload') visible in
 * the customer profile's Crew Photos tab.
 */

const { randomUUID } = require('crypto');

// ---------------------------------------------------------------------------
// Pending routing state
// phone (E.164) -> { companyId, candidates, mediaUrls, twilioSid, twilioToken,
//                   toPhone, installerName, expiresAt }
// ---------------------------------------------------------------------------
const pendingRouting = new Map();

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [phone, entry] of pendingRouting.entries()) {
    if (entry.expiresAt < now) pendingRouting.delete(phone);
  }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone(phone) {
  const stripped = (phone || '').replace(/^whatsapp:/, '');
  const digits = stripped.replace(/[^\d]/g, '');
  if (stripped.startsWith('+')) return stripped; // already E.164
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return stripped;
}

async function fetchTwilioMedia(url, twilioSid, twilioToken) {
  const authStr = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
  const response = await fetch(url, {
    headers: { 'Authorization': `Basic ${authStr}` },
  });
  if (!response.ok) throw new Error(`Twilio media fetch failed (${response.status})`);
  const arrayBuf = await response.arrayBuffer();
  const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  return { buffer: Buffer.from(arrayBuf), contentType };
}

async function storePhoto(filename, buffer, mimeType) {
  let photoUrl = `/uploads/${filename}`;
  // Try object storage first
  try {
    const { uploadToObjectStorage } = require('../db/object-storage.cjs');
    await uploadToObjectStorage(filename, buffer, mimeType);
    const searchPaths = process.env.PUBLIC_OBJECT_SEARCH_PATHS || '';
    const firstPath = searchPaths.split(',')[0].trim();
    if (firstPath) photoUrl = `/${firstPath.replace(/^\//, '')}/${filename}`;
    return photoUrl;
  } catch (osErr) {
    console.warn('[WhatsAppPhotos] Object storage failed, using disk:', osErr.message);
  }
  // Fallback to local disk
  const { mkdirSync, writeFileSync, existsSync } = require('fs');
  const { join } = require('path');
  const uploadsDir = join(process.cwd(), 'public', 'uploads');
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  writeFileSync(join(uploadsDir, filename), buffer);
  return photoUrl;
}

async function storePhotosForCustomer({ pool, companyId, customerId, customerName, buildId, mediaUrls, installerName, caption, twilioSid, twilioToken }) {
  const extMap = {
    'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
    'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif', 'image/gif': '.gif',
  };
  const ALLOWED_IMAGE_TYPES = new Set(Object.keys(extMap));
  let storedCount = 0;
  for (let i = 0; i < mediaUrls.length; i++) {
    try {
      const { buffer, contentType } = await fetchTwilioMedia(mediaUrls[i], twilioSid, twilioToken);
      if (!contentType.startsWith('image/') || !ALLOWED_IMAGE_TYPES.has(contentType)) {
        console.log(`[WhatsAppPhotos] Skipping non-image attachment: ${contentType}`);
        continue;
      }
      const ext = extMap[contentType] || '.jpg';
      const filename = `wa_${(customerId || 'unknown').slice(-8)}_${randomUUID()}${ext}`;
      const photoUrl = await storePhoto(filename, buffer, contentType);
      const mediaId = `crew_wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const mediaData = {
        related_entity_id: customerId,
        related_entity_type: 'Customer',
        file_url: photoUrl,
        file_type: 'photo',
        section: 'crew_upload',
        source: 'whatsapp_upload',
        uploaded_by_name: installerName || 'Installer (WhatsApp)',
        build_id: buildId || null,
        company_id: companyId,
        created_at: new Date().toISOString(),
        ...(caption ? { caption } : {}),
      };
      await pool.query(
        `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
         VALUES ($1, 'JobMedia', $2, $3, NOW(), NOW())`,
        [mediaId, companyId, JSON.stringify(mediaData)]
      );
      storedCount++;
    } catch (err) {
      console.warn(`[WhatsAppPhotos] Failed to store photo ${i}:`, err.message);
    }
  }
  // Notify admins
  if (storedCount > 0) {
    try {
      const { rows: adminRows } = await pool.query(
        `SELECT user_email FROM staff_profiles WHERE company_id = $1 AND is_administrator = true LIMIT 5`,
        [companyId]
      );
      for (const { user_email } of adminRows) {
        const notifId = `notif_wa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await pool.query(
          `INSERT INTO generic_entities (id, entity_type, company_id, data, created_date, updated_date)
           VALUES ($1, 'Notification', $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
          [notifId, companyId, JSON.stringify({
            id: notifId,
            type: 'crew_photo',
            title: `📸 ${storedCount} WhatsApp Photo${storedCount !== 1 ? 's' : ''} — ${customerName}`,
            message: `${installerName || 'An installer'} sent ${storedCount} photo${storedCount !== 1 ? 's' : ''} via WhatsApp for ${customerName}.`,
            is_read: false,
            user_email,
            related_entity_type: 'Customer',
            related_entity_id: customerId,
            link_url: `/CustomerProfile?id=${customerId}`,
            company_id: companyId,
            created_date: new Date().toISOString(),
          })]
        ).catch(() => {});
      }
    } catch (e) {
      console.warn('[WhatsAppPhotos] Admin notification failed:', e.message);
    }
  }
  return storedCount;
}

async function sendWhatsAppReply({ twilioSid, twilioToken, fromNumber, toNumber, message }) {
  if (!twilioSid || !twilioToken) return;
  const from = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
  const to = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`;
  const authStr = Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64');
  await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${authStr}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: from, Body: message }).toString(),
  }).catch(e => console.warn('[WhatsAppPhotos] Reply send error:', e.message));
}

// ---------------------------------------------------------------------------
// Main handler — called when a WhatsApp message with media arrives
// Returns true if the request was fully handled (caller should return empty TwiML)
// ---------------------------------------------------------------------------
async function handleWhatsAppPhotoUpload({ pool, companyId, fromPhone, mediaUrls, messageBody, twilioSid, twilioToken, toPhone }) {
  if (!mediaUrls || mediaUrls.length === 0) return false;

  const normalizedFrom = normalizePhone(fromPhone);
  const digitsOnly = normalizedFrom.replace(/[^\d]/g, '');

  console.log(`[WhatsAppPhotos] Incoming ${mediaUrls.length} photo(s) from ${normalizedFrom}`);

  // 1. Look up installer by phone (cell_phone or phone column)
  let installer = null;
  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, user_email FROM staff_profiles
       WHERE company_id = $1 AND is_active = true
         AND (
           REGEXP_REPLACE(COALESCE(cell_phone, ''), '[^\\d]', '', 'g') = $2
           OR REGEXP_REPLACE(COALESCE(phone, ''), '[^\\d]', '', 'g') = $2
         )
       LIMIT 1`,
      [companyId, digitsOnly]
    );
    if (rows[0]) installer = rows[0];
  } catch (e) {
    console.warn('[WhatsAppPhotos] Installer lookup error:', e.message);
  }

  if (!installer) {
    console.log(`[WhatsAppPhotos] No staff profile found for ${normalizedFrom}`);
    await sendWhatsAppReply({
      twilioSid, twilioToken, fromNumber: toPhone, toNumber: fromPhone,
      message: "Hi! We received your photos but couldn't match your number to a staff account. Ask your manager to add your mobile number to your profile in the app.",
    });
    return true;
  }

  // 2. Find active builds for this installer (today or in_progress/scheduled)
  const today = new Date().toISOString().slice(0, 10);
  let candidates = [];
  try {
    const { rows } = await pool.query(
      `SELECT id, data FROM generic_entities
       WHERE entity_type = 'BuildSchedule'
         AND company_id = $1
         AND (
           data->'crew' @> jsonb_build_array($2::text)
           OR data->>'rep' = $3
         )
         AND (
           data->>'status' = 'in_progress'
           OR data->>'build_date' = $4
         )
       ORDER BY data->>'build_date' ASC
       LIMIT 8`,
      [companyId, installer.full_name, installer.full_name, today]
    );
    for (const row of rows) {
      const d = row.data || {};
      candidates.push({
        buildId: row.id,
        customerId: d.customer_id || null,
        customerName: d.customer_name || 'Unknown Customer',
        buildDate: d.build_date || today,
        jobType: Array.isArray(d.job_type) ? d.job_type.join(', ') : (d.job_type || 'Build'),
        address: d.address || '',
      });
    }
  } catch (e) {
    console.warn('[WhatsAppPhotos] Build lookup error:', e.message);
  }

  const firstName = installer.full_name.split(' ')[0];

  if (candidates.length === 0) {
    console.log(`[WhatsAppPhotos] No active builds found for ${installer.full_name}`);
    await sendWhatsAppReply({
      twilioSid, twilioToken, fromNumber: toPhone, toNumber: fromPhone,
      message: `Hi ${firstName}! Got your photo(s) but there are no active jobs assigned to you today. Ask your manager to add you to a build schedule and try again.`,
    });
    return true;
  }

  if (candidates.length === 1) {
    const job = candidates[0];
    const count = await storePhotosForCustomer({
      pool, companyId,
      customerId: job.customerId,
      customerName: job.customerName,
      buildId: job.buildId,
      mediaUrls,
      installerName: installer.full_name,
      caption: messageBody || null,
      twilioSid, twilioToken,
    });
    console.log(`[WhatsAppPhotos] Stored ${count} photo(s) for customer ${job.customerName}`);
    await sendWhatsAppReply({
      twilioSid, twilioToken, fromNumber: toPhone, toNumber: fromPhone,
      message: `Got it, ${firstName}! ${count} photo${count !== 1 ? 's' : ''} added to ${job.customerName}. Thanks!`,
    });
    return true;
  }

  // Multiple jobs — show picker and store pending entry
  pendingRouting.set(normalizedFrom, {
    companyId,
    candidates,
    mediaUrls,
    caption: messageBody || null,
    twilioSid,
    twilioToken,
    toPhone,
    installerName: installer.full_name,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  const lines = [
    `Hi ${firstName}! Got ${mediaUrls.length} photo${mediaUrls.length !== 1 ? 's' : ''}. Which job should I add ${mediaUrls.length !== 1 ? 'them' : 'it'} to? Reply with a number:\n`,
  ];
  candidates.forEach((c, i) => {
    const addr = c.address ? ` — ${c.address.split(',')[0]}` : '';
    lines.push(`${i + 1}. ${c.customerName}${addr} (${c.jobType})`);
  });
  await sendWhatsAppReply({
    twilioSid, twilioToken, fromNumber: toPhone, toNumber: fromPhone,
    message: lines.join('\n'),
  });
  return true;
}

// ---------------------------------------------------------------------------
// Resolver — called when installer replies with a number to the job picker
// Returns true if handled
// ---------------------------------------------------------------------------
async function resolveInstallerPendingChoice({ pool, companyId, fromPhone, choiceText, twilioSid, twilioToken, toPhone }) {
  const normalizedFrom = normalizePhone(fromPhone);
  const pending = pendingRouting.get(normalizedFrom);

  if (!pending || pending.companyId !== companyId || pending.expiresAt < Date.now()) {
    pendingRouting.delete(normalizedFrom);
    return false;
  }

  const choice = parseInt(choiceText.trim(), 10);
  if (isNaN(choice) || choice < 1 || choice > pending.candidates.length) return false;

  pendingRouting.delete(normalizedFrom);

  const job = pending.candidates[choice - 1];
  const count = await storePhotosForCustomer({
    pool, companyId,
    customerId: job.customerId,
    customerName: job.customerName,
    buildId: job.buildId,
    mediaUrls: pending.mediaUrls,
    installerName: pending.installerName,
    caption: pending.caption || null,
    twilioSid: pending.twilioSid || twilioSid,
    twilioToken: pending.twilioToken || twilioToken,
  });

  const firstName = pending.installerName.split(' ')[0];
  console.log(`[WhatsAppPhotos] Pending resolved: ${count} photo(s) → ${job.customerName}`);
  await sendWhatsAppReply({
    twilioSid: pending.twilioSid || twilioSid,
    twilioToken: pending.twilioToken || twilioToken,
    fromNumber: pending.toPhone || toPhone,
    toNumber: fromPhone,
    message: `Got it, ${firstName}! ${count} photo${count !== 1 ? 's' : ''} added to ${job.customerName}. Thanks!`,
  });
  return true;
}

module.exports = { handleWhatsAppPhotoUpload, resolveInstallerPendingChoice };
