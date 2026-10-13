const crypto = require('crypto');

const ISSUER_URL = process.env.ISSUER_URL || 'https://replit.com/oidc';
const SESSION_SECRET = process.env.SESSION_SECRET;
const REPL_ID = process.env.REPL_ID;
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

let oidcDiscovery = null;

async function getOidcDiscovery() {
  if (oidcDiscovery) return oidcDiscovery;
  const wellKnownUrl = ISSUER_URL.replace(/\/+$/, '') + '/.well-known/openid-configuration';
  const resp = await fetch(wellKnownUrl);
  if (!resp.ok) throw new Error(`OIDC discovery failed: ${resp.status}`);
  oidcDiscovery = await resp.json();
  return oidcDiscovery;
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach(c => {
    const idx = c.indexOf('=');
    if (idx > 0) {
      const key = c.slice(0, idx).trim();
      const val = c.slice(idx + 1).trim();
      try { cookies[key] = decodeURIComponent(val); } catch { cookies[key] = val; }
    }
  });
  return cookies;
}

function unsignCookie(signedValue, secret) {
  if (!signedValue || !signedValue.startsWith('s:')) return null;
  const val = signedValue.slice(2);
  const dotIndex = val.lastIndexOf('.');
  if (dotIndex === -1) return null;
  const sid = val.slice(0, dotIndex);
  const sig = val.slice(dotIndex + 1);
  const expected = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  if (sig === expected) return sid;
  return null;
}

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

async function getSessionFromRequest(req, pool) {
  if (!SESSION_SECRET) return null;
  const cookies = parseCookies(req.headers.cookie);
  const signedSid = cookies['connect.sid'];
  if (!signedSid) return null;
  const sid = unsignCookie(signedSid, SESSION_SECRET);
  if (!sid) return null;
  try {
    const result = await pool.query('SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()', [sid]);
    if (result.rows.length > 0) {
      const sess = result.rows[0].sess;
      return { sid, data: typeof sess === 'string' ? JSON.parse(sess) : sess };
    }
  } catch (e) {
    console.error('[Auth] Session lookup error:', e.message);
  }
  return null;
}

async function createSession(pool, sessionData) {
  const sid = crypto.randomUUID();
  const expire = new Date(Date.now() + SESSION_MAX_AGE);
  try {
    await pool.query(
      'INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2::jsonb, $3) ON CONFLICT (sid) DO UPDATE SET sess = $2::jsonb, expire = $3',
      [sid, JSON.stringify(sessionData), expire]
    );
    return sid;
  } catch (e) {
    console.error('[Auth] Create session error:', e.message);
    return null;
  }
}

async function destroySession(pool, sid) {
  try {
    await pool.query('DELETE FROM sessions WHERE sid = $1', [sid]);
  } catch (e) {
    console.error('[Auth] Destroy session error:', e.message);
  }
}

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

const pendingAuth = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of pendingAuth) {
    if (now - val.createdAt > 600000) pendingAuth.delete(key);
  }
}, 60000);

async function handleLogin(req, res, pool) {
  if (!SESSION_SECRET) {
    console.error('[Auth] SESSION_SECRET not configured - cannot handle auth');
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server authentication not configured');
    return;
  }
  if (!REPL_ID) {
    console.error('[Auth] REPL_ID not available - cannot handle OIDC');
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server authentication not configured');
    return;
  }
  try {
    const discovery = await getOidcDiscovery();
    const domain = req.headers.host || req.headers[':authority'] || '';
    const callbackUrl = `https://${domain}/api/callback`;

    const { verifier, challenge } = generatePKCE();
    const state = crypto.randomBytes(16).toString('hex');

    pendingAuth.set(state, { verifier, callbackUrl, createdAt: Date.now() });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: REPL_ID,
      redirect_uri: callbackUrl,
      scope: 'openid email profile offline_access',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'login consent',
    });

    const authUrl = discovery.authorization_endpoint + '?' + params.toString();
    res.writeHead(302, { Location: authUrl });
    res.end();
  } catch (e) {
    console.error('[Auth] Login error:', e.message);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Authentication error');
  }
}

