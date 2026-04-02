import * as client from "openid-client";
import { Strategy } from "openid-client/passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import passport from "passport";
import session from "express-session";
import connectPg from "connect-pg-simple";
import memoize from "memoizee";
import pkg from "pg";
const { Pool } = pkg;

function getPool() {
  if (!getPool._pool) {
    getPool._pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return getPool._pool;
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID
    );
  },
  { maxAge: 3600 * 1000 }
);

function updateUserSession(user, tokens) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(claims) {
  const pool = getPool();
  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [claims.email]);
  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE users SET
         first_name = COALESCE($2, first_name),
         last_name = COALESCE($3, last_name),
         profile_image_url = COALESCE($4, profile_image_url),
         updated_at = NOW()
       WHERE email = $1`,
      [claims.email, claims.first_name, claims.last_name, claims.profile_image_url]
    );
  } else {
    await pool.query(
      `INSERT INTO users (id, email, first_name, last_name, profile_image_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         email = COALESCE($2, users.email),
         first_name = COALESCE($3, users.first_name),
         last_name = COALESCE($4, users.last_name),
         profile_image_url = COALESCE($5, users.profile_image_url),
         updated_at = NOW()`,
      [claims.sub, claims.email, claims.first_name, claims.last_name, claims.profile_image_url]
    );
  }
}

function parseBodyMiddleware(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  if (req.body !== undefined) return next();
  let data = '';
  req.on('data', chunk => data += chunk);
  req.on('end', () => {
    try { req.body = JSON.parse(data); } catch { req.body = {}; }
    next();
  });
}

export default function authPlugin() {
  let authReady = false;
  const registeredStrategies = new Set();

  return {
    name: 'replit-auth',
    async configureServer(server) {
      try {
        const config = await getOidcConfig();

        const verify = async (tokens, verified) => {
          const user = {};
          updateUserSession(user, tokens);
          await upsertUser(tokens.claims());
          verified(null, user);
        };

        const ensureStrategy = (domain) => {
          const strategyName = `replitauth:${domain}`;
          if (!registeredStrategies.has(strategyName)) {
            const strategy = new Strategy(
              {
                name: strategyName,
                config,
                scope: "openid email profile offline_access",
                callbackURL: `https://${domain}/api/callback`,
              },
              verify
            );
            passport.use(strategy);
            registeredStrategies.add(strategyName);
          }
        };

        passport.serializeUser((user, cb) => cb(null, user));
        passport.deserializeUser((user, cb) => cb(null, user));

        if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
          passport.use(new GoogleStrategy({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: "/api/auth/google/callback",
            scope: ['profile', 'email'],
            proxy: true
          }, async (accessToken, refreshToken, profile, done) => {
            const claims = {
              sub: profile.id,
              email: profile.emails?.[0]?.value,
              first_name: profile.name?.givenName,
              last_name: profile.name?.familyName,
              profile_image_url: profile.photos?.[0]?.value
            };
            await upsertUser(claims);
            done(null, { claims });
          }));
        }

        const sessionTtl = 7 * 24 * 60 * 60 * 1000;
        const pgStore = connectPg(session);
        const sessionStore = new pgStore({
          conString: process.env.DATABASE_URL,
          createTableIfMissing: false,
          ttl: sessionTtl,
          tableName: "sessions",
        });

        const sessionMiddleware = session({
          secret: process.env.SESSION_SECRET,
          store: sessionStore,
          resave: false,
          saveUninitialized: false,
          proxy: true,
          cookie: {
            httpOnly: true,
            secure: 'auto',
            sameSite: 'lax',
            maxAge: sessionTtl,
          },
        });

        server.middlewares.use((req, res, next) => {
          if (!res.redirect) {
            res.redirect = function(urlOrStatus, url) {
              const redirectUrl = typeof urlOrStatus === 'string' ? urlOrStatus : url;
              const status = typeof urlOrStatus === 'number' ? urlOrStatus : 302;
              res.writeHead(status, { Location: redirectUrl });
              res.end();
            };
          }
          if (!res.json) {
            res.json = function(data) {
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(data));
            };
          }
          if (!res.status) {
            res.status = function(code) {
              res.statusCode = code;
              return res;
            };
          }
          if (!res.setHeader) {
            const origSetHeader = res.setHeader;
            if (!origSetHeader) {
              res.setHeader = function(name, value) {
                res._headers = res._headers || {};
                res._headers[name] = value;
              };
            }
          }
          next();
        });

        server.middlewares.use(sessionMiddleware);
        server.middlewares.use(passport.initialize());
        server.middlewares.use(passport.session());

        let localAuth = null;
        try {
          const { createRequire } = await import('module');
          const require = createRequire(import.meta.url);
          localAuth = require('./db/local-auth.cjs');
          console.log('[Auth] Local auth module loaded (signup, login-local, confirm-email, change-password)');
        } catch (e) {
          console.warn('[Auth] Local auth module not available:', e.message);
        }

        server.middlewares.use(async (req, res, next) => {
          const url = req.url?.split('?')[0];

          if (localAuth && url === '/api/signup' && req.method === 'POST') {
            const pool = getPool();
            await localAuth.handleSignup(req, res, pool);
            return;
          }

          if (localAuth && url === '/api/confirm-email') {
            const pool = getPool();
            await localAuth.handleConfirmEmail(req, res, pool);
            return;
          }

          if (localAuth && url === '/api/login-local' && req.method === 'POST') {
            const pool = getPool();
            await localAuth.handleLoginLocal(req, res, pool);
            return;
          }

          if (url === '/api/auth/google') {
            return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
          }

          if (url === '/api/auth/google/callback') {
            return passport.authenticate('google', {
              successRedirect: '/',
              failureRedirect: '/login'
            })(req, res, next);
          }

          if (localAuth && url === '/api/change-password' && req.method === 'POST') {
            const pool = getPool();
            await localAuth.handleChangePassword(req, res, pool);
            return;
          }

          if (localAuth && url === '/api/forgot-password' && req.method === 'POST') {
            const pool = getPool();
            await localAuth.handleForgotPassword(req, res, pool);
            return;
          }

          if (localAuth && url === '/api/reset-password' && req.method === 'POST') {
            const pool = getPool();
            await localAuth.handleResetPassword(req, res, pool);
            return;
          }

          if (url === '/api/login') {
            const domain = req.headers.host;
            ensureStrategy(domain);
            return passport.authenticate(`replitauth:${domain}`, {
              prompt: "login consent",
              scope: ["openid", "email", "profile", "offline_access"],
            })(req, res, next);
          }

          if (url === '/api/callback') {
            const domain = req.headers.host;
            ensureStrategy(domain);
            return passport.authenticate(`replitauth:${domain}`, {
              successReturnToOrRedirect: "/",
              failureRedirect: "/api/login",
            })(req, res, next);
          }

          if (url === '/api/logout') {
            const clearCookieHeader = 'connect.sid=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax';
            const postLogoutUri = `https://${req.headers.host}`;
            const doRedirect = () => {
              try {
                const redirectUrl = client.buildEndSessionUrl(config, {
                  client_id: process.env.REPL_ID,
                  post_logout_redirect_uri: postLogoutUri,
                }).href;
                res.writeHead(302, { Location: redirectUrl, 'Set-Cookie': clearCookieHeader });
                res.end();
              } catch (e) {
                console.error('[Auth] End session URL error:', e);
                res.writeHead(302, { Location: '/', 'Set-Cookie': clearCookieHeader });
                res.end();
              }
            };

            req.logout(() => {
              if (req.session) {
                req.session.destroy((err) => {
                  if (err) console.error('[Auth] Session destroy error:', err);
                  doRedirect();
                });
              } else {
                doRedirect();
              }
            });
            return;
          }

          if (url === '/api/auth/user') {
            if (!req.isAuthenticated || !req.isAuthenticated() || !req.user?.claims) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Unauthorized' }));
              return;
            }

            const claims = req.user.claims;
            const pool = getPool();
            pool.query('SELECT * FROM users WHERE id = $1', [claims.sub])
              .then(async result => {
                const userRow = result.rows[0] || null;
                const email = ((userRow?.email || claims.email) || '').toLowerCase();
                let is_administrator = false;
                try {
                  const spResult = await pool.query(
                    'SELECT is_administrator, is_super_admin FROM staff_profiles WHERE user_email = $1 AND is_active = true ORDER BY is_administrator DESC LIMIT 1',
                    [email]
                  );
                  if (spResult.rows.length > 0) {
                    is_administrator = !!(spResult.rows[0].is_administrator || spResult.rows[0].is_super_admin);
                  }
                } catch (e) {
                  console.error('[Auth] Staff profile lookup error:', e.message);
                }
                if (userRow) {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ...userRow, is_administrator }));
                } else {
                  res.writeHead(200, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({
                    id: claims.sub,
                    email: claims.email,
                    first_name: claims.first_name,
                    last_name: claims.last_name,
                    profile_image_url: claims.profile_image_url,
                    is_administrator,
                  }));
                }
              })
              .catch(err => {
                console.error('[Auth] Error fetching user:', err);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ message: 'Failed to fetch user' }));
              });
            return;
          }

          next();
        });

        authReady = true;
        console.log('[Auth] Replit Auth plugin loaded');
        console.log('[Auth] Login: /api/login');
        console.log('[Auth] Logout: /api/logout');
        console.log('[Auth] User info: /api/auth/user');
      } catch (err) {
        console.error('[Auth] Failed to initialize:', err.message);
      }
    },
  };
}
