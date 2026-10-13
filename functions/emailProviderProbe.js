/**
 * Non-delivery platform email credential probe for Deno function handlers.
 * Mirrors functions/_sendEmail.ts provider precedence without sending email.
 */

function defaultEnvGet(key) {
  if (typeof Deno !== 'undefined') return Deno.env.get(key);
  return typeof process !== 'undefined' ? process.env[key] : undefined;
}

function providerLabel(provider) {
  if (provider === 'ses') return 'AWS SES';
  return provider[0].toUpperCase() + provider.slice(1);
}

async function responseResult(provider, response, fallbackMessage) {
  const body = await response.json().catch(() => ({}));
  const message = body.message || body.Message || body.error || body.__type || fallbackMessage;
  const sesValidationFailure = provider === 'ses' && response.status === 400 &&
    /BadRequest|Validation|MissingRequiredParameter|required|must not be null/i.test(
      `${body.__type || body.code || body.Code || ''} ${message}`,
    );
  if (response.ok || sesValidationFailure) return { ok: true, provider };
  return {
    ok: false,
    provider,
    error: `${providerLabel(provider)} API error (HTTP ${response.status}): ${message}`,
  };
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function probeEmailProvider({
  envGet = defaultEnvGet,
  fetchImpl = fetch,
  now = new Date(),
  timeoutMs = 8000,
} = {}) {
  const postmarkToken = envGet('POSTMARK_SERVER_TOKEN');
  const awsKey = envGet('AWS_ACCESS_KEY_ID') || envGet('AWS_API_KEY');
  const awsSecret = envGet('AWS_SECRET_ACCESS_KEY') || envGet('AWS_SECRET_KEY');
  let provider = 'none';

  try {
    if (postmarkToken) {
      provider = 'postmark';
      const response = await fetchWithTimeout(
        fetchImpl,
        'https://api.postmarkapp.com/server',
        { headers: { Accept: 'application/json', 'X-Postmark-Server-Token': postmarkToken } },
        timeoutMs,
      );
      return responseResult(provider, response, 'Postmark rejected the server token');
    }

    if (awsKey && awsSecret) {
      provider = 'ses';
      const region = envGet('AWS_REGION') || 'us-east-1';
      const host = `email.${region}.amazonaws.com`;
      const path = '/v2/email/outbound-emails';
      const body = '{}';
      const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
      const dateStamp = amzDate.slice(0, 8);
      const encoder = new TextEncoder();
      const hex = (bytes) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      const hash = async (value) =>
        hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
      const hmac = async (key, value) =>
        new Uint8Array(await crypto.subtle.sign(
          'HMAC',
          await crypto.subtle.importKey(
            'raw',
            typeof key === 'string' ? encoder.encode(key) : key,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
          ),
          encoder.encode(value),
        ));

      const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
      const signedHeaders = 'content-type;host;x-amz-date';
      const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, await hash(body)].join('\n');
      const scope = `${dateStamp}/${region}/ses/aws4_request`;
      const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await hash(canonicalRequest)].join('\n');
      const kDate = await hmac(`AWS4${awsSecret}`, dateStamp);
      const kRegion = await hmac(kDate, region);
      const kService = await hmac(kRegion, 'ses');
      const signingKey = await hmac(kService, 'aws4_request');
      const signature = hex(await hmac(signingKey, stringToSign));
      const response = await fetchWithTimeout(
        fetchImpl,
        `https://${host}${path}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Amz-Date': amzDate,
            Authorization: `AWS4-HMAC-SHA256 Credential=${awsKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
          },
          body,
        },
        timeoutMs,
      );
      return responseResult(provider, response, 'SES rejected the AWS credentials');
    }

    return { ok: false, provider, error: 'No platform email provider is configured' };
  } catch (error) {
    const label = provider === 'none' ? 'email provider' : providerLabel(provider);
    return { ok: false, provider, error: `Could not reach ${label}: ${error.message}` };
  }
}