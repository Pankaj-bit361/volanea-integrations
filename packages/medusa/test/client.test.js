'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { VolaneaClient, resolveOptions } = require('../dist/index.js');

const PAYLOAD = { to: 'ada@example.com', templateId: 'tpl_x', type: 'transactional' };

/** Stub global.fetch with a canned response, capturing the request. */
function stubFetch(handler) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return {
    calls,
    restore() {
      global.fetch = original;
    },
  };
}

function jsonResponse(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => body,
  };
}

function client(overrides = {}) {
  return new VolaneaClient(resolveOptions({ apiKey: 'sk_test_x', ...overrides }));
}

/* ── options ───────────────────────────────────────────────── */

test('a missing apiKey throws at construction, naming the option', () => {
  assert.throws(
    () => resolveOptions({}),
    (e) => e.code === 'invalid_options' && /`apiKey` is required/.test(e.message),
  );
});

test('snake_case option aliases are accepted', () => {
  const o = resolveOptions({
    api_key: 'sk_test_x',
    base_url: 'https://staging.volanea.com/',
    from_name: 'Acme',
    reply_to: 'support@acme.com',
    throw_on_skip: false,
  });

  assert.equal(o.apiKey, 'sk_test_x');
  assert.equal(o.baseUrl, 'https://staging.volanea.com', 'trailing slash trimmed');
  assert.equal(o.fromName, 'Acme');
  assert.equal(o.replyTo, 'support@acme.com');
  assert.equal(o.throwOnSkip, false);
});

test('camelCase wins when both spellings are present', () => {
  assert.equal(resolveOptions({ apiKey: 'camel', api_key: 'snake' }).apiKey, 'camel');
});

test('a nonsense timeout is rejected at construction', () => {
  assert.throws(
    () => resolveOptions({ apiKey: 'sk_test_x', timeout: -1 }),
    (e) => e.code === 'invalid_options',
  );
});

test('defaults are applied', () => {
  const o = resolveOptions({ apiKey: 'sk_test_x' });
  assert.equal(o.baseUrl, 'https://api.volanea.com');
  assert.equal(o.timeout, 15000);
  assert.equal(o.throwOnSkip, true);
});

/* ── requests ──────────────────────────────────────────────── */

test('a successful send returns the accepted messages', async () => {
  const f = stubFetch(() =>
    jsonResponse(200, {
      success: true,
      data: { messages: [{ id: 'email-1', to: 'ada@example.com', status: 'queued' }], testMode: false },
    }),
  );

  try {
    const result = await client().send(PAYLOAD);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.accepted[0].id, 'email-1');
    assert.equal(result.skipped.length, 0);
    assert.equal(result.testMode, false);

    const { url, init } = f.calls[0];
    assert.equal(url, 'https://api.volanea.com/v1/send');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer sk_test_x');
    assert.deepEqual(JSON.parse(init.body), PAYLOAD);
  } finally {
    f.restore();
  }
});

test('an idempotency key is sent as a header when given, omitted when not', async () => {
  const f = stubFetch(() => jsonResponse(200, { success: true, data: { messages: [{ id: 'e1' }] } }));

  try {
    await client().send(PAYLOAD, 'order_01-placed');
    assert.equal(f.calls[0].init.headers['Idempotency-Key'], 'order_01-placed');

    await client().send(PAYLOAD);
    assert.equal('Idempotency-Key' in f.calls[1].init.headers, false);
  } finally {
    f.restore();
  }
});

test('a replayed send is reported as such', async () => {
  const f = stubFetch(() =>
    jsonResponse(200, { success: true, data: { messages: [{ id: 'e1' }], replay: true } }),
  );

  try {
    assert.equal((await client().send(PAYLOAD)).replay, true);
  } finally {
    f.restore();
  }
});

/* ── errors ────────────────────────────────────────────────── */

test('send_failed surfaces details[0].code as the error code', async () => {
  const f = stubFetch(() =>
    jsonResponse(404, {
      success: false,
      error: 'Template not found',
      code: 'send_failed',
      details: [{ code: 'template_not_found' }],
    }),
  );

  try {
    await assert.rejects(client().send(PAYLOAD), (e) => e.code === 'template_not_found' && e.status === 404);
  } finally {
    f.restore();
  }
});

