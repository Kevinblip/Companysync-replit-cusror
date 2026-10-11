import * as client from "openid-client";
import { Strategy } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import connectPg from "connect-pg-simple";
import memoize from "memoizee";
import pkg from "pg";
import { createRequire } from "module";
const { Pool } = pkg;
const require = createRequire(import.meta.url);
const googleAuth = require('./db/google-auth.cjs');
const prodAuth = require('./db/prod-auth.cjs');

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
  if (!claims?.email) return null;
  const pool = getPool();
  return googleAuth.upsertGoogleUser(pool, {
    sub: claims.sub,
    email: claims.email,
    given_name: claims.first_name,
    family_name: claims.last_name,
    picture: claims.profile_image_url,
  });
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
        if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET) {
          console.warn('[Auth] DATABASE_URL or SESSION_SECRET missing — auth routes not registered');
          return;
        }

        let oidcConfig = null;
        try {
          if (process.env.REPL_ID) {
            oidcConfig = await getOidcConfig();
          } else {
            console.warn('[Auth] REPL_ID not set — Replit OIDC login disabled; local email/password and Google still work');
          }
        } catch (oidcErr) {
          console.warn('[Auth] Replit OIDC init skipped:', oidcErr.message);
        }

        const verify = async (tokens, verified) => {
          const user = {};
          updateUserSession(user, tokens);
          await upsertUser(tokens.claims());
          verified(null, user);
        };

        const ensureStrategy = (domain) => {
          if (!oidcConfig) return;
          const strategyName = `replitauth:${domain}`;
          if (!registeredStrategies.has(strategyName)) {
            const strategy = new Strategy(
              {
                name: strategyName,
                config: oidcConfig,
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
            return googleAuth.handleGoogleStart(req, res);
          }

          if (url === '/api/auth/google/callback') {
            return googleAuth.handleGoogleCallback(req, res, {
              pool: getPool(),
              createSession: prodAuth.createSession,
            });
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
            if (!oidcConfig) {
              res.writeHead(302, { Location: '/login' });
              res.end();
              return;
            }
            const domain = req.headers.host;
            ensureStrategy(domain);
            return passport.authenticate(`replitauth:${domain}`, {
              prompt: "login consent",
              scope: ["openid", "email", "profile", "offline_access"],
            })(req, res, next);
          }

          if (url === '/api/callback') {
            if (!oidcConfig) {
              res.writeHead(302, { Location: '/login' });
              res.end();
              return;
            }
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
                if (!oidcConfig) {
                  res.writeHead(302, { Location: '/', 'Set-Cookie': clearCookieHeader });
                  res.end();
                  return;
                }
                const redirectUrl = client.buildEndSessionUrl(oidcConfig, {
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
        console.log('[Auth] Auth plugin loaded (Replit OIDC:', oidcConfig ? 'enabled' : 'disabled', ')');
        console.log('[Auth] Login: /api/login-local, /api/auth/google' + (oidcConfig ? ', /api/login' : ''));
        console.log('[Auth] Logout: /api/logout');
        console.log('[Auth] User info: /api/auth/user');
      } catch (err) {
        console.error('[Auth] Failed to initialize:', err.message);
      }
    },
  };
}
