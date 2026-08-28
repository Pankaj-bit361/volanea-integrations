'use strict';

/**
 * Direct tests for the shared internals.
 *
 * Both providers exercise this code through their own suites, but core is the
 * piece a change in either package can quietly break for the other — so the
 * contract is pinned here too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VolaneaClient,
  VolaneaError,
  INVALID_DATA_CODES,
  resolveClientConfig,
  parseAddress,
  parseAddressList,
  toRecipient,
} = require('../dist/index.js');

const LABEL = 'test-provider';
const UA = 'test-provider/1.0.0';

function config(overrides = {}) {
  return resolveClientConfig({ apiKey: 'sk_test_x', ...overrides }, LABEL, UA);
}

function stubFetch(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, restore: () => { global.fetch = original; } };
}

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k] ?? null },
    json: async () => body,
  };
}

/* ── addresses ─────────────────────────────────────────────── */

test('a bare address parses to just an email', () => {
  assert.deepEqual(parseAddress('ada@example.com'), { email: 'ada@example.com' });
});

test('a display name is split out', () => {
  assert.deepEqual(parseAddress('Ada Lovelace <ada@example.com>'), {
    email: 'ada@example.com',
    name: 'Ada Lovelace',
  });
});

test('a quoted display name is unwrapped', () => {
  assert.deepEqual(parseAddress('"Acme, Inc." <shop@acme.com>'), {
    email: 'shop@acme.com',
    name: 'Acme, Inc.',
  });
});

test('an object address accepts either email or address', () => {
  assert.deepEqual(parseAddress({ address: 'a@b.com', name: 'A' }), { email: 'a@b.com', name: 'A' });
  assert.deepEqual(parseAddress({ email: 'a@b.com' }), { email: 'a@b.com' });
});

test('empty input parses to null', () => {
  for (const input of [null, undefined, '', '   ', {}]) {
    assert.equal(parseAddress(input), null, `${JSON.stringify(input)} should be null`);
  }
});

test('a comma-separated string splits into a list', () => {
  assert.deepEqual(parseAddressList('a@x.com, b@x.com'), [{ email: 'a@x.com' }, { email: 'b@x.com' }]);
});

test('commas inside angle-bracketed addresses do not split', () => {
  assert.deepEqual(parseAddressList('A One <a@x.com>, b@x.com'), [
    { email: 'a@x.com', name: 'A One' },
    { email: 'b@x.com' },
  ]);
});

test('toRecipient collapses to a bare string when there is no name', () => {
  assert.equal(toRecipient({ email: 'a@b.com' }), 'a@b.com');
  assert.deepEqual(toRecipient({ email: 'a@b.com', name: 'A' }), { email: 'a@b.com', name: 'A' });
});

/* ── config ────────────────────────────────────────────────── */

test('a missing apiKey throws, naming the package', () => {
  assert.throws(
    () => resolveClientConfig({}, LABEL, UA),
    (e) => e instanceof VolaneaError && e.code === 'invalid_options' && e.message.includes(LABEL),
  );
});

test('defaults are applied and a trailing slash is trimmed', () => {
  const c = config({ baseUrl: 'https://staging.volanea.com/' });
  assert.equal(c.baseUrl, 'https://staging.volanea.com');
  assert.equal(c.timeout, 15000);
  assert.equal(c.throwOnSkip, true);
  assert.equal(c.userAgent, UA);
});

test('a nonsense timeout is rejected', () => {
  for (const timeout of [-1, 0, NaN]) {
    assert.throws(() => config({ timeout }), (e) => e.code === 'invalid_options');
  }
});

/* ── error mapping ─────────────────────────────────────────── */

test('send_failed surfaces details[0].code as the error code', async () => {
  const f = stubFetch(() =>
    response(404, {
      success: false,
      error: 'Template not found',
      code: 'send_failed',
      details: [{ code: 'template_not_found' }],
    }),
  );

  try {
    await assert.rejects(
      new VolaneaClient(config()).send({}),
      (e) => e.code === 'template_not_found' && e.status === 404 && e.details.length === 1,
    );
  } finally {
    f.restore();
  }
});

test('with no details, the top-level code is used', async () => {
  const f = stubFetch(() =>
    response(403, { success: false, error: 'Domain acme.com is not verified', code: 'send_failed' }),
  );

  try {
    await assert.rejects(new VolaneaClient(config()).send({}), (e) => e.code === 'send_failed');
  } finally {
    f.restore();
  }
});

test('with neither, the code falls back from the HTTP status', async () => {
  const f = stubFetch(() => response(401, { success: false, error: 'nope' }));

  try {
    await assert.rejects(new VolaneaClient(config()).send({}), (e) => e.code === 'unauthorized');
  } finally {
    f.restore();
  }
});

