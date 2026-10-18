'use strict';

/**
 * Runs the app through Zapier's own tester against a real Volanea API:
 *
 *   VOLANEA_API_URL=http://localhost:4197 VOLANEA_KEY=sk_… FROM=hi@your-verified.domain npm test
 *
 * Without VOLANEA_KEY only the schema and signature checks run.
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const crypto = require('node:crypto');
const zapier = require('zapier-platform-core');
const { prepareApp, validateApp } = require('zapier-platform-core/src/tools/schema');
const App = require('../index');
const { verifySignature } = require('../lib');

const appTester = zapier.createAppTester(App);
const KEY = process.env.VOLANEA_KEY;
const FROM = process.env.FROM || 'hi@lab.test';
const authData = { apiKey: KEY };
const live = { skip: !KEY && 'set VOLANEA_KEY (and VOLANEA_API_URL) to run against an API' };

test('the app definition passes Zapier schema validation', () => {
  assert.deepEqual(validateApp(prepareApp(App)), []);
});

test('verifySignature accepts only a fresh, matching signature', () => {
  const t = Date.now();
  const sig = (body, secret, at = t) => `t=${at},v1=${crypto.createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`;
  assert.equal(verifySignature(sig('{}', 's'), '{}', 's'), true);
  assert.equal(verifySignature(sig('{}', 'x'), '{}', 's'), false);
  assert.equal(verifySignature(sig('{}', 's', t - 600_000), '{}', 's'), false);
  assert.equal(verifySignature(undefined, '{}', 's'), false);
});

test('auth: a valid key passes, a bad key asks to reconnect', live, async () => {
  await appTester(App.authentication.test, { authData });
  await assert.rejects(() => appTester(App.authentication.test, { authData: { apiKey: 'sk_nope' } }), /reconnect/i);
});

test('Send Email sends and returns the message id', live, async () => {
  const res = await appTester(App.creates.send_email.operation.perform, {
    authData,
    inputData: { from: FROM, fromName: 'Zapier test', to: ['zap@example.com'], subject: 'Hi {{name}}', html: '<p>Hi {{name}} from Zapier</p>', variables: { name: 'Ada' } },
  });
  assert.match(res.id, /^email-/);
  assert.equal(res.to, 'zap@example.com');
  // {{placeholders}} must reach Volanea untouched (core strips them from object bodies).
  const sent = await appTester(async (z) => (await z.request({ url: `${process.env.VOLANEA_API_URL}/v1/emails/${res.id}` })).data.data, { authData });
  assert.equal(sent.subject, 'Hi Ada');
});

test('Send Email surfaces the API reason for an unverified sender', live, async () => {
  await assert.rejects(
    () => appTester(App.creates.send_email.operation.perform, { authData, inputData: { from: 'x@unverified.invalid', to: 'zap@example.com', subject: 's', text: 't' } }),
    /not verified/,
  );
});

test('Create or Update Contact upserts with custom fields', live, async () => {
  const res = await appTester(App.creates.contact.operation.perform, {
    authData,
    inputData: { email: 'zap-contact@example.com', firstName: 'Grace', subscribed: 'true', data: { plan: 'pro' } },
  });
  assert.match(res.id, /^c-/);
  assert.equal(res.firstName, 'Grace');
});

test('Track Event records the event', live, async () => {
  const res = await appTester(App.creates.track_event.operation.perform, {
    authData,
    inputData: { name: 'zap_ran', email: 'zap-contact@example.com', data: { total: '49' } },
  });
  assert.ok(res);
});

test('New Event: subscribe, receive a signed delivery, list samples, unsubscribe', live, async () => {
  // A stand-in for Zapier's hook URL that captures what Volanea POSTs.
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.end('ok');
    });
  });
  await new Promise((r) => server.listen(0, r));
  const targetUrl = `http://localhost:${server.address().port}/hooks/catch`;

  try {
    const trigger = App.triggers.event.operation;
    const sub = await appTester(trigger.performSubscribe, { authData, targetUrl, inputData: { events: ['email.sent'] } });
    assert.match(sub.webhookEndpointId, /^whep-/);
    assert.match(sub.secret, /^whsec_/);

    await appTester(App.creates.send_email.operation.perform, { authData, inputData: { from: FROM, to: 'zap-hook@example.com', subject: 'hook me', text: 'x' } });
    for (let i = 0; i < 40 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 250));
    assert.ok(received.length > 0, 'Volanea delivered to the hook URL');

    // Zapier hands perform the raw request with headers prefixed "Http-".
    const hit = received[0];
    const rawRequest = { content: hit.body, headers: { 'Http-X-Volanea-Signature': hit.headers['x-volanea-signature'] } };
    const [item] = await appTester(trigger.perform, { authData, subscribeData: sub, rawRequest, cleanedRequest: JSON.parse(hit.body) });
    assert.equal(item.event, 'email.sent');
    assert.equal(item.data.to, 'zap-hook@example.com');
    assert.equal(item.id, item.eventId);

    await assert.rejects(
      () => appTester(trigger.perform, { authData, subscribeData: sub, rawRequest: { content: hit.body, headers: { 'Http-X-Volanea-Signature': 't=1,v1=00' } }, cleanedRequest: JSON.parse(hit.body) }),
      /valid Volanea signature/,
    );

    const samples = await appTester(trigger.performList, { authData, inputData: { events: ['email.sent'] } });
    assert.ok(samples.length > 0 && samples.every((s) => s.event === 'email.sent' && s.id));

    await appTester(trigger.performUnsubscribe, { authData, subscribeData: sub });
    const left = await appTester(async (z) => (await z.request({ url: `${process.env.VOLANEA_API_URL}/v1/webhooks` })).data.data, { authData });
    assert.equal(left.some((e) => e.webhookEndpointId === sub.webhookEndpointId), false);
  } finally {
    server.close();
  }
});
