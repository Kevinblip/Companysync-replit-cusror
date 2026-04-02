const API_BASE = '/api/local/entity';

function createEntityProxy(entityName) {
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

  const safeFetch = async (label, url, opts) => {
    try {
      const response = opts ? await fetch(url, opts) : await fetch(url);
      return handleResponse(response);
    } catch (err) {
      if (!(err.message?.includes('status'))) {
        console.error(`[CompanySync_Error][API] ${entityName}.${label} network error:`, err.message);
      }
      throw err;
    }
  };

  return {
    async filter(filters = {}, sort = '-created_date', limit = 10000) {
      const params = { ...filters, _sort: sort, _limit: String(limit) };
      return safeFetch('filter', buildUrl('', params));
    },

    async list(sort = '-created_date', limit = 10000) {
      return safeFetch('list', buildUrl('', { _sort: sort, _limit: String(limit) }));
    },

    async get(id) {
      return safeFetch('get', buildUrl(id));
    },

    async create(data) {
      return safeFetch('create', buildUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    async update(id, data) {
      return safeFetch('update', buildUrl(id), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },

    async delete(id) {
      return safeFetch('delete', buildUrl(id), { method: 'DELETE' });
    },

    async bulkCreate(items) {
      return safeFetch('bulkCreate', buildUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(items),
      });
    },

    subscribe(callback) {
      return () => {};
    }
  };
}

const entityCache = {};

function getEntity(name) {
  if (!entityCache[name]) {
    entityCache[name] = createEntityProxy(name);
  }
  return entityCache[name];
}

const entitiesProxy = new Proxy({}, {
  get(target, prop) {
    if (typeof prop === 'string') {
      return getEntity(prop);
    }
    return undefined;
  }
});

export const localDb = {
  entities: entitiesProxy,
  auth: {
    me: async () => {
      try {
        const { base44 } = await import('./base44Client.js');
        return base44.auth.me();
      } catch (err) {
        console.error('[CompanySync_Error][Auth] localSdk.me failed:', err.message);
        return null;
      }
    },
    isLoggedIn: () => {
      try {
        return true;
      } catch {
        return false;
      }
    }
  },
  invokeFunction: async (functionName, params = {}, options = {}) => {
    try {
      const { base44 } = await import('./base44Client.js');
      return base44.invokeFunction(functionName, params, options);
    } catch (err) {
      console.error(`[CompanySync_Error][Functions] invokeFunction ${functionName} failed:`, err.message);
      throw err;
    }
  }
};

export default localDb;