test('a 401 reports unauthorized', async () => {
  const f = stubFetch(() => jsonResponse(401, { success: false, error: 'Bad key', code: 'unauthorized' }));

  try {
    await assert.rejects(client().send(PAYLOAD), (e) => e.code === 'unauthorized');
  } finally {
    f.restore();
  }
});

test('a 403 on an unverified domain keeps the API wording', async () => {
  const f = stubFetch(() =>
    jsonResponse(403, {
      success: false,
      error: 'Domain acme.com is not verified',
      code: 'send_failed',
    }),
  );

  try {
    await assert.rejects(
      client().send(PAYLOAD),
      (e) => e.code === 'send_failed' && /acme\.com is not verified/.test(e.message),
    );
  } finally {
    f.restore();
  }
});

test('a 429 carries Retry-After through to the message', async () => {
  const f = stubFetch(() =>
    jsonResponse(429, { success: false, error: 'Rate limited', code: 'rate_limited' }, { 'Retry-After': '12' }),
  );

  try {
    await assert.rejects(
      client().send(PAYLOAD),
      (e) => e.code === 'rate_limited' && /retry after 12s/.test(e.message),
    );
  } finally {
    f.restore();
  }
});

test('a non-JSON body is reported rather than thrown raw', async () => {
  const f = stubFetch(() => ({
    ok: false,
    status: 502,
    headers: { get: () => null },
    json: async () => {
      throw new SyntaxError('Unexpected token <');
    },
  }));

  try {
    await assert.rejects(client().send(PAYLOAD), (e) => e.code === 'bad_response' && e.status === 502);
  } finally {
    f.restore();
  }
});

/* ── skips ─────────────────────────────────────────────────── */

test('an all-skipped 200 throws instead of resolving silently', async () => {
  const f = stubFetch(() =>
    jsonResponse(200, {
      success: true,
      data: { messages: [{ to: 'ada@example.com', skipped: 'suppressed' }] },
    }),
  );

  try {
    await assert.rejects(
      client().send(PAYLOAD),
      (e) => e.code === 'all_recipients_skipped' && /suppressed/.test(e.message),
    );
  } finally {
    f.restore();
  }
});

test('throwOnSkip:false resolves with the skip recorded', async () => {
  const f = stubFetch(() =>
    jsonResponse(200, {
      success: true,
      data: { messages: [{ to: 'ada@example.com', skipped: 'unsubscribed' }] },
    }),
  );

  try {
    const result = await client({ throwOnSkip: false }).send(PAYLOAD);
    assert.equal(result.accepted.length, 0);
    assert.equal(result.skipped[0].skipped, 'unsubscribed');
  } finally {
    f.restore();
  }
});

test('a partial skip still resolves', async () => {
  const f = stubFetch(() =>
    jsonResponse(200, {
      success: true,
      data: {
        messages: [
          { id: 'email-1', to: 'ada@example.com', status: 'queued' },
          { to: 'grace@example.com', skipped: 'suppressed' },
        ],
      },
    }),
  );

  try {
    const result = await client().send(PAYLOAD);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.skipped.length, 1);
  } finally {
    f.restore();
  }
});

/* ── transport ─────────────────────────────────────────────── */

test('a network failure is wrapped, not leaked raw', async () => {
  const f = stubFetch(() => {
    throw new TypeError('fetch failed');
  });

  try {
    await assert.rejects(
      client().send(PAYLOAD),
      (e) => e.name === 'VolaneaError' && e.code === 'network_error',
    );
  } finally {
    f.restore();
  }
});

test('a timeout aborts and reports a timeout code', async () => {
  const f = stubFetch(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('This operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
  );

  try {
    await assert.rejects(
      client({ timeout: 20 }).send(PAYLOAD),
      (e) => e.code === 'timeout' && /within 20ms/.test(e.message),
    );
  } finally {
    f.restore();
  }
});
