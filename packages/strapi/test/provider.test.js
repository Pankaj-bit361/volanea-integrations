'use strict';

/**
 * Dependency-free checks: `node test.js`
 * Payload building runs offline; the send() flow runs against a stubbed fetch.
 */

const assert = require('node:assert');
const provider = require('../dist/index.js');

const { buildPayload } = provider._internals;
let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}\n      ${error.message}`);
    process.exitCode = 1;
  }
}

console.log('\nbuildPayload');

test('single recipient stays a bare string', () => {
  const p = buildPayload({ to: 'a@example.com', subject: 'Hi', text: 'yo' });
  assert.strictEqual(p.to, 'a@example.com');
  assert.strictEqual(p.subject, 'Hi');
  assert.strictEqual(p.type, 'transactional');
});

test('display names are split into from / fromName', () => {
  const p = buildPayload({
    to: 'a@example.com',
    from: 'Volanea Support <support@volanea.com>',
    subject: 'Hi',
  });
  assert.strictEqual(p.from, 'support@volanea.com');
  assert.strictEqual(p.fromName, 'Volanea Support');
});

test('settings supply defaults when the caller omits them', () => {
  const p = buildPayload(
    { to: 'a@example.com', subject: 'Hi' },
    {
      defaultFrom: 'no-reply@volanea.com',
      defaultFromName: 'Volanea',
      defaultReplyTo: 'support@volanea.com',
    }
  );
  assert.strictEqual(p.from, 'no-reply@volanea.com');
  assert.strictEqual(p.fromName, 'Volanea');
  assert.strictEqual(p.replyTo, 'support@volanea.com');
});

test('caller from overrides the configured default', () => {
  const p = buildPayload(
    { to: 'a@example.com', from: 'billing@volanea.com', subject: 'Hi' },
    { defaultFrom: 'no-reply@volanea.com' }
  );
  assert.strictEqual(p.from, 'billing@volanea.com');
});

test('comma-separated recipients become an array', () => {
  const p = buildPayload({ to: 'a@example.com, b@example.com', subject: 'Hi' });
  assert.deepStrictEqual(p.to, ['a@example.com', 'b@example.com']);
});

test('comma splitting does not break bracketed display names', () => {
  const p = buildPayload({ to: 'A One <a@example.com>, b@example.com' });
  assert.deepStrictEqual(p.to, [
    { email: 'a@example.com', name: 'A One' },
    'b@example.com',
  ]);
});

test('cc and bcc are folded into the recipient list', () => {
  const p = buildPayload({
    to: 'a@example.com',
    cc: 'c@example.com',
    bcc: ['d@example.com'],
  });
  assert.deepStrictEqual(p.to, [
    'a@example.com',
    'c@example.com',
    'd@example.com',
  ]);
});

test('missing recipient throws', () => {
  assert.throws(() => buildPayload({ subject: 'Hi' }), /No recipient/);
});

test('more than 50 recipients throws', () => {
  const many = Array.from({ length: 51 }, (_, i) => `u${i}@example.com`);
  assert.throws(() => buildPayload({ to: many }), /Too many recipients/);
});

test('buffer attachments are base64 encoded', () => {
  const p = buildPayload({
    to: 'a@example.com',
    attachments: [{ filename: 'a.txt', content: Buffer.from('hello') }],
  });
  assert.strictEqual(
    p.attachments[0].content,
    Buffer.from('hello').toString('base64')
  );
  assert.strictEqual(p.attachments[0].filename, 'a.txt');
});

test('data: URI attachments keep their existing base64', () => {
  const p = buildPayload({
    to: 'a@example.com',
    attachments: [
      { filename: 'a.txt', content: 'data:text/plain;base64,aGVsbG8=' },
    ],
  });
  assert.strictEqual(p.attachments[0].content, 'aGVsbG8=');
});

test('a string attachment is treated as raw text, not base64', () => {
  const p = buildPayload({
    to: 'a@example.com',
    attachments: [{ filename: 'a.txt', content: 'hello' }],
  });
  assert.strictEqual(p.attachments[0].content, Buffer.from('hello').toString('base64'));
});

test("encoding:'base64' content is passed through unchanged", () => {
  const p = buildPayload({
    to: 'a@example.com',
    attachments: [{ filename: 'a.txt', content: 'aGVsbG8=', encoding: 'base64' }],
  });
  assert.strictEqual(p.attachments[0].content, 'aGVsbG8=');
});

test('a hex-encoded attachment is decoded before re-encoding', () => {
  const p = buildPayload({
    to: 'a@example.com',
    attachments: [{ filename: 'a.txt', content: '68656c6c6f', encoding: 'hex' }],
  });
  assert.strictEqual(p.attachments[0].content, Buffer.from('hello').toString('base64'));
});

test('attachment without content throws a readable error', () => {
  assert.throws(
    () =>
      buildPayload({ to: 'a@example.com', attachments: [{ filename: 'a.txt' }] }),
    /has no `content`/
  );
});

test('templateId and variables pass through', () => {
  const p = buildPayload({
    to: 'a@example.com',
    templateId: 'tpl_123',
    variables: { firstName: 'Pankaj' },
  });
  assert.strictEqual(p.templateId, 'tpl_123');
  assert.deepStrictEqual(p.variables, { firstName: 'Pankaj' });
});

console.log('\nsend()');

const originalFetch = global.fetch;
function stubFetch(impl) {
  global.fetch = impl;
}

(async () => {
  await testAsync('missing apiKey fails fast at init', () => {
    assert.throws(() => provider.init({}), /apiKey` is required/);
  });

  await testAsync('successful send returns accepted messages', async () => {
    let seen;
    stubFetch(async (url, init) => {
      seen = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            messages: [{ id: 'em_1', to: 'a@example.com', status: 'queued' }],
            testMode: false,
          },
        }),
      };
    });

    const t = provider.init(
      { apiKey: 'sk_test' },
      { defaultFrom: 'no-reply@volanea.com' }
    );
    const result = await t.send({ to: 'a@example.com', subject: 'Hi', text: 'yo' });

    assert.strictEqual(seen.url, 'https://api.volanea.com/v1/send');
    assert.strictEqual(seen.init.headers.Authorization, 'Bearer sk_test');
    assert.strictEqual(result.accepted.length, 1);
    assert.strictEqual(result.accepted[0].id, 'em_1');
    assert.strictEqual(result.skipped.length, 0);
  });

  await testAsync('send_failed surfaces details[0].code as the error code', async () => {
    stubFetch(async () => ({
      ok: false,
      status: 404,
      json: async () => ({
        success: false,
        error: 'Template not found',
        code: 'send_failed',
        details: [
          { path: '', message: 'no such template', code: 'template_not_found' },
        ],
      }),
    }));

    const t = provider.init({ apiKey: 'sk_test' });
    await assert.rejects(
      t.send({ to: 'a@example.com', templateId: 'nope' }),
      (error) => error.code === 'template_not_found' && error.status === 404
    );
  });

  await testAsync('all-skipped 200 throws instead of resolving silently', async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          messages: [{ to: 'a@example.com', skipped: 'suppressed' }],
          testMode: false,
        },
      }),
    }));

    const t = provider.init({ apiKey: 'sk_test' });
    await assert.rejects(
      t.send({ to: 'a@example.com', subject: 'Hi' }),
      (error) =>
        error.code === 'all_recipients_skipped' && /suppressed/.test(error.message)
    );
  });

  await testAsync('throwOnSkip:false resolves with the skip recorded', async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          messages: [{ to: 'a@example.com', skipped: 'unsubscribed' }],
          testMode: false,
        },
      }),
    }));

    const t = provider.init({ apiKey: 'sk_test', throwOnSkip: false });
    const result = await t.send({ to: 'a@example.com', subject: 'Hi' });
    assert.strictEqual(result.skipped[0].skipped, 'unsubscribed');
  });

  await testAsync('partial skip still resolves', async () => {
    stubFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          messages: [
            { id: 'em_2', to: 'a@example.com', status: 'queued' },
            { to: 'b@example.com', skipped: 'suppressed' },
          ],
          testMode: false,
        },
      }),
    }));

    const t = provider.init({ apiKey: 'sk_test' });
    const result = await t.send({
      to: ['a@example.com', 'b@example.com'],
      subject: 'Hi',
    });
    assert.strictEqual(result.accepted.length, 1);
    assert.strictEqual(result.skipped.length, 1);
  });

  await testAsync('network failure is wrapped, not leaked raw', async () => {
    stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });

    const t = provider.init({ apiKey: 'sk_test' });
    await assert.rejects(
      t.send({ to: 'a@example.com', subject: 'Hi' }),
      (error) => error.code === 'network_error' && /ECONNREFUSED/.test(error.message)
    );
  });

  await testAsync('timeout aborts and reports a timeout code', async () => {
    stubFetch(
      (url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        })
    );

    const t = provider.init({ apiKey: 'sk_test', timeout: 50 });
    await assert.rejects(
      t.send({ to: 'a@example.com', subject: 'Hi' }),
      (error) => error.code === 'timeout'
    );
  });

  global.fetch = originalFetch;
  console.log(`\n${passed} passed${process.exitCode ? ', with failures above' : ''}\n`);
})();
