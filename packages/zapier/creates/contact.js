'use strict';

const { apiUrl, data, json } = require('../lib');

module.exports = {
  key: 'contact',
  noun: 'Contact',
  display: { label: 'Create or Update Contact', description: 'Adds a contact, or updates the one with this email address.' },
  operation: {
    inputFields: [
      { key: 'email', label: 'Email', required: true },
      { key: 'firstName', label: 'First Name', required: false },
      { key: 'lastName', label: 'Last Name', required: false },
      { key: 'subscribed', label: 'Subscribed', required: false, type: 'boolean' },
      { key: 'data', label: 'Custom Fields', dict: true, required: false, helpText: 'e.g. plan = pro' },
    ],
    perform: async (z, bundle) => {
      const d = bundle.inputData;
      const body = { email: String(d.email).trim() };
      for (const key of ['firstName', 'lastName']) if (d[key]) body[key] = d[key];
      if (d.subscribed !== undefined && d.subscribed !== '') body.subscribed = d.subscribed === true || d.subscribed === 'true';
      if (d.data && Object.keys(d.data).length) body.data = d.data;
      const contact = data(z, await z.request({ method: 'POST', url: `${apiUrl()}/v1/contacts`, ...json(body), skipThrowForStatus: true }));
      return { id: contact.contactId, ...contact };
    },
    sample: { id: 'c-4d5e6f', contactId: 'c-4d5e6f', email: 'ada@example.com', firstName: 'Ada', lastName: 'Lovelace', subscribed: true, data: { plan: 'pro' } },
  },
};