async function handleCallback(req, res, pool) {
  try {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      console.error('[Auth] OIDC error:', error, url.searchParams.get('error_description'));
      res.writeHead(302, { Location: '/' });
      res.end();
      return;
    }

    if (!code || !state) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing code or state');
      return;
    }

    const pending = pendingAuth.get(state);
    if (!pending) {
      console.error('[Auth] Invalid or expired state');
      res.writeHead(302, { Location: '/api/login' });
      res.end();
      return;
    }
    pendingAuth.delete(state);

    const discovery = await getOidcDiscovery();
    const tokenResp = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: pending.callbackUrl,
        client_id: REPL_ID,
        code_verifier: pending.verifier,
      }).toString(),
    });

    if (!tokenResp.ok) {
      const errText = await tokenResp.text();
      console.error('[Auth] Token exchange failed:', tokenResp.status, errText);
      res.writeHead(302, { Location: '/api/login' });
      res.end();
      return;
    }

    const tokens = await tokenResp.json();
    let claims = {};

    if (tokens.access_token && discovery.userinfo_endpoint) {
      try {
        const userinfoResp = await fetch(discovery.userinfo_endpoint, {
          headers: { 'Authorization': `Bearer ${tokens.access_token}` },
        });
        if (userinfoResp.ok) {
          claims = await userinfoResp.json();
          console.log('[Auth] Verified user claims from userinfo endpoint:', claims.email);
        }
      } catch (e) {
        console.error('[Auth] Userinfo fetch error:', e.message);
      }
    }

    if (!claims.sub && tokens.id_token) {
      try {
        const parts = tokens.id_token.split('.');
        if (parts.length === 3) {
          claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
          console.log('[Auth] Decoded claims from id_token (fallback):', claims.email);
        }
      } catch (e) {
        console.error('[Auth] JWT decode error:', e.message);
      }
    }

    if (claims.sub && claims.email) {
      try {
        await pool.query(
          `INSERT INTO users (id, email, first_name, last_name, profile_image_url, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET
             email = COALESCE($2, users.email),
             first_name = COALESCE($3, users.first_name),
             last_name = COALESCE($4, users.last_name),
             profile_image_url = COALESCE($5, users.profile_image_url),
             updated_at = NOW()`,
          [claims.sub, claims.email, claims.first_name || null, claims.last_name || null, claims.profile_image_url || null]
        );
      } catch (e) {
        console.error('[Auth] User upsert error:', e.message);
      }
    }

    const sessionData = {
      cookie: { originalMaxAge: SESSION_MAX_AGE, expires: new Date(Date.now() + SESSION_MAX_AGE).toISOString(), httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
      passport: {
        user: {
          claims,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: claims.exp,
        }
      }
    };

    const sid = await createSession(pool, sessionData);
    if (!sid) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Session creation failed');
      return;
    }

    const signedSid = signSessionId(sid, SESSION_SECRET);
    const cookieValue = `connect.sid=${encodeURIComponent(signedSid)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(SESSION_MAX_AGE / 1000)}`;
    res.writeHead(302, {
      Location: '/',
      'Set-Cookie': cookieValue,
    });
    res.end();
  } catch (e) {
    console.error('[Auth] Callback error:', e.message, e.stack);
    res.writeHead(302, { Location: '/' });
    res.end();
  }
}

async function handleGetUser(req, res, pool) {
  try {
    const session = await getSessionFromRequest(req, pool);
    if (!session?.data?.passport?.user?.claims) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Unauthorized' }));
      return;
    }

    const claims = session.data.passport.user.claims;
    let userRow = null;
    try {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [claims.sub]);
      if (result.rows.length > 0) userRow = result.rows[0];
    } catch (e) {
      console.error('[Auth] User lookup error:', e.message);
    }

    const email = (userRow?.email || claims.email || '').toLowerCase();
    // Hardcoded YICN admin emails — always admin regardless of DB state
    // NOTE: Only the owner (Kevin) is hardcoded. All other staff admin status is DB-driven.
    const YICN_ADMIN_EMAILS = new Set([
      'yicnteam@gmail.com',
    ]);
    let is_administrator = YICN_ADMIN_EMAILS.has(email);
    try {
      const spResult = await pool.query(
        'SELECT is_administrator, is_super_admin FROM staff_profiles WHERE user_email = $1 AND is_active = true ORDER BY is_administrator DESC LIMIT 1',
        [email]
      );
      if (spResult.rows.length > 0) {
        is_administrator = is_administrator || !!(spResult.rows[0].is_administrator || spResult.rows[0].is_super_admin);
      }
    } catch (e) {
      console.error('[Auth] Staff profile lookup error:', e.message);
    }

    if (userRow) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ...userRow, is_administrator }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: claims.sub,
      email: claims.email,
      first_name: claims.first_name,
      last_name: claims.last_name,
      profile_image_url: claims.profile_image_url,
      is_administrator,
    }));
  } catch (e) {
    console.error('[Auth] GetUser error:', e.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Server error' }));
  }
}

async function handleLogout(req, res, pool) {
  try {
    const session = await getSessionFromRequest(req, pool);
    if (session?.sid) {
      await destroySession(pool, session.sid);
    }

    const clearCookie = 'connect.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax';
    const postLogoutUri = `https://${req.headers.host}`;

    try {
      const discovery = await getOidcDiscovery();
      if (discovery.end_session_endpoint) {
        const params = new URLSearchParams({
          client_id: REPL_ID,
          post_logout_redirect_uri: postLogoutUri,
        });
        const logoutUrl = discovery.end_session_endpoint + '?' + params.toString();
        res.writeHead(302, { Location: logoutUrl, 'Set-Cookie': clearCookie });
        res.end();
        return;
      }
    } catch (e) {
      console.error('[Auth] OIDC logout URL error:', e.message);
    }

    res.writeHead(302, { Location: '/', 'Set-Cookie': clearCookie });
    res.end();
  } catch (e) {
    console.error('[Auth] Logout error:', e.message);
    res.writeHead(302, { Location: '/' });
    res.end();
  }
}

module.exports = {
  handleLogin,
  handleCallback,
  handleGetUser,
  handleLogout,
  getSessionFromRequest,
  parseCookies,
  createSession,
};
