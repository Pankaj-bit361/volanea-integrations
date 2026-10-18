'use strict';

const { apiUrl, data, json, list } = require('../lib');

module.exports = {
  key: 'send_email',
  noun: 'Email',
  display: { label: 'Send Email', description: 'Sends an email through Volanea: HTML, plain text or a saved template.' },
  operation: {
    inputFields: [
      { key: 'from', label: 'From', required: false, helpText: 'Must be on a domain verified in Volanea. Leave empty to use the template\'s sender.' },
      { key: 'fromName', label: 'From Name', required: false },
      { key: 'to', label: 'To', required: true, list: true, helpText: 'Each recipient gets their own copy (up to 50).' },
      { key: 'subject', label: 'Subject', required: false, helpText: 'Required unless the template provides one.' },
      { key: 'html', label: 'HTML Body', required: false, type: 'text' },
      { key: 'text', label: 'Plain-Text Body', required: false, type: 'text' },
      { key: 'templateId', label: 'Template ID', required: false, helpText: 'Send a saved template (`tmpl-…`) instead of a body.' },
      { key: 'variables', label: 'Template Variables', dict: true, required: false, helpText: 'Values for `{{placeholders}}`.' },
      { key: 'replyTo', label: 'Reply-To', required: false },
      { key: 'type', label: 'Type', required: false, choices: { transactional: 'Transactional (always sent)', marketing: 'Marketing (skips unsubscribed, adds footer)' }, default: 'transactional' },
    ],
    perform: async (z, bundle) => {
      const d = bundle.inputData;
      const to = list(d.to);
      const body = { to: to.length === 1 ? to[0] : to };
      for (const key of ['from', 'fromName', 'subject', 'html', 'text', 'templateId', 'replyTo', 'type']) if (d[key]) body[key] = d[key];
      if (d.variables && Object.keys(d.variables).length) body.variables = d.variables;
      if (!body.html && !body.text && !body.templateId) throw new z.errors.Error('Add an HTML body, a plain-text body or a template ID.', 'InvalidData', 400);
      const result = data(z, await z.request({ method: 'POST', url: `${apiUrl()}/v1/send`, ...json(body), skipThrowForStatus: true }));
      const first = result.messages?.[0] ?? {};
      // Zapier wants one flat object: lead with the first message, keep the rest.
      return { id: first.id ?? null, status: first.status ?? null, to: first.to ?? null, testMode: result.testMode, messages: result.messages };
    },
    sample: { id: 'email-7a8b9c', status: 'queued', to: 'ada@example.com', testMode: false, messages: [{ id: 'email-7a8b9c', to: 'ada@example.com', status: 'queued' }] },
  },
};
