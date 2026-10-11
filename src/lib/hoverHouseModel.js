/**
 * Fetch Hover job geometry and assemble a house model.
 *
 * Env vars (read here; never invent keys):
 *   HOVER_CLIENT_ID          (fallback: Hover_Client_Id)
 *   HOVER_CLIENT_SECRET      (fallback: Hover_Client_Secret, Hover_Secret_Key)
 *   HOVER_REFRESH_TOKEN      (fallback: Hover_Refresh_Token)
 *   HOVER_ACCESS_TOKEN       optional short-lived token (fallback: Hover_Access_Token)
 *
 * Endpoints used:
 *   POST https://hover.to/oauth/token
 *   GET  https://hover.to/api/v3/jobs?search=
 *   GET  https://hover.to/api/v3/jobs/{job_id}
 *   GET  https://hover.to/api/v3/models/{model_id}/artifacts/cad_export.xml?version=v2
 *   GET  https://hover.to/api/v3/models/{model_id}/artifacts/measurements.json?version=full_json
 */

import {
  assembleHoverHouse,
  assembleSolarHouse,
  applyJsonMaterials,
  toViewerModel,
} from './houseGeometry.js';

const HOVER_API = 'https://hover.to';

export function getHoverEnv(env = process.env) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = env?.[k];
      if (v && String(v).trim()) return String(v).trim();
    }
    return null;
  };
  return {
    clientId: pick('HOVER_CLIENT_ID', 'Hover_Client_Id'),
    clientSecret: pick('HOVER_CLIENT_SECRET', 'Hover_Client_Secret', 'Hover_Secret_Key'),
    refreshToken: pick('HOVER_REFRESH_TOKEN', 'Hover_Refresh_Token'),
    accessToken: pick('HOVER_ACCESS_TOKEN', 'Hover_Access_Token'),
  };
}

export function hoverCredentialsConfigured(env = process.env) {
  const c = getHoverEnv(env);
  return Boolean(c.accessToken || (c.clientId && c.clientSecret && c.refreshToken));
}

export function normalizeHoverJobId(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const fromUrl = s.match(/jobs\/(\d+-?\d+)/i) || s.match(/(\d+-\d{5,})/);
  if (fromUrl) return fromUrl[1];
  if (/^\d+-\d+$/.test(s) || /^\d+$/.test(s)) return s;
  return s;
}

let cachedToken = { value: null, expiresAt: 0 };

export async function getHoverAccessToken(env = process.env, fetchImpl = fetch) {
  const c = getHoverEnv(env);
  if (c.accessToken) return c.accessToken;
  if (cachedToken.value && Date.now() < cachedToken.expiresAt) return cachedToken.value;
  if (!c.clientId || !c.clientSecret || !c.refreshToken) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: c.refreshToken,
  });
  const resp = await fetchImpl(`${HOVER_API}/oauth/token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Hover OAuth failed (${resp.status}): ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const ttlMs = Math.max(30, Number(data.expires_in) || 7200) * 1000;
  cachedToken = { value: data.access_token, expiresAt: Date.now() + ttlMs - 60_000 };
  return data.access_token;
}

async function hoverGet(path, token, fetchImpl = fetch) {
  const resp = await fetchImpl(`${HOVER_API}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  return resp;
}

function pickModel(job) {
  const models = job?.models || job?.job?.models || [];
  const complete = models.find(m => /complete|delivered|processed|success/i.test(String(m.state || m.model_state || m.status || '')));
  return complete || models[0] || null;
}

