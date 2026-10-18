'use strict';

const authentication = require('./authentication');
const event = require('./triggers/event');
const sendEmail = require('./creates/send-email');
const contact = require('./creates/contact');
const trackEvent = require('./creates/track-event');

const addApiKey = (request, z, bundle) => {
  if (bundle.authData.apiKey) request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`;
  return request;
};

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  authentication,
  beforeRequest: [addApiKey],
  triggers: { [event.key]: event },
  creates: { [sendEmail.key]: sendEmail, [contact.key]: contact, [trackEvent.key]: trackEvent },
};
