'use strict';

const { apiUrl, data } = require('../lib');

module.exports = {
  key: 'track_event',
  noun: 'Event',
  display: { label: 'Track Event', description: 'Records an event for a contact, to start Volanea workflows and build segments.' },
  operation: {
    inputFields: [
      { key: 'name', label: 'Event Name', required: true, helpText: 'e.g. `order_completed`. Names starting with `email.`, `contact.`, `segment.` or `workflow.` are reserved.' },
      { key: 'email', label: 'Contact Email', required: true },
      { key: 'data', label: 'Event Properties', dict: true, required: false, helpText: 'e.g. total = 49' },
    ],
    perform: async (z, bundle) => {
      const d = bundle.inputData;
      const body = { name: String(d.name).trim(), email: String(d.email).trim() };
      if (d.data && Object.keys(d.data).length) body.data = d.data;
      const result = data(z, await z.request({ method: 'POST', url: `${apiUrl()}/v1/events`, body, skipThrowForStatus: true }));
      return { id: result.eventId ?? null, ...result };
    },
    sample: { id: 'evt-1a2b3c', eventId: 'evt-1a2b3c', name: 'order_completed', contactId: 'c-4d5e6f' },
  },
};
