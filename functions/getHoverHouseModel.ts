import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Fetch Hover CAD XML for in-app 3D assembly.
 *
 * Env vars (Deno.env / Replit secrets — do not invent keys):
 *   HOVER_CLIENT_ID         fallback Hover_Client_Id
 *   HOVER_CLIENT_SECRET     fallback Hover_Client_Secret, Hover_Secret_Key
 *   HOVER_REFRESH_TOKEN     fallback Hover_Refresh_Token
 *   HOVER_ACCESS_TOKEN      optional, fallback Hover_Access_Token
 *
 * Canonical Node assembly: src/lib/hoverHouseModel.js (vite-functions-plugin).
 * This function returns XML when Hover auth works so the client can assemble
 * FACE→LINE→POINT geometry. Without credentials it returns hover_configured:false.
 */

function pickEnv(...keys: string[]) {
  for (const k of keys) {
    const v = Deno.env.get(k);
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function normalizeJobId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const fromUrl = s.match(/jobs\/(\d+-?\d+)/i) || s.match(/(\d+-\d{5,})/);
  if (fromUrl) return fromUrl[1];
  return s;
}

async function hoverToken(): Promise<string | null> {
  const access = pickEnv('HOVER_ACCESS_TOKEN', 'Hover_Access_Token');
  if (access) return access;
  const clientId = pickEnv('HOVER_CLIENT_ID', 'Hover_Client_Id');
  const clientSecret = pickEnv('HOVER_CLIENT_SECRET', 'Hover_Client_Secret', 'Hover_Secret_Key');
  const refresh = pickEnv('HOVER_REFRESH_TOKEN', 'Hover_Refresh_Token');
  if (!clientId || !clientSecret || !refresh) return null;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refresh,
  });
  const resp = await fetch('https://hover.to/oauth/token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) throw new Error(`Hover OAuth failed (${resp.status})`);
  const data = await resp.json();
  return data.access_token || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const params = await req.json();
    const logs: string[] = [];
    let token: string | null = null;
    try {
      token = await hoverToken();
    } catch (err) {
      logs.push(String(err));
    }

    if (!token) {
      return Response.json({
        success: true,
        source: 'solar_assembled',
        hover_configured: false,
        hover_used: false,
        hover_reason: 'hover_credentials_missing',
        model: null,
        debug_logs: logs.length ? logs : ['Hover env vars not set; client will assemble footprint geometry'],
      });
    }

    const jobId = normalizeJobId(params.hoverJobId || params.hover_job_id || params.jobId);
    const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
    let job: any = null;
    const tryIds = jobId ? [...new Set([jobId, jobId.includes('-') ? jobId.split('-').pop() : jobId])] : [];
    for (const id of tryIds) {
      const resp = await fetch(`https://hover.to/api/v3/jobs/${encodeURIComponent(String(id))}`, { headers });
      logs.push(`GET /api/v3/jobs/${id} → ${resp.status}`);
      if (resp.ok) { job = await resp.json(); break; }
    }
    if (!job && params.address && String(params.address).trim().length >= 3) {
      const resp = await fetch(`https://hover.to/api/v3/jobs?search=${encodeURIComponent(String(params.address).trim())}`, { headers });
      logs.push(`GET /api/v3/jobs?search= → ${resp.status}`);
      if (resp.ok) {
        const data = await resp.json();
        const list = data.jobs || data.results || [];
        job = list[0] || null;
      }
    }
    if (!job) {
      return Response.json({
        success: true,
        source: 'solar_assembled',
        hover_configured: true,
        hover_used: false,
        hover_reason: 'job_not_found',
        model: null,
        debug_logs: logs,
      });
    }

    const models = job.models || [];
    const model = models.find((m: any) => /complete|delivered|processed|success/i.test(String(m.state || m.status || ''))) || models[0];
    const mid = params.hoverModelId || params.modelId || model?.id || model?.model_id;
    if (!mid) {
      return Response.json({
        success: true, source: 'solar_assembled', hover_configured: true, hover_used: false,
        hover_reason: 'no_model', model: null, debug_logs: logs,
      });
    }

    const xmlResp = await fetch(`https://hover.to/api/v3/models/${mid}/artifacts/cad_export.xml?version=v2`, { headers });
    logs.push(`GET cad_export.xml model=${mid} → ${xmlResp.status}`);
    if (!xmlResp.ok) {
      return Response.json({
        success: true, source: 'solar_assembled', hover_configured: true, hover_used: false,
        hover_reason: 'xml_unavailable', model: null, debug_logs: logs,
      });
    }
    const xml = await xmlResp.text();
    return Response.json({
      success: true,
      source: 'hover',
      hover_configured: true,
      hover_used: true,
      xml,
      jobId: job.id || jobId,
      modelId: mid,
      debug_logs: logs,
    });
  } catch (err) {
    return Response.json({ success: false, error: (err as Error).message }, { status: 500 });
  }
});
