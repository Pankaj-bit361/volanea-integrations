'use strict';

const { apiUrl, data, json, verifySignature } = require('../lib');

const EVENTS = {
  'email.received': 'Email received (inbox or inbound address)',
  'email.delivered': 'Email delivered',
  'email.bounced': 'Email bounced',
  'email.complained': 'Spam complaint',
  'email.opened': 'Email opened',
  'email.clicked': 'Link clicked',
  'email.failed': 'Email failed',
  'email.sent': 'Email sent',
  'contact.created': 'Contact created',
  'contact.unsubscribed': 'Contact unsubscribed',
};

/** Webhook deliveries and listed events share one shape; `id` lets Zapier dedupe. */
const shape = (e) => ({
  id: e.eventId,
  eventId: e.eventId,
  event: e.event ?? e.name,
  createdAt: e.createdAt,
  contactId: e.contactId ?? null,
  emailId: e.emailId ?? null,
  data: e.data ?? {},
});

module.exports = {
  key: 'event',
  noun: 'Event',
  display: {
    label: 'New Event',
    description: 'Triggers when Volanea records an event: mail received, delivered, bounced, opened, clicked, or a contact change.',
  },
  operation: {
    type: 'hook',
    inputFields: [
      {
        key: 'events',
        label: 'Events',
        required: true,
        list: true,
        choices: EVENTS,
        default: 'email.received',
        helpText: 'Which events start the Zap.',
      },
    ],

    performSubscribe: async (z, bundle) =>
      data(
        z,
        await z.request({
          method: 'POST',
          url: `${apiUrl()}/v1/webhooks`,
          ...json({ url: bundle.targetUrl, description: 'Zapier', events: bundle.inputData.events }),
          skipThrowForStatus: true,
        }),
      ),

    performUnsubscribe: async (z, bundle) => {
      const id = bundle.subscribeData?.webhookEndpointId;
      if (!id) return {};
      const res = await z.request({ method: 'DELETE', url: `${apiUrl()}/v1/webhooks/${id}`, skipThrowForStatus: true });
      return res.status === 404 ? {} : data(z, res); // already removed in the dashboard
    },

    perform: async (z, bundle) => {
      const secret = bundle.subscribeData?.secret;
      const raw = bundle.rawRequest;
      if (secret && raw?.content) {
        const header = raw.headers?.['Http-X-Volanea-Signature'] ?? raw.headers?.['X-Volanea-Signature'];
        if (!verifySignature(header, raw.content, secret)) throw new z.errors.HaltedError('Ignored a request without a valid Volanea signature.');
      }
      return [shape(bundle.cleanedRequest)];
    },

    // Sample data while setting the Zap up: the project's latest matching events.
    performList: async (z, bundle) => {
      const wanted = new Set(bundle.inputData.events ?? []);
      const rows = data(z, await z.request({ url: `${apiUrl()}/v1/events`, params: { limit: 100 }, skipThrowForStatus: true }));
      return (Array.isArray(rows) ? rows : []).filter((e) => !wanted.size || wanted.has(e.name)).slice(0, 3).map(shape);
    },

    sample: {
      id: 'evt-1a2b3c',
      eventId: 'evt-1a2b3c',
      event: 'email.received',
      createdAt: '2026-10-18T10:00:00.000Z',
      contactId: 'c-4d5e6f',
      emailId: 'email-7a8b9c',
      data: { from: 'ada@example.com', to: 'support@agents.example.com', subject: 'Where is my order?', inboxId: 'inb-123', threadId: 'thr-456' },
    },
  },
};
