// Pure helper module for the "Switch to CompanySync" migration hub.
// No React, no DB access — just header-mapping presets + platform detection
// so DataImport.jsx (and its tests) can stay simple.
//
// IMPORTANT: every mapped value below MUST be a real key from the
// `entityFields` table in src/pages/DataImport.jsx for that entity type.
// Mapping to a key that doesn't exist there means the column silently
// won't show as mapped in the UI and the value gets dropped.

export const PLATFORMS = {
  jobnimbus: {
    key: 'jobnimbus',
    label: 'JobNimbus',
    color: 'blue',
    hasDirectConnect: true,
  },
  acculynx: {
    key: 'acculynx',
    label: 'AccuLynx',
    color: 'green',
    hasDirectConnect: false,
  },
  servicetitan: {
    key: 'servicetitan',
    label: 'ServiceTitan',
    color: 'orange',
    hasDirectConnect: false,
  },
  buildertrend: {
    key: 'buildertrend',
    label: 'Buildertrend',
    color: 'purple',
    hasDirectConnect: false,
  },
};

export const PLATFORM_ORDER = ['jobnimbus', 'acculynx', 'servicetitan', 'buildertrend'];

function norm(header) {
  return String(header || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Header -> our entityFields key, per platform, per entity type.
// Keys here are normalized (see norm()) so matching is whitespace/punctuation tolerant.
export const PLATFORM_HEADER_MAPS = {
  jobnimbus: {
    Lead: {
      'display name': 'name',
      'company name': 'company',
      'email': 'email',
      'mobile phone': 'phone',
      'home phone': 'phone',
      'address line 1': 'street',
      'city': 'city',
      'state': 'state',
      'zip': 'zip',
      'status name': 'status',
      'source name': 'source',
      'date created': 'created_date',
      'sales rep': 'assigned_to',
      'jnid': 'ghl_contact_id',
    },
    Customer: {
      'display name': 'name',
      'company name': 'company',
      'email': 'email',
      'mobile phone': 'phone',
      'home phone': 'phone',
      'address line 1': 'street',
      'city': 'city',
      'state': 'state',
      'zip': 'zip',
      'source name': 'source',
      'created date': 'created_date',
      'jnid': 'ghl_contact_id',
    },
    Project: {
      'job name': 'name',
      'display name': 'customer_name',
      'status name': 'status',
      'date created': 'start_date',
      'description': 'description',
      'estimate total': 'budget',
    },
    Estimate: {
      'estimate number': 'estimate_number',
      'display name': 'customer_name',
      'status name': 'status',
      'estimate total': 'amount',
      'expiration date': 'valid_until',
      'job name': 'project_name',
    },
    Invoice: {
      'invoice number': 'invoice_number',
      'display name': 'customer_name',
      'email': 'customer_email',
      'invoice total': 'amount',
      'status name': 'status',
      'date created': 'issue_date',
      'due date': 'due_date',
    },
  },
  acculynx: {
    Lead: {
      'customer name': 'name',
      'customer email': 'email',
      'customer phone': 'phone',
      'job address': 'street',
      'job city': 'city',
      'job state': 'state',
      'job zip': 'zip',
      'lead source': 'source',
      'job status': 'status',
      'sales rep': 'assigned_to',
      'date created': 'created_date',
    },
    Customer: {
      'customer name': 'name',
      'customer email': 'email',
      'customer phone': 'phone',
      'job address': 'street',
      'job city': 'city',
      'job state': 'state',
      'job zip': 'zip',
      'lead source': 'source',
      'date created': 'created_date',
      'insurance company': 'insurance_company',
      'claim number': 'claim_number',
      'adjuster name': 'adjuster_name',
      'adjuster phone': 'adjuster_phone',
    },
    Project: {
      'job name': 'name',
      'customer name': 'customer_name',
      'job status': 'status',
      'date created': 'start_date',
      'trade': 'description',
      'estimate total': 'budget',
    },
    Estimate: {
      'job number': 'estimate_number',
      'customer name': 'customer_name',
      'estimate total': 'amount',
      'job status': 'status',
      'job name': 'project_name',
      'insurance company': 'insurance_company',
      'claim number': 'claim_number',
      'adjuster name': 'adjuster_name',
      'adjuster phone': 'adjuster_phone',
    },
    Invoice: {
      'job number': 'invoice_number',
      'customer name': 'customer_name',
      'customer email': 'customer_email',
      'invoice total': 'amount',
      'job status': 'status',
      'date created': 'issue_date',
      'insurance company': 'insurance_company',
      'claim number': 'claim_number',
      'sales rep': 'sale_agent_name',
    },
  },
  servicetitan: {
    Lead: {
      'customer name': 'name',
      'email address': 'email',
      'phone number': 'phone',
      'address': 'street',
      'city': 'city',
      'state': 'state',
      'zip': 'zip',
      'campaign name': 'source',
      'booking date': 'created_date',
    },
    Customer: {
      'customer name': 'name',
      'email address': 'email',
      'phone number': 'phone',
      'address': 'street',
      'city': 'city',
      'state': 'state',
      'zip': 'zip',
      'campaign name': 'source',
      'booking date': 'created_date',
    },
    Project: {
      'job type': 'name',
      'customer name': 'customer_name',
      'job status': 'status',
      'booking date': 'start_date',
      'total amount': 'budget',
      'business unit': 'description',
    },
    Estimate: {
      'job number': 'estimate_number',
      'customer name': 'customer_name',
      'total amount': 'amount',
      'job status': 'status',
      'job type': 'project_name',
    },
    Invoice: {
      'invoice number': 'invoice_number',
      'customer name': 'customer_name',
      'email address': 'customer_email',
      'total amount': 'amount',
      'invoice date': 'issue_date',
      'job status': 'status',
      'technician': 'sale_agent_name',
    },
  },
  buildertrend: {
    Lead: {
      'customer': 'name',
      'customer email': 'email',
      'customer phone': 'phone',
      'address': 'street',
      'city': 'city',
      'state': 'state',
      'zip': 'zip',
      'lead source': 'source',
      'status': 'status',
      'project manager': 'assigned_to',
    },
    Customer: {
      'customer': 'name',
      'customer email': 'email',
      'customer phone': 'phone',
      'address': 'street',
      'city': 'city',
      'state': 'state',
      'zip': 'zip',
      'project manager': 'assigned_to',
    },
    Project: {
      'job name': 'name',
      'customer': 'customer_name',
      'status': 'status',
      'estimate total': 'budget',
    },
    Estimate: {
      'estimate #': 'estimate_number',
      'customer': 'customer_name',
      'bid status': 'status',
      'estimate total': 'amount',
      'job name': 'project_name',
    },
    Invoice: {
      'invoice #': 'invoice_number',
      'customer': 'customer_name',
      'customer email': 'customer_email',
      'invoice total': 'amount',
      'status': 'status',
    },
  },
};

// Headers that are distinctive enough to reliably fingerprint a platform's export.
// Used only for detection scoring, not for the actual column mapping.
export const PLATFORM_SIGNATURES = {
  jobnimbus: ['jnid', 'record type name', 'source name'],
  acculynx: ['job address', 'job city', 'job zip'],
  servicetitan: ['business unit', 'campaign name', 'booking date'],
  buildertrend: ['bid status', 'project manager', 'job #'],
};

export const PLATFORM_EXPORT_INSTRUCTIONS = {
  jobnimbus: {
    label: 'JobNimbus',
    steps: [
      'Log in to JobNimbus and go to Contacts (for Leads/Customers) or Jobs (for Projects).',
      'Select the records you want to bring over, then choose Export > Export to CSV.',
      'Repeat for Estimates and Invoices under the Financial or Jobs tab if you want those too.',
      'Come back here, pick "JobNimbus" as your source, and upload each exported CSV file.',
    ],
    entities: ['Contacts', 'Jobs', 'Estimates', 'Invoices'],
  },
  acculynx: {
    label: 'AccuLynx',
    steps: [
      'In AccuLynx, open the Jobs list (or Leads list) and use the Export button to download a CSV.',
      'For financials, open Invoices or Estimates and export those lists separately.',
      'Come back here, pick "AccuLynx" as your source, and upload each exported CSV file.',
    ],
    entities: ['Jobs', 'Leads', 'Estimates', 'Invoices'],
  },
  servicetitan: {
    label: 'ServiceTitan',
    steps: [
      'In ServiceTitan, go to Reports and run the Customers or Jobs report.',
      'Export the report results to CSV (Export > CSV).',
      'Repeat for Invoices under the Accounting reports section.',
      'Come back here, pick "ServiceTitan" as your source, and upload each exported CSV file.',
    ],
    entities: ['Customers', 'Jobs', 'Invoices'],
  },
  buildertrend: {
    label: 'Buildertrend',
    steps: [
      'In Buildertrend, open the Jobs list and choose Export to CSV.',
      'For customer/lead lists, use the Leads or Customers page export option.',
      'Come back here, pick "Buildertrend" as your source, and upload each exported CSV file.',
    ],
    entities: ['Jobs', 'Leads', 'Estimates', 'Invoices'],
  },
};

/**
 * Build a { csvHeader: entityFieldKey } mapping for one platform + entity type,
 * limited to the headers actually present in this file. Never guesses beyond
 * the known preset table — unmatched headers are left for smartAutoMap to try.
 */
export function getPresetMapping(platform, entityType, headers) {
  const table = PLATFORM_HEADER_MAPS[platform]?.[entityType];
  if (!table) return {};
  const mapping = {};
  const usedKeys = new Set();
  (headers || []).forEach((header) => {
    const key = table[norm(header)];
    if (key && !usedKeys.has(key)) {
      mapping[header] = key;
      usedKeys.add(key);
    }
  });
  return mapping;
}

const MIN_SIGNATURE_HITS = 1;
const MIN_SCORE_MARGIN = 5;

/**
 * Score each platform's header list against the given CSV headers and return
 * the best guess, or null if nothing is confident enough. Requires at least
 * one distinctive signature hit AND a clear margin over the runner-up so a
 * generic/unrelated CSV doesn't get false-positived into a preset.
 */
export function detectPlatform(headers) {
  const normalizedHeaders = new Set((headers || []).map(norm));
  if (normalizedHeaders.size === 0) return null;

  const scores = PLATFORM_ORDER.map((platform) => {
    const sigHits = (PLATFORM_SIGNATURES[platform] || []).filter((sig) =>
      normalizedHeaders.has(norm(sig))
    ).length;

    let mapHits = 0;
    const entityMaps = PLATFORM_HEADER_MAPS[platform] || {};
    const seenHeaderKeys = new Set();
    Object.values(entityMaps).forEach((entityMap) => {
      Object.keys(entityMap).forEach((h) => {
        if (!seenHeaderKeys.has(h) && normalizedHeaders.has(h)) {
          mapHits++;
          seenHeaderKeys.add(h);
        }
      });
    });

    return { platform, sigHits, mapHits, score: sigHits * 10 + mapHits };
  }).sort((a, b) => b.score - a.score);

  const top = scores[0];
  const runnerUp = scores[1] || { score: 0 };

  if (!top || top.score === 0) return null;
  if (top.sigHits < MIN_SIGNATURE_HITS) return null;
  if (top.score - runnerUp.score < MIN_SCORE_MARGIN) return null;

  const confidence = top.sigHits >= 2 || top.score >= 15 ? 'high' : 'medium';
  return { platform: top.platform, score: top.score, confidence };
}
