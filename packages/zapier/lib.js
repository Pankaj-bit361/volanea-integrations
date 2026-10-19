'use strict';

const crypto = require('node:crypto');

/** api.volanea.com unless overridden (`zapier env:set` or a local test run). */
const apiUrl = () => (process.env.VOLANEA_API_URL || 'https://api.volanea.com').replace(/\/+$/, '');


/** Unwraps `{ success, data }` and turns API errors into readable Zapier errors. */
const data = (z, response) => {
  const body = response.data ?? {};
  if (response.status >= 400) {
    if (response.status === 401) throw new z.errors.RefreshAuthError('Your Volanea API key was rejected. Reconnect with a valid secret key.');
    if (response.status === 429) throw new z.errors.ThrottledError(body.error || 'Rate limited by Volanea', 60);
    throw new z.errors.Error(body.error || `Volanea answered ${response.status}`, body.code || 'VolaneaError', response.status);
  }
  return body.data ?? body;
};

/**
 * A JSON body as z.request options. Pre-serialized on purpose: core strips every
 * `{{…}}` from the top-level string fields of an object body (normalizeEmptyBodyFields),
 * which would blank the template placeholders Volanea is meant to render.
 */
const json = (body) => ({ body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

/** Comma-separated input → trimmed list. */
const list = (value) =>
  (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((s) => String(s).trim())
    .filter(Boolean);

/** X-Volanea-Signature: t=<unix-ms>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}`>. */
const verifySignature = (header, rawBody, secret, now = Date.now()) => {
  const parts = Object.fromEntries(String(header ?? '').split(',').map((p) => p.split('=', 2)));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(now - t) > 5 * 60 * 1000) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
  const got = Buffer.from(parts.v1);
  return expected.length === got.length && crypto.timingSafeEqual(expected, got);
};

module.exports = { apiUrl, data, json, list, verifySignature };
