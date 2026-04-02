const API_BASE = '/api/local/entity';

const ENTITIES_SKIP_COMPANY_ID = new Set(['Company', 'StaffProfile', 'StormEvent', 'PlatformMenuSettings', 'SubscriptionUsage']);

function getCurrentCompanyId() {
  try {
    const impersonated = sessionStorage.getItem('impersonating_company_id');
    if (impersonated) return impersonated;
    return localStorage.getItem('last_used_company_id') || null;
  } catch {
    return null;
  }
}

function shouldInjectCompanyId(entityName, filters) {
  if (ENTITIES_SKIP_COMPANY_ID.has(entityName)) return false;
  if (filters && (filters.company_id || filters.id)) return false;
  return true;
}

function createLocalEntityProxy(entityName) {
  const buildUrl = (path = '', params = {}) => {
    const base = path ? `${API_BASE}/${entityName}/${path}` : `${API_BASE}/${entityName}`;
    const searchParams = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      }
    }
    const qs = searchParams.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const handleResponse = async (response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[CompanySync_Error][API] ${entityName} ${response.status} error:`, errorData);
      throw new Error(errorData.error || `Request failed with status ${response.status}`);
    }
    return response.json();
  };

  return {
    async filter(filters = {}, sort = '-created_date', limit = 10000) {
      const params = { ...filters, _sort: sort, _limit: String(limit) };
      if (shouldInjectCompanyId(entityName, filters)) {
        const cid = getCurrentCompanyId();
        if (cid) params.company_id = cid;
      }
      const url = buildUrl('', params);
      try {
        const response = await fetch(url);
        return handleResponse(response);
      } catch (err) {
        if (!(err.message?.includes('status'))) {
          console.error(`[CompanySync_Error][API] ${entityName}.filter network error:`, err.message);
        }
        throw err;
      }
    },

    async list(sort = '-created_date', limit = 10000) {
      const params = { _sort: sort, _limit: String(limit) };
      if (shouldInjectCompanyId(entityName, null)) {
        const cid = getCurrentCompanyId();
        if (cid) params.company_id = cid;
      }
      const url = buildUrl('', params);
      try {
        const response = await fetch(url);
        return handleResponse(response);
      } catch (err) {
        if (!(err.message?.includes('status'))) {
          console.error(`[CompanySync_Error][API] ${entityName}.list network error:`, err.message);
        }
        throw err;
      }
    },

    async get(id) {
      const url = buildUrl(id);
      try {
        const response = await fetch(url);
        return handleResponse(response);
      } catch (err) {
        if (!(err.message?.includes('status'))) {
          console.error(`[CompanySync_Error][API] ${entityName}.get(${id}) network error:`, err.message);
        }
        throw err;
      }
    },

    async create(data) {
      const payload = { ...data };
      if (!payload.company_id && !ENTITIES_SKIP_COMPANY_ID.has(entityName)) {
        const cid = getCurrentCompanyId();
        if (cid) payload.company_id = cid;
      }
      const url = buildUrl();
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return handleResponse(response);
      } catch (err) {
        if (!(err.message?.includes('status'))) {
          console.error(`[CompanySync_Error][API] ${entityName}.create network error:`, err.message);
        }
        throw err;
      }
    },

    async update(id, data) {
      const url = buildUrl(id);
      try {
        const response = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        return handleResponse(response);
      } catch (err) {
        if (!(err.message?.includes('status'))) {
          console.error(`[CompanySync_Error][API] ${entityName}.update(${id}) network error:`, err.message);
        }
        throw err;
      }
    },

    async delete(id) {
      const url = buildUrl(id);
      try {
        const response = await fetch(url, { method: 'DELETE' });
        return handleResponse(response);
      } catch (err) {
        if (!(err.message?.includes('status'))) {
          console.error(`[CompanySync_Error][API] ${entityName}.delete(${id}) network error:`, err.message);
        }
        throw err;
      }
    },

    async bulkCreate(items) {
      const cid = getCurrentCompanyId();
      const payload = items.map(item => {
        if (!item.company_id && !ENTITIES_SKIP_COMPANY_ID.has(entityName) && cid) {
          return { ...item, company_id: cid };
        }
        return item;
      });
      const url = buildUrl();
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        return handleResponse(response);
      } catch (err) {
        if (!(err.message?.includes('status'))) {
          console.error(`[CompanySync_Error][API] ${entityName}.bulkCreate network error:`, err.message);
        }
        throw err;
      }
    },

    subscribe(callback) {
      return () => {};
    }
  };
}

const entityCache = {};
function getLocalEntity(name) {
  if (!entityCache[name]) {
    entityCache[name] = createLocalEntityProxy(name);
  }
  return entityCache[name];
}

const localEntitiesProxy = new Proxy({}, {
  get(target, prop) {
    if (typeof prop === 'string') {
      return getLocalEntity(prop);
    }
    return undefined;
  }
});

const localAuth = {
  me: async () => {
    try {
      const resp = await fetch('/api/auth/user', { credentials: 'include' });
      if (resp.ok) {
        const user = await resp.json();
        const email = user.email;
        if (email) localStorage.setItem('base44_user_email', email);
        const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || (email ? email.split('@')[0] : 'Rep');
        return {
          email: email,
          full_name: fullName,
          name: fullName,
          phone: user.phone || null,
          role: user.is_administrator ? 'admin' : 'user',
          is_administrator: user.is_administrator || false,
          profile_image_url: user.profile_image_url,
          replit_user_id: user.id,
          platform_role: user.platform_role || null,
          id: user.id,
        };
      } else if (resp.status === 401) {
        localStorage.removeItem('base44_user_email');
      }
    } catch (e) {
      console.error('[CompanySync_Error][Auth] Session check failed:', e.message);
    }
    return null;
  },
  currentUser: null,
  login: () => { window.location.href = '/api/login'; },
  logout: () => {
    sessionStorage.clear();
    localStorage.removeItem('base44_user_email');
    localStorage.removeItem('last_used_company_id');
    localStorage.removeItem('selected_company_id');
    localStorage.removeItem('cachedSidebar');
    window.location.href = '/api/logout';
  },
  signup: () => { window.location.href = '/api/login'; },
  redirectToLogin: () => { window.location.href = '/api/login'; },
};

async function invokeLocalFunction(name, params, opts) {
  console.log(`[Functions] Invoking: ${name}`);
  try {
    const response = await fetch('/api/functions/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ functionName: name, params: params || {} }),
    });
    const result = await response.json();
    if (result.error) {
      console.error(`[CompanySync_Error][Functions] ${name} returned error:`, result.error);
      throw new Error(result.error);
    }
    if (result.warning) {
      console.warn(`[Functions] ${name}:`, result.warning);
    }
    console.log(`[Functions] ${name} completed successfully`);
    return result.data !== undefined ? result : { data: result };
  } catch (err) {
    console.error(`[CompanySync_Error][Functions] ${name} failed:`, err.message);
    return { error: err.message, data: {} };
  }
}

const localIntegrations = {
  Core: {
    async InvokeLLM({ prompt, file_urls, response_json_schema, model }) {
      console.log('[Core.InvokeLLM] Calling Gemini endpoint...', {
        prompt_length: prompt?.length || 0,
        file_urls: file_urls?.length || 0,
        has_schema: !!response_json_schema,
      });
      try {
        const resp = await fetch('/api/integrations/invoke-llm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, file_urls, response_json_schema, model }),
        });
        const result = await resp.json();
        if (result.error) {
          console.error('[CompanySync_Error][Core.InvokeLLM] Error:', result.error);
          throw new Error(result.error);
        }
        console.log('[Core.InvokeLLM] Success, response type:', typeof result.response);
        return result.response;
      } catch (err) {
        if (!err.message?.includes('[CompanySync_Error]')) {
          console.error('[CompanySync_Error][Core.InvokeLLM] Network error:', err.message);
        }
        throw err;
      }
    },

    async UploadFile({ file }) {
      console.log('[Core.UploadFile] Uploading:', file.name, `(${Math.round(file.size / 1024)}KB)`);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const resp = await fetch('/api/integrations/upload', {
          method: 'POST',
          body: formData,
        });
        const result = await resp.json();
        if (result.error) {
          console.error('[CompanySync_Error][Core.UploadFile] Error:', result.error);
          throw new Error(result.error);
        }
        console.log('[Core.UploadFile] Success:', result.file_url);
        return { file_url: result.file_url };
      } catch (err) {
        if (!err.message?.includes('[CompanySync_Error]')) {
          console.error('[CompanySync_Error][Core.UploadFile] Network error:', err.message);
        }
        throw err;
      }
    },

    async SendEmail({ to, subject, body, html, from }) {
      console.log('[Core.SendEmail] Sending to:', to, 'subject:', subject);
      try {
        const resp = await fetch('/api/integrations/send-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to, subject, body, html, from }),
        });
        const result = await resp.json();
        if (result.error) {
          console.error('[CompanySync_Error][Core.SendEmail] Error:', result.error);
          throw new Error(result.error);
        }
        console.log('[Core.SendEmail] Success');
        return result;
      } catch (err) {
        if (!err.message?.includes('[CompanySync_Error]')) {
          console.error('[CompanySync_Error][Core.SendEmail] Network error:', err.message);
        }
        throw err;
      }
    },

    async ExtractDataFromUploadedFile({ file_url, json_schema }) {
      console.log('[Core.ExtractDataFromUploadedFile] Extracting from:', file_url);

      const schemaDescription = json_schema?.properties
        ? Object.entries(json_schema.properties)
            .map(([k, v]) => `- ${k}: ${v.description || v.type || ''}`)
            .join('\n')
        : 'all available data';

      const prompt = `You are a data extraction assistant. Carefully analyze the provided document or image and extract the following fields:\n\n${schemaDescription}\n\nReturn ONLY a valid JSON object with these exact field names. If a field cannot be found, use null. Do not include any explanation or extra text.`;

      try {
        const resp = await fetch('/api/integrations/invoke-llm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            file_urls: [file_url],
            response_json_schema: json_schema,
            model: 'gemini-2.5-flash',
          }),
        });
        const result = await resp.json();
        if (result.error) {
          console.error('[CompanySync_Error][Core.ExtractDataFromUploadedFile] Error:', result.error);
          throw new Error(result.error);
        }

        const output = typeof result.response === 'string'
          ? JSON.parse(result.response)
          : result.response;

        console.log('[Core.ExtractDataFromUploadedFile] Success:', output);
        return { output };
      } catch (err) {
        if (!err.message?.includes('[CompanySync_Error]')) {
          console.error('[CompanySync_Error][Core.ExtractDataFromUploadedFile] Network error:', err.message);
        }
        throw err;
      }
    },
  },
};

export const base44 = {
  entities: localEntitiesProxy,
  auth: localAuth,
  invokeFunction: invokeLocalFunction,
  functions: {
    invoke: invokeLocalFunction
  },
  integrations: localIntegrations,
  storage: {
    upload: async () => { console.warn('[CompanySync_Error][Storage] Upload not available'); return null; },
    getUrl: (path) => path,
  },
  appLogs: {
    logUserInApp: async () => {},
    log: async () => {},
  },
};
