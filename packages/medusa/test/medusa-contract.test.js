'use strict';

/**
 * Contract tests against the real @medusajs/framework.
 *
 * The other two suites cover the mapping in isolation and never import Medusa.
 * This one loads the built entry point exactly as Medusa's notification module
 * would, so a rename or a signature change upstream fails here rather than at
 * a customer's boot.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { Modules, MedusaError } = require('@medusajs/framework/utils');
const providerExport = require('../dist/index.js');
const { VolaneaNotificationService } = require('../dist/index.js');

const OPTIONS = { apiKey: 'sk_test_x', from: 'shop@acme.com', fromName: 'Acme' };
const logger = { warn: () => {}, error: () => {}, info: () => {} };

function stubFetch(handler) {
  const original = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, restore: () => { global.fetch = original; } };
}

function ok(body) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
}

test('the default export is a notification module provider', () => {
  const provider = providerExport.default ?? providerExport;
  assert.ok(provider, 'the package has a default export');
  // ModuleProvider() returns a descriptor naming the module it plugs into.
  const serialized = JSON.stringify(provider);
  assert.ok(
    serialized.includes(Modules.NOTIFICATION) || provider.services?.length,
    'the descriptor references the notification module',
  );
});

test('the service extends the framework base class and declares an identifier', () => {
  const { AbstractNotificationProviderService } = require('@medusajs/framework/utils');
  assert.ok(
    VolaneaNotificationService.prototype instanceof AbstractNotificationProviderService,
    'extends AbstractNotificationProviderService',
  );
  assert.equal(VolaneaNotificationService.identifier, 'volanea');
});

test('validateOptions rejects a config with no key, before boot completes', () => {
  assert.throws(() => VolaneaNotificationService.validateOptions({}), /`apiKey` is required/);
  assert.doesNotThrow(() => VolaneaNotificationService.validateOptions(OPTIONS));
});

test('the constructor fails fast on a missing key', () => {
  assert.throws(() => new VolaneaNotificationService({ logger }, {}), /`apiKey` is required/);
});

test('send() returns the Volanea message id as the provider id', async () => {
  const f = stubFetch(() =>
    ok({ success: true, data: { messages: [{ id: 'email-42', status: 'queued' }], testMode: false } }),
  );

  try {
    const service = new VolaneaNotificationService({ logger }, OPTIONS);
    const result = await service.send({
      to: 'ada@example.com',
      channel: 'email',
      template: 'tpl_order_placed',
      data: { order: { id: 'order_01' } },
    });

    assert.deepEqual(result, { id: 'email-42' });

    const body = JSON.parse(f.calls[0].init.body);
    assert.equal(body.templateId, 'tpl_order_placed');
    assert.equal(body.variables['order.id'], 'order_01');
    assert.equal(body.from, 'shop@acme.com');
    assert.equal(body.fromName, 'Acme');
  } finally {
    f.restore();
  }
});

test('provider_data.idempotencyKey reaches the request header', async () => {
  const f = stubFetch(() => ok({ success: true, data: { messages: [{ id: 'e1' }] } }));

  try {
    const service = new VolaneaNotificationService({ logger }, OPTIONS);
    await service.send({
      to: 'ada@example.com',
      channel: 'email',
      template: 'tpl_x',
      provider_data: { idempotencyKey: 'order_01-placed' },
    });
    assert.equal(f.calls[0].init.headers['Idempotency-Key'], 'order_01-placed');
  } finally {
    f.restore();
  }
});

test('a missing notification is an INVALID_DATA MedusaError', async () => {
  const service = new VolaneaNotificationService({ logger }, OPTIONS);
  await assert.rejects(service.send(undefined), (e) => {
    assert.ok(e instanceof MedusaError);
    assert.equal(e.type, MedusaError.Types.INVALID_DATA);
    return true;
  });
});

test('a bad template id surfaces as an INVALID_DATA MedusaError naming the cause', async () => {
  const f = stubFetch(() => ({
    ok: false,
    status: 404,
    headers: { get: () => null },
    json: async () => ({
      success: false,
      error: 'Template not found',
      code: 'send_failed',
      details: [{ code: 'template_not_found' }],
    }),
  }));

  try {
    const service = new VolaneaNotificationService({ logger }, OPTIONS);
    await assert.rejects(
      service.send({ to: 'a@b.com', channel: 'email', template: 'nope' }),
      (e) => {
        assert.ok(e instanceof MedusaError);
        assert.equal(e.type, MedusaError.Types.INVALID_DATA);
        assert.match(e.message, /template_not_found/);
        return true;
      },
    );
  } finally {
    f.restore();
  }
});

test('a transport failure surfaces as UNEXPECTED_STATE, never a raw fetch error', async () => {
  const f = stubFetch(() => {
    throw new TypeError('fetch failed');
  });

  try {
    const service = new VolaneaNotificationService({ logger }, OPTIONS);
    await assert.rejects(
      service.send({ to: 'a@b.com', channel: 'email', template: 'tpl_x' }),
      (e) => {
        assert.ok(e instanceof MedusaError, 'a raw TypeError must not escape');
        assert.equal(e.type, MedusaError.Types.UNEXPECTED_STATE);
        return true;
      },
    );
  } finally {
    f.restore();
  }
});

test('an all-skipped send is raised, so Medusa never records a phantom delivery', async () => {
  const f = stubFetch(() =>
    ok({ success: true, data: { messages: [{ to: 'a@b.com', skipped: 'suppressed' }] } }),
  );

  try {
    const service = new VolaneaNotificationService({ logger }, OPTIONS);
    await assert.rejects(
      service.send({ to: 'a@b.com', channel: 'email', template: 'tpl_x' }),
      (e) => e instanceof MedusaError && /all_recipients_skipped/.test(e.message),
    );
  } finally {
    f.restore();
  }
});

test('a test-mode send warns through the injected logger', async () => {
  const warnings = [];
  const f = stubFetch(() =>
    ok({ success: true, data: { messages: [{ id: 'e1' }], testMode: true } }),
  );

  try {
    const service = new VolaneaNotificationService(
      { logger: { ...logger, warn: (m) => warnings.push(m) } },
      OPTIONS,
    );
    await service.send({ to: 'a@b.com', channel: 'email', template: 'tpl_x' });
    assert.match(warnings.join('\n'), /test-mode key/);
  } finally {
    f.restore();
  }
});
