'use strict';

/**
 * Dependency-free checks: `node test/nodes.test.js` (after `npm run build`).
 * The nodes run against a stubbed n8n context; the full flow — credentials,
 * actions, and a live trigger round trip — was exercised in n8n 2.43.7 itself.
 */

const assert = require('node:assert');
const { createHmac } = require('node:crypto');
const { Volanea } = require('../dist/nodes/Volanea/Volanea.node.js');
const { VolaneaTrigger, verifySignature } = require('../dist/nodes/VolaneaTrigger/VolaneaTrigger.node.js');

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}\n      ${error.stack}`);
    process.exitCode = 1;
  }
}

const sign = (body, secret, t = Date.now()) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

/** A minimal stand-in for IExecuteFunctions / IHookFunctions. */
function context({ params = {}, items = [{ json: {} }], staticData = {}, responses = [] } = {}) {
  const calls = [];
  return {
    calls,
    staticData,
    getInputData: () => items,
    getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
    getCredentials: async () => ({ apiKey: 'sk_test_x', baseUrl: 'https://api.example.test/' }),
    getNode: () => ({ name: 'Volanea', type: 'n8n-nodes-volanea.volanea', typeVersion: 1, parameters: {} }),
    getNodeWebhookUrl: () => 'https://n8n.example.test/webhook/abc/webhook',
    getWorkflow: () => ({ name: 'Orders' }),
    getWorkflowStaticData: () => staticData,
    continueOnFail: () => false,
    helpers: {
      httpRequestWithAuthentication: async (credential, options) => {
        calls.push({ credential, ...options });
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next ?? { success: true, data: { ok: true } };
      },
    },
  };
}

(async () => {
  console.log('\nVolanea node');

  await test('send builds the /v1/send body from the fields', async () => {
    const ctx = context({
      params: {
        resource: 'email', content: 'html', from: 'hi@shop.test', to: 'a@x.test, b@x.test', subject: 'Hi {{name}}',
        html: '<p>Hi</p>', variables: { variable: [{ name: 'name', value: 'Ada' }] },
        emailOptions: { fromName: 'Shop', type: 'marketing', idempotencyKey: 'order-1' },
      },
      responses: [{ success: true, data: { messages: [{ id: 'email-1' }] } }],
    });
    const [[out]] = await new Volanea().execute.call(ctx);
    const call = ctx.calls[0];
    assert.equal(call.credential, 'volaneaApi');
    assert.equal(call.url, 'https://api.example.test/v1/send');
    assert.deepEqual(call.body, { to: ['a@x.test', 'b@x.test'], from: 'hi@shop.test', subject: 'Hi {{name}}', html: '<p>Hi</p>', variables: { name: 'Ada' }, fromName: 'Shop', type: 'marketing' });
    assert.equal(call.headers['Idempotency-Key'], 'order-1');
    assert.deepEqual(out.json, { messages: [{ id: 'email-1' }] });
  });

  await test('a template send carries templateId and no html', async () => {
    const ctx = context({ params: { resource: 'email', content: 'template', from: '', to: 'a@x.test', subject: '', templateId: ' tmpl-1 ' } });
    await new Volanea().execute.call(ctx);
    assert.deepEqual(ctx.calls[0].body, { to: 'a@x.test', templateId: 'tmpl-1' });
  });

  await test('contact upsert parses the JSON data field', async () => {
    const ctx = context({ params: { resource: 'contact', email: ' ada@x.test ', contactOptions: { firstName: 'Ada', subscribed: false, data: '{"plan":"pro"}' } } });
    await new Volanea().execute.call(ctx);
    assert.equal(ctx.calls[0].url, 'https://api.example.test/v1/contacts');
    assert.deepEqual(ctx.calls[0].body, { email: 'ada@x.test', firstName: 'Ada', subscribed: false, data: { plan: 'pro' } });
  });

  await test('invalid JSON is a readable error, not a crash', async () => {
    const ctx = context({ params: { resource: 'event', email: 'a@x.test', eventName: 'paid', eventData: '{nope' } });
    await assert.rejects(() => new Volanea().execute.call(ctx), /Data is not valid JSON/);
  });

  await test('track sends name, email and data', async () => {
    const ctx = context({ params: { resource: 'event', email: 'a@x.test', eventName: 'order_completed', eventData: '{"total":49}' } });
    await new Volanea().execute.call(ctx);
    assert.deepEqual(ctx.calls[0].body, { name: 'order_completed', email: 'a@x.test', data: { total: 49 } });
  });

  console.log('\nVolanea Trigger');
  const hooks = new VolaneaTrigger().webhookMethods.default;

  await test('create registers the n8n URL with the chosen events and keeps the secret', async () => {
    const ctx = context({ params: { events: ['email.bounced', 'email.received'] }, responses: [{ success: true, data: { webhookEndpointId: 'whep-1', secret: 'whsec_s' } }] });
    assert.equal(await hooks.create.call(ctx), true);
    assert.equal(ctx.calls[0].method, 'POST');
    assert.deepEqual(ctx.calls[0].body, { url: 'https://n8n.example.test/webhook/abc/webhook', description: 'n8n — Orders', events: ['email.bounced', 'email.received'] });
    assert.deepEqual(ctx.staticData, { endpointId: 'whep-1', secret: 'whsec_s' });
  });

  await test('"Any Event" subscribes to everything (no events filter)', async () => {
    const ctx = context({ params: { events: ['*'] }, responses: [{ success: true, data: { webhookEndpointId: 'whep-2', secret: 's' } }] });
    await hooks.create.call(ctx);
    assert.equal('events' in ctx.calls[0].body, false);
  });

  await test('checkExists forgets an endpoint deleted in the dashboard', async () => {
    const ctx = context({ staticData: { endpointId: 'whep-1', secret: 's' }, responses: [{ success: true, data: [{ webhookEndpointId: 'whep-9', url: 'x' }] }] });
    assert.equal(await hooks.checkExists.call(ctx), false);
    assert.deepEqual(ctx.staticData, {});
  });

  await test('checkExists finds its own endpoint', async () => {
    const ctx = context({ staticData: { endpointId: 'whep-1', secret: 's' }, responses: [{ success: true, data: [{ webhookEndpointId: 'whep-1', url: 'https://n8n.example.test/webhook/abc/webhook' }] }] });
    assert.equal(await hooks.checkExists.call(ctx), true);
  });

  await test('delete removes the endpoint, and tolerates it being gone', async () => {
    const ctx = context({ staticData: { endpointId: 'whep-1', secret: 's' }, responses: [new Error('404')] });
    assert.equal(await hooks.delete.call(ctx), true);
    assert.equal(ctx.calls[0].method, 'DELETE');
    assert.equal(ctx.calls[0].url, 'https://api.example.test/v1/webhooks/whep-1');
    assert.deepEqual(ctx.staticData, {});
  });

  await test('verifySignature accepts a fresh valid signature only', () => {
    const body = '{"event":"email.delivered"}';
    assert.equal(verifySignature(sign(body, 'whsec_s'), body, 'whsec_s'), true);
    assert.equal(verifySignature(sign(body, 'whsec_other'), body, 'whsec_s'), false);
    assert.equal(verifySignature(sign(body + ' ', 'whsec_s'), body, 'whsec_s'), false);
    assert.equal(verifySignature(sign(body, 'whsec_s', Date.now() - 10 * 60 * 1000), body, 'whsec_s'), false);
    assert.equal(verifySignature(undefined, body, 'whsec_s'), false);
    assert.equal(verifySignature('garbage', body, 'whsec_s'), false);
  });

  console.log(`\n${passed} passed`);
})();
