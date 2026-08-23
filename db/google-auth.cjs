const crypto = require('crypto');

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const PRODUCTION_CALLBACK_URI = 'https://getcompanysync.com/api/auth/google/callback';
const PRODUCTION_CLIENT_ID =
  '783326703651-7cked810oe2o1tvt0vdtrd3n6ai0q0tc.apps.googleusercontent.com';

function trimEnv(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getGoogleOAuthCredentials(env = process.env) {
  const clientId = trimEnv(env.GOOGLE_CLIENT_ID || env.Google_Client_Id);
  const clientSecret = trimEnv(env.GOOGLE_CLIENT_SECRET || env.Google_Secret_Key);
  return { clientId, clientSecret };
}

function firstHeaderValue(value) {
  if (!value) return '';
  return String(value).split(',')[0].trim();
}

function stripDefaultPort(host) {
  return host.replace(/:(443|80)$/, '');
}

function getPublicOrigin(req) {
  const proto = firstHeaderValue(req?.headers?.['x-forwarded-proto']) || 'https';
  const host = stripDefaultPort(
    firstHeaderValue(req?.headers?.['x-forwarded-host']) ||
      firstHeaderValue(req?.headers?.host) ||
      ''
  );
  return `${proto}://${host}`;
}

function getGoogleCallbackUrl(req, env = process.env) {
  const override = trimEnv(env.GOOGLE_OAUTH_REDIRECT_URI);
  if (override) return override;

  const host = stripDefaultPort(
    firstHeaderValue(req?.headers?.['x-forwarded-host']) ||
      firstHeaderValue(req?.headers?.host) ||
      ''
  ).toLowerCase();

  if (host === 'getcompanysync.com' || host === 'www.getcompanysync.com') {
    return PRODUCTION_CALLBACK_URI;
  }

  return `${getPublicOrigin(req)}/api/auth/google/callback`;
}

function credentialLogSafe(credentials) {
  const { clientId, clientSecret } = credentials;
  return {
    has_client_id: !!clientId,
    has_client_secret: !!clientSecret,
    client_id_prefix: clientId ? `${clientId.slice(0, 16)}…` : null,
    client_id_matches_production: clientId === PRODUCTION_CLIENT_ID,
  };
}

function signSessionId(sid, secret) {
  const sig = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
  return 's:' + sid + '.' + sig;
}

function buildSessionCookie(sid, req, env = process.env) {
  const secret = trimEnv(env.SESSION_SECRET);
  if (!secret) {
    throw new Error('SESSION_SECRET is not configured');
  }
  if (!sid) {
    throw new Error('Session id missing');
  }
  const signed = signSessionId(sid, secret);
  const secure = !getPublicOrigin(req).startsWith('http://');
  const parts = [
    `connect.sid=${encodeURIComponent(signed)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_MAX_AGE / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function redirect(res, location, extraHeaders) {
  const headers = { Location: location, ...(extraHeaders || {}) };
  res.writeHead(302, headers);
  res.end();
}

function parseRequestUrl(req) {
  const host = firstHeaderValue(req?.headers?.host) || 'localhost';
  return new URL(req.url, `https://${host}`);
}

function sanitizeTokenError(tokens, status) {
  return {
    status,
    error: tokens?.error || null,
    error_description: tokens?.error_description || null,
  };
}

async function exchangeGoogleCode({ code, redirectUri, credentials, fetchImpl = fetch }) {
  if (!code) {
    throw Object.assign(new Error('Missing authorization code'), { code: 'missing_code' });
  }
  if (!credentials.clientId || !credentials.clientSecret) {
    throw Object.assign(new Error('Google OAuth credentials are not configured'), {
      code: 'not_configured',
    });
  }

  const tokenResp = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  let tokens = {};
  try {
    tokens = await tokenResp.json();
  } catch {
    tokens = {};
  }

  if (!tokenResp.ok || !tokens.access_token) {
    const err = new Error('Failed to exchange Google authorization code');
    err.code = 'token_exchange_failed';
    err.details = sanitizeTokenError(tokens, tokenResp.status);
    throw err;
  }

  return tokens;
}

async function fetchGoogleProfile(accessToken, fetchImpl = fetch) {
  const userinfoResp = await fetchImpl('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  let profile = {};
  try {
    profile = await userinfoResp.json();
  } catch {
    profile = {};
  }
  if (!userinfoResp.ok || !profile.sub) {
    const err = new Error('Failed to load Google user profile');
    err.code = 'userinfo_failed';
    err.details = { status: userinfoResp.status, error: profile.error || profile.error_description || null };
    throw err;
  }
  return profile;
}

async function upsertGoogleUser(pool, profile) {
  const email = String(profile.email || '').toLowerCase().trim();
  if (!email) {
    throw Object.assign(new Error('Google account did not provide an email address'), {
      code: 'missing_email',
    });
  }

  const firstName = profile.given_name || profile.first_name || '';
  const lastName = profile.family_name || profile.last_name || '';
  const photo = profile.picture || profile.profile_image_url || null;
  const googleSub = profile.sub || profile.id;

  const existing = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [email]
  );

  if (existing.rows.length > 0) {
    const user = existing.rows[0];
    await pool.query(
      `UPDATE users SET
         first_name = COALESCE(NULLIF($2, ''), first_name),
         last_name = COALESCE(NULLIF($3, ''), last_name),
         profile_image_url = COALESCE($4, profile_image_url),
         updated_at = NOW()
       WHERE id = $1`,
      [user.id, firstName, lastName, photo]
    );
    return {
      id: user.id,
      email: user.email || email,
      first_name: firstName || user.first_name || '',
      last_name: lastName || user.last_name || '',
      company_id: user.company_id || null,
      profile_image_url: photo || user.profile_image_url || null,
    };
  }

  let companyId = null;
  try {
    const staff = await pool.query(
      `SELECT company_id FROM staff_profiles
       WHERE LOWER(user_email) = $1 AND is_active = true
       ORDER BY created_at ASC LIMIT 1`,
      [email]
    );
    if (staff.rows[0]?.company_id) {
      companyId = staff.rows[0].company_id;
    }
  } catch (e) {
    console.warn('[GoogleAuth] Staff profile lookup failed:', e.message);
  }

  const userId = googleSub || ('ggl_' + crypto.randomUUID());
  try {
    await pool.query(
      `INSERT INTO users (id, email, first_name, last_name, profile_image_url, is_local_auth, company_id, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, false, $6, NOW(), NOW())`,
      [userId, email, firstName, lastName, photo, companyId]
    );
  } catch (e) {
    if (e && e.code === '23505') {
      const raced = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1', [email]);
      if (raced.rows[0]) {
        return {
          id: raced.rows[0].id,
          email: raced.rows[0].email || email,
          first_name: raced.rows[0].first_name || firstName,
          last_name: raced.rows[0].last_name || lastName,
          company_id: raced.rows[0].company_id || companyId,
          profile_image_url: raced.rows[0].profile_image_url || photo,
        };
      }
    }
    throw e;
  }

  return {
    id: userId,
    email,
    first_name: firstName,
    last_name: lastName,
    company_id: companyId,
    profile_image_url: photo,
  };
}

function buildSessionData(user) {
  return {
    cookie: {
      originalMaxAge: SESSION_MAX_AGE,
      expires: new Date(Date.now() + SESSION_MAX_AGE).toISOString(),
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    },
    passport: {
      user: {
        claims: {
          sub: user.id,
          email: user.email,
          first_name: user.first_name || '',
          last_name: user.last_name || '',
          full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
          profile_image_url: user.profile_image_url || null,
        },
      },
    },
  };
}

function handleGoogleStart(req, res, env = process.env) {
  const credentials = getGoogleOAuthCredentials(env);
  if (!credentials.clientId) {
    console.error('[GoogleAuth] Missing client ID', credentialLogSafe(credentials));
    redirect(res, '/login?error=google_not_configured');
    return;
  }

  const callbackUrl = getGoogleCallbackUrl(req, env);
  const params = new URLSearchParams({
    client_id: credentials.clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: 'profile email',
    access_type: 'online',
    prompt: 'select_account',
    include_granted_scopes: 'true',
  });
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}

async function handleGoogleCallback(req, res, deps) {
  const {
    pool,
    createSession,
    fetchImpl = fetch,
    env = process.env,
  } = deps;

  try {
    const url = parseRequestUrl(req);
    const providerError = url.searchParams.get('error');
    if (providerError === 'access_denied') {
      console.warn('[GoogleAuth] User cancelled Google consent');
      redirect(res, '/login?error=access_denied');
      return;
    }
    if (providerError) {
      console.error('[GoogleAuth] Provider returned error:', providerError, url.searchParams.get('error_description') || '');
      redirect(res, '/login?error=google_auth_failed');
      return;
    }

    const credentials = getGoogleOAuthCredentials(env);
    const callbackUrl = getGoogleCallbackUrl(req, env);

    if (!credentials.clientId || !credentials.clientSecret) {
      console.error('[GoogleAuth] Missing OAuth credentials on callback', credentialLogSafe(credentials));
      redirect(res, '/login?error=google_auth_failed');
      return;
    }

    const tokens = await exchangeGoogleCode({
      code: url.searchParams.get('code'),
      redirectUri: callbackUrl,
      credentials,
      fetchImpl,
    });

    const profile = await fetchGoogleProfile(tokens.access_token, fetchImpl);
    const user = await upsertGoogleUser(pool, profile);
    const sid = await createSession(pool, buildSessionData(user));
    if (!sid) {
      console.error('[GoogleAuth] Session insert failed for', user.email);
      redirect(res, '/login?error=google_auth_failed');
      return;
    }

    const cookie = buildSessionCookie(sid, req, env);
    console.log('[GoogleAuth] Signed in', user.email);
    redirect(res, '/', { 'Set-Cookie': cookie });
  } catch (err) {
    const safe = {
      reason: err.code || 'callback_exception',
      message: err.message,
      details: err.details || null,
    };
    console.error('[GoogleAuth] Callback failed:', JSON.stringify(safe));
    redirect(res, '/login?error=google_auth_failed');
  }
}

module.exports = {
  PRODUCTION_CALLBACK_URI,
  PRODUCTION_CLIENT_ID,
  getGoogleOAuthCredentials,
  getPublicOrigin,
  getGoogleCallbackUrl,
  credentialLogSafe,
  sanitizeTokenError,
  exchangeGoogleCode,
  fetchGoogleProfile,
  upsertGoogleUser,
  buildSessionData,
  buildSessionCookie,
  handleGoogleStart,
  handleGoogleCallback,
};
