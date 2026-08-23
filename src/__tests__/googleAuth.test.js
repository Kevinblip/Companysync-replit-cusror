import { createRequire } from 'module'
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { googleLoginErrorMessage } from '../lib/googleLoginErrors.js'

const require = createRequire(import.meta.url)
const googleAuth = require('../../db/google-auth.cjs')

function mockRes() {
  return {
    status: null,
    headers: null,
    body: null,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body) {
      this.body = body
    },
  }
}

function mockPool(handlers) {
  return {
    async query(sql, params) {
      const key = Object.keys(handlers).find((k) => sql.includes(k))
      if (!key) {
        throw new Error(`Unexpected query: ${sql}`)
      }
      return handlers[key](params, sql)
    },
  }
}

describe('googleLoginErrorMessage', () => {
  it('does not blame pop-ups for a failed full-page Google redirect', () => {
    const message = googleLoginErrorMessage('google_auth_failed')
    assert.match(message, /Google sign-in failed/)
    assert.doesNotMatch(message.toLowerCase(), /pop-?up/)
  })

  it('explains a cancelled consent', () => {
    assert.equal(googleLoginErrorMessage('access_denied'), 'Google sign-in was cancelled.')
  })
})

describe('Google OAuth credentials and callback URL', () => {
  it('reads standard env names and Replit calendar aliases', () => {
    assert.deepEqual(googleAuth.getGoogleOAuthCredentials({
      GOOGLE_CLIENT_ID: ' id-1 ',
      GOOGLE_CLIENT_SECRET: ' secret-1 ',
    }), { clientId: 'id-1', clientSecret: 'secret-1' })

    assert.deepEqual(googleAuth.getGoogleOAuthCredentials({
      Google_Client_Id: 'alias-id',
      Google_Secret_Key: 'alias-secret',
    }), { clientId: 'alias-id', clientSecret: 'alias-secret' })
  })

  it('normalizes production hosts to the registered redirect URI', () => {
    assert.equal(googleAuth.getGoogleCallbackUrl({
      headers: { host: 'www.getcompanysync.com' },
    }), googleAuth.PRODUCTION_CALLBACK_URI)

    assert.equal(googleAuth.getGoogleCallbackUrl({
      headers: { host: 'getcompanysync.com:443' },
    }), googleAuth.PRODUCTION_CALLBACK_URI)
  })

  it('honors an explicit redirect override', () => {
    assert.equal(googleAuth.getGoogleCallbackUrl(
      { headers: { host: 'internal:8080' } },
      { GOOGLE_OAUTH_REDIRECT_URI: 'https://getcompanysync.com/api/auth/google/callback' }
    ), 'https://getcompanysync.com/api/auth/google/callback')
  })
})

describe('exchangeGoogleCode', () => {
  it('does not treat a valid code as success when Google returns no access token', async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }),
    })

    await assert.rejects(
      googleAuth.exchangeGoogleCode({
        code: 'valid-looking-code',
        redirectUri: googleAuth.PRODUCTION_CALLBACK_URI,
        credentials: { clientId: 'id', clientSecret: 'secret' },
        fetchImpl,
      }),
      (err) => {
        assert.equal(err.code, 'token_exchange_failed')
        assert.equal(err.details.error, 'invalid_client')
        assert.equal(err.details.status, 401)
        return true
      }
    )
  })

  it('returns tokens when Google accepts the code', async () => {
    let postedBody = ''
    const fetchImpl = async (_url, opts) => {
      postedBody = opts.body
      return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.ok', token_type: 'Bearer' }) }
    }

    const tokens = await googleAuth.exchangeGoogleCode({
      code: 'real-code',
      redirectUri: googleAuth.PRODUCTION_CALLBACK_URI,
      credentials: { clientId: 'id', clientSecret: 'secret' },
      fetchImpl,
    })
    assert.equal(tokens.access_token, 'ya29.ok')
    assert.match(postedBody, /grant_type=authorization_code/)
    assert.match(postedBody, /code=real-code/)
    assert.doesNotMatch(postedBody, /undefined/)
  })
})