test('a 429 carries Retry-After into the message', async () => {
  const f = stubFetch(() =>
    response(429, { success: false, error: 'Rate limited', code: 'rate_limited' }, { 'Retry-After': '30' }),
  );

  try {
    await assert.rejects(
      new VolaneaClient(config()).send({}),
      (e) => e.code === 'rate_limited' && /retry after 30s/.test(e.message),
    );
  } finally {
    f.restore();
  }
});

test('a body with success:false is an error even on a 200', async () => {
  const f = stubFetch(() => response(200, { success: false, error: 'nope', code: 'validation_error' }));

  try {
    await assert.rejects(new VolaneaClient(config()).send({}), (e) => e.code === 'validation_error');
  } finally {
    f.restore();
  }
});

test('a non-JSON body is reported, not thrown raw', async () => {
  const f = stubFetch(() => ({
    ok: false,
    status: 502,
    headers: { get: () => null },
    json: async () => { throw new SyntaxError('Unexpected token <'); },
  }));

  try {
    await assert.rejects(new VolaneaClient(config()).send({}), (e) => e.code === 'bad_response');
  } finally {
    f.restore();
  }
});

test('the invalid-data code set covers the caller-error codes', () => {
  for (const code of ['validation_error', 'template_not_found', 'invalid_attachment']) {
    assert.ok(INVALID_DATA_CODES.has(code), `${code} should be caller error`);
  }
  for (const code of ['network_error', 'timeout', 'rate_limited', 'send_failed']) {
    assert.ok(!INVALID_DATA_CODES.has(code), `${code} should not be caller error`);
  }
});

/* ── skips ─────────────────────────────────────────────────── */

test('an all-skipped 200 throws rather than resolving', async () => {
  const f = stubFetch(() =>
    response(200, { success: true, data: { messages: [{ to: 'a@b.com', skipped: 'suppressed' }] } }),
  );

  try {
    await assert.rejects(
      new VolaneaClient(config()).send({}),
      (e) => e.code === 'all_recipients_skipped' && e.skipped.length === 1,
    );
  } finally {
    f.restore();
  }
});

test('throwOnSkip:false resolves with the skip recorded', async () => {
  const f = stubFetch(() =>
    response(200, { success: true, data: { messages: [{ to: 'a@b.com', skipped: 'unsubscribed' }] } }),
  );

  try {
    const r = await new VolaneaClient(config({ throwOnSkip: false })).send({});
    assert.equal(r.accepted.length, 0);
    assert.equal(r.skipped[0].skipped, 'unsubscribed');
  } finally {
    f.restore();
  }
});

test('a partial skip resolves', async () => {
  const f = stubFetch(() =>
    response(200, {
      success: true,
      data: { messages: [{ id: 'e1' }, { to: 'b@x.com', skipped: 'suppressed' }] },
    }),
  );

  try {
    const r = await new VolaneaClient(config()).send({});
    assert.equal(r.accepted.length, 1);
    assert.equal(r.skipped.length, 1);
  } finally {
    f.restore();
  }
});

/* ── transport ─────────────────────────────────────────────── */

test('the request carries auth, content type and the provider user agent', async () => {
  const f = stubFetch(() => response(200, { success: true, data: { messages: [{ id: 'e1' }] } }));

  try {
    await new VolaneaClient(config()).send({ to: 'a@b.com' }, 'key-1');
    const { url, init } = f.calls[0];
    assert.equal(url, 'https://api.volanea.com/v1/send');
    assert.equal(init.headers.Authorization, 'Bearer sk_test_x');
    assert.equal(init.headers['User-Agent'], UA);
    assert.equal(init.headers['Idempotency-Key'], 'key-1');
    assert.deepEqual(JSON.parse(init.body), { to: 'a@b.com' });
  } finally {
    f.restore();
  }
});

test('a network failure is wrapped as a VolaneaError', async () => {
  const f = stubFetch(() => { throw new TypeError('fetch failed'); });

  try {
    await assert.rejects(
      new VolaneaClient(config()).send({}),
      (e) => e instanceof VolaneaError && e.code === 'network_error',
    );
  } finally {
    f.restore();
  }
});

test('a timeout aborts the request and reports a timeout', async () => {
  const f = stubFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
  );

  try {
    await assert.rejects(
      new VolaneaClient(config({ timeout: 20 })).send({}),
      (e) => e.code === 'timeout' && /within 20ms/.test(e.message),
    );
  } finally {
    f.restore();
  }
});