export async function fetchHoverJobGeometry({ jobId, address, modelId } = {}, env = process.env, fetchImpl = fetch) {
  const logs = [];
  const token = await getHoverAccessToken(env, fetchImpl);
  if (!token) {
    return { ok: false, reason: 'not_configured', logs: ['Hover credentials not set'] };
  }

  let job = null;
  const id = normalizeHoverJobId(jobId);
  const tryIds = id ? [...new Set([id, id.includes('-') ? id.split('-').pop() : id])] : [];

  for (const jid of tryIds) {
    const resp = await hoverGet(`/api/v3/jobs/${encodeURIComponent(jid)}`, token, fetchImpl);
    logs.push(`GET /api/v3/jobs/${jid} → ${resp.status}`);
    if (resp.ok) {
      job = await resp.json();
      break;
    }
  }

  if (!job && address && String(address).trim().length >= 3) {
    const q = encodeURIComponent(String(address).trim());
    const resp = await hoverGet(`/api/v3/jobs?search=${q}`, token, fetchImpl);
    logs.push(`GET /api/v3/jobs?search= → ${resp.status}`);
    if (resp.ok) {
      const data = await resp.json();
      const list = data.jobs || data.results || (Array.isArray(data) ? data : []);
      job = list[0] || null;
    }
  }

  if (!job) {
    return { ok: false, reason: 'job_not_found', logs };
  }

  const model = modelId
    ? { id: modelId }
    : pickModel(job);
  const mid = model?.id || model?.model_id;
  if (!mid) {
    return { ok: false, reason: 'no_model', job, logs };
  }

  const xmlResp = await hoverGet(`/api/v3/models/${mid}/artifacts/cad_export.xml?version=v2`, token, fetchImpl);
  logs.push(`GET cad_export.xml model=${mid} → ${xmlResp.status}`);
  if (!xmlResp.ok) {
    return { ok: false, reason: 'xml_unavailable', job, modelId: mid, logs };
  }
  const xml = await xmlResp.text();

  let measurements = null;
  try {
    const jsonResp = await hoverGet(`/api/v3/models/${mid}/artifacts/measurements.json?version=full_json`, token, fetchImpl);
    logs.push(`GET measurements.json → ${jsonResp.status}`);
    if (jsonResp.ok) measurements = await jsonResp.json();
  } catch (err) {
    logs.push(`measurements.json skipped: ${err.message}`);
  }

  const threeD = job.three_d_experience || job.models?.[0]?.three_d_experience || null;

  return {
    ok: true,
    xml,
    measurements,
    job,
    modelId: mid,
    jobId: job.id || id,
    experienceUrl: threeD?.url || null,
    logs,
  };
}

export function solarFallbackParams(params = {}) {
  const b = params.building || params.siding || params.satelliteAnalysis || {};
  return {
    lengthFt: Number(b.building_length_ft || b.length_ft || params.lengthFt) || 40,
    widthFt: Number(b.building_width_ft || b.width_ft || params.widthFt) || 32,
    eaveHeightFt: Number(b.story_count || 1) * Number(b.story_height_ft || b.eave_height_ft || 9),
    pitch: b.pitch || params.pitch || '6/12',
    roofType: b.roof_type || params.roofType || 'gable',
    materials: params.materials || {},
  };
}

/**
 * Primary entry: Hover assembled model when credentials + job exist,
 * otherwise a Solar/OSM-style assembled house (roof attached to walls).
 */
export async function buildHoverHouseModel(params = {}, env = process.env, fetchImpl = fetch) {
  const photos = params.photos || [];
  const hoverAttempted = hoverCredentialsConfigured(env);
  let hover = null;
  let hoverError = null;

  if (hoverAttempted) {
    try {
      hover = await fetchHoverJobGeometry({
        jobId: params.hoverJobId || params.hover_job_id || params.jobId,
        address: params.address,
        modelId: params.hoverModelId || params.modelId,
      }, env, fetchImpl);
    } catch (err) {
      hoverError = err.message;
      hover = { ok: false, reason: 'exception', logs: [err.message] };
    }
  }

  if (hover?.ok && hover.xml) {
    const assembled = assembleHoverHouse(hover.xml, {
      address: params.address,
      hover: {
        jobId: hover.jobId,
        modelId: hover.modelId,
        experienceUrl: hover.experienceUrl,
      },
    });
    if (hover.measurements) {
      assembled.faces = applyJsonMaterials(assembled.faces, hover.measurements);
    }
    const model = toViewerModel(assembled, { photos });
    return {
      success: true,
      source: 'hover',
      hover_configured: true,
      hover_used: true,
      model,
      debug_logs: hover.logs || [],
    };
  }

  const assembled = assembleSolarHouse(solarFallbackParams(params));
  const model = toViewerModel(assembled, { photos });
  const reason = !hoverAttempted
    ? 'hover_credentials_missing'
    : (hover?.reason || hoverError || 'hover_unavailable');
  return {
    success: true,
    source: 'solar_assembled',
    hover_configured: hoverAttempted,
    hover_used: false,
    hover_reason: reason,
    model,
    debug_logs: hover?.logs || (hoverError ? [hoverError] : ['Hover not used; assembled Solar/OSM footprint instead of exploded facets']),
  };
}

export function resetHoverTokenCache() {
  cachedToken = { value: null, expiresAt: 0 };
}
