'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPayload,
  parseAddress,
  flattenVariables,
  normalizeAttachments,
} = require('../dist/index.js');

const OPTIONS = {
  apiKey: 'sk_test_x',
  baseUrl: 'https://api.volanea.com',
  timeout: 15000,
  throwOnSkip: true,
};

test('a template notification maps template to templateId', () => {
  const p = buildPayload(
    {
      to: 'ada@example.com',
      channel: 'email',
      template: 'tpl_order_placed',
      data: { order_id: 'order_01' },
    },
    OPTIONS,
  );

  assert.equal(p.to, 'ada@example.com');
  assert.equal(p.templateId, 'tpl_order_placed');
  assert.deepEqual(p.variables, { order_id: 'order_01' });
  assert.equal(p.type, 'transactional');
  assert.equal(p.html, undefined);
});

test('an inline-content notification sends html and text', () => {
  const p = buildPayload(
    {
      to: 'ada@example.com',
      channel: 'email',
      template: '',
      content: { subject: 'Hello', html: '<p>hi</p>', text: 'hi' },
    },
    OPTIONS,
  );

  assert.equal(p.subject, 'Hello');
  assert.equal(p.html, '<p>hi</p>');
  assert.equal(p.text, 'hi');
  assert.equal(p.templateId, undefined);
});

test('a subject overrides the template subject but keeps the template body', () => {
  const p = buildPayload(
    {
      to: 'ada@example.com',
      template: 'tpl_x',
      content: { subject: 'Overridden', html: '<p>ignored</p>' },
    },
    OPTIONS,
  );

  assert.equal(p.templateId, 'tpl_x');
  assert.equal(p.subject, 'Overridden');
  assert.equal(p.html, undefined, 'the template owns the body');
});

test('neither template nor content is a validation error, not a silent empty send', () => {
  assert.throws(
    () => buildPayload({ to: 'ada@example.com' }, OPTIONS),
    (e) => e.code === 'validation_error',
  );
});

test('a missing recipient throws', () => {
  assert.throws(
    () => buildPayload({ template: 'tpl_x' }, OPTIONS),
    (e) => e.code === 'missing_recipient',
  );
});

test('display-name parsing splits from and fromName', () => {
  const p = buildPayload(
    { to: 'ada@example.com', template: 'tpl_x', from: 'Acme Store <shop@acme.com>' },
    OPTIONS,
  );

  assert.equal(p.from, 'shop@acme.com');
  assert.equal(p.fromName, 'Acme Store');
});

test('a quoted display name is unwrapped', () => {
  assert.deepEqual(parseAddress('"Acme, Inc." <shop@acme.com>'), {
    email: 'shop@acme.com',
    name: 'Acme, Inc.',
  });
});

test('a bare address parses with no name', () => {
  assert.deepEqual(parseAddress('ada@example.com'), { email: 'ada@example.com' });
});

test('the notification from wins over the configured default', () => {
  const p = buildPayload(
    { to: 'a@b.com', template: 't', from: 'override@acme.com' },
    { ...OPTIONS, from: 'default@acme.com', fromName: 'Default' },
  );

  assert.equal(p.from, 'override@acme.com');
  assert.equal(p.fromName, 'Default', 'the configured name still applies');
});

test('the configured from is used when the notification has none', () => {
  const p = buildPayload(
    { to: 'a@b.com', template: 't' },
    { ...OPTIONS, from: 'default@acme.com', replyTo: 'support@acme.com' },
  );

  assert.equal(p.from, 'default@acme.com');
  assert.equal(p.replyTo, 'support@acme.com');
});

test('a named recipient becomes an object', () => {
  const p = buildPayload({ to: 'Ada <ada@example.com>', template: 't' }, OPTIONS);
  assert.deepEqual(p.to, { email: 'ada@example.com', name: 'Ada' });
});

/* ── variables ─────────────────────────────────────────────── */

test('nested data flattens to dotted keys the renderer resolves', () => {
  const vars = flattenVariables({
    order: { id: 'order_01', total: 4900, customer: { first_name: 'Ada' } },
    paid: true,
  });

  assert.deepEqual(vars, {
    'order.id': 'order_01',
    'order.total': 4900,
    'order.customer.first_name': 'Ada',
    paid: true,
  });
});

test('arrays flatten by index and expose a length', () => {
  const vars = flattenVariables({ items: [{ title: 'Mug' }, { title: 'Tee' }] });

  assert.equal(vars['items.length'], 2);
  assert.equal(vars['items.0.title'], 'Mug');
  assert.equal(vars['items.1.title'], 'Tee');
});

test('null and undefined are dropped, not stringified', () => {
  const vars = flattenVariables({ a: null, b: undefined, c: 'kept' });
  assert.deepEqual(vars, { c: 'kept' });
});

test('dates flatten to ISO strings', () => {
  const vars = flattenVariables({ at: new Date('2026-08-28T00:00:00.000Z') });
  assert.equal(vars.at, '2026-08-28T00:00:00.000Z');
});

test('every flattened value is a string, number or boolean', () => {
  const vars = flattenVariables({
    order: { id: 'o1', lines: [{ qty: 2 }], meta: { deep: { deeper: true } } },
  });

  for (const value of Object.values(vars)) {
    assert.ok(
      ['string', 'number', 'boolean'].includes(typeof value),
      `${typeof value} would be rejected by the API with a 422`,
    );
  }
});

test('provider_data.variables merge over the flattened data', () => {
  const p = buildPayload(
    {
      to: 'a@b.com',
      template: 't',
      data: { firstName: 'Ada' },
      provider_data: { variables: { firstName: 'Grace', extra: 1 } },
    },
    OPTIONS,
  );

  assert.deepEqual(p.variables, { firstName: 'Grace', extra: 1 });
});

/* ── attachments ───────────────────────────────────────────── */

test('a string attachment is passed through as already-base64', () => {
  const files = normalizeAttachments([
    { filename: 'a.txt', content: 'aGVsbG8=', content_type: 'text/plain' },
  ]);

  assert.equal(files[0].content, 'aGVsbG8=');
  assert.equal(files[0].contentType, 'text/plain');
});

test('a Buffer attachment is base64 encoded', () => {
  const files = normalizeAttachments([{ filename: 'a.txt', content: Buffer.from('hello') }]);
  assert.equal(files[0].content, 'aGVsbG8=');
});

test('a Uint8Array attachment is base64 encoded', () => {
  const files = normalizeAttachments([
    { filename: 'a.bin', content: new Uint8Array([104, 101, 108, 108, 111]) },
  ]);
  assert.equal(files[0].content, 'aGVsbG8=');
});

test('a data: URI attachment keeps its existing base64', () => {
  const files = normalizeAttachments([
    { filename: 'a.txt', content: 'data:text/plain;base64,aGVsbG8=' },
  ]);
  assert.equal(files[0].content, 'aGVsbG8=');
});

test('content_type and contentType are both honoured', () => {
  const files = normalizeAttachments([{ filename: 'a.pdf', content: 'x', contentType: 'application/pdf' }]);
  assert.equal(files[0].contentType, 'application/pdf');
});

test('an attachment with no content throws a readable error', () => {
  assert.throws(
    () => normalizeAttachments([{ filename: 'a.txt' }]),
    (e) => e.code === 'invalid_attachment' && /has no content/.test(e.message),
  );
});

test('an unnamed attachment gets a generated filename', () => {
  const files = normalizeAttachments([{ content: 'aGk=' }]);
  assert.equal(files[0].filename, 'attachment-1');
});