describe('upsertGoogleUser', () => {
  it('logs into an existing email/password user instead of inserting a Google sub id', async () => {
    const pool = mockPool({
      'SELECT * FROM users': async () => ({
        rows: [{
          id: 'loc_existing',
          email: 'owner@example.com',
          first_name: 'Pat',
          last_name: '',
          company_id: 'co_1',
          profile_image_url: null,
        }],
      }),
      'UPDATE users SET': async () => ({ rows: [] }),
    })

    const user = await googleAuth.upsertGoogleUser(pool, {
      sub: 'google-sub-999',
      email: 'owner@example.com',
      given_name: 'Pat',
      family_name: 'Lee',
      picture: 'https://example.com/p.jpg',
    })

    assert.equal(user.id, 'loc_existing')
    assert.equal(user.company_id, 'co_1')
  })

  it('creates a new user when the email is new', async () => {
    const inserts = []
    const pool = mockPool({
      'SELECT * FROM users': async () => ({ rows: [] }),
      'SELECT company_id FROM staff_profiles': async () => ({ rows: [] }),
      'INSERT INTO users': async (params) => {
        inserts.push(params)
        return { rows: [] }
      },
    })

    const user = await googleAuth.upsertGoogleUser(pool, {
      sub: 'google-sub-1',
      email: 'new.subscriber@gmail.com',
      given_name: 'New',
      family_name: 'Sub',
    })

    assert.equal(user.id, 'google-sub-1')
    assert.equal(user.email, 'new.subscriber@gmail.com')
    assert.equal(inserts[0][0], 'google-sub-1')
    assert.equal(inserts[0][1], 'new.subscriber@gmail.com')
  })

  it('recovers from an email unique-constraint race instead of failing the login', async () => {
    let userLookups = 0
    const pool = mockPool({
      'SELECT * FROM users': async () => {
        userLookups += 1
        if (userLookups === 1) return { rows: [] }
        return { rows: [{ id: 'loc_raced', email: 'raced@example.com', company_id: 'co_9' }] }
      },
      'SELECT company_id FROM staff_profiles': async () => ({ rows: [] }),
      'INSERT INTO users': async () => {
        const err = new Error('duplicate key value violates unique constraint "users_email_key"')
        err.code = '23505'
        throw err
      },
    })

    const user = await googleAuth.upsertGoogleUser(pool, {
      sub: 'google-sub-2',
      email: 'raced@example.com',
    })
    assert.equal(user.id, 'loc_raced')
  })
})

describe('handleGoogleCallback', () => {
  const env = {
    GOOGLE_CLIENT_ID: googleAuth.PRODUCTION_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: 'not-a-real-secret',
    SESSION_SECRET: 'session-secret-for-tests',
  }

  it('does not dump a valid code onto google_auth_failed', async () => {
    const fetchImpl = async (url) => {
      if (String(url).includes('/token')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'ya29.ok' }) }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sub: 'google-sub-ok',
          email: 'new.subscriber@gmail.com',
          given_name: 'Ada',
          family_name: 'Lovelace',
        }),
      }
    }
    const pool = mockPool({
      'SELECT * FROM users': async () => ({ rows: [] }),
      'SELECT company_id FROM staff_profiles': async () => ({ rows: [] }),
      'INSERT INTO users': async () => ({ rows: [] }),
    })
    const res = mockRes()

    await googleAuth.handleGoogleCallback(
      { url: '/api/auth/google/callback?code=valid-code', headers: { host: 'getcompanysync.com' } },
      res,
      {
        pool,
        createSession: async () => 'sid-123',
        fetchImpl,
        env,
      }
    )

    assert.equal(res.status, 302)
    assert.equal(res.headers.Location, '/')
    assert.match(res.headers['Set-Cookie'], /connect\.sid=/)
    assert.doesNotMatch(res.headers.Location, /google_auth_failed/)
  })

  it('redirects to access_denied when the user cancels consent', async () => {
    const res = mockRes()
    await googleAuth.handleGoogleCallback(
      { url: '/api/auth/google/callback?error=access_denied', headers: { host: 'getcompanysync.com' } },
      res,
      { pool: mockPool({}), createSession: async () => null, env }
    )
    assert.equal(res.headers.Location, '/login?error=access_denied')
  })

  it('logs a token failure and uses google_auth_failed without leaking the secret', async () => {
    const errors = []
    const original = console.error
    console.error = (...args) => errors.push(args.join(' '))
    const fetchImpl = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Bad request.' }),
    })
    const res = mockRes()

    try {
      await googleAuth.handleGoogleCallback(
        { url: '/api/auth/google/callback?code=valid-code', headers: { host: 'getcompanysync.com' } },
        res,
        {
          pool: mockPool({}),
          createSession: async () => 'sid',
          fetchImpl,
          env,
        }
      )
    } finally {
      console.error = original
    }

    assert.equal(res.headers.Location, '/login?error=google_auth_failed')
    const logged = errors.join('\n')
    assert.match(logged, /token_exchange_failed/)
    assert.match(logged, /invalid_grant/)
    assert.doesNotMatch(logged, /not-a-real-secret/)
    assert.doesNotMatch(logged, /valid-code/)
  })
})
