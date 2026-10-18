'use strict';

const { apiUrl, data } = require('./lib');

module.exports = {
  type: 'custom',
  fields: [
    {
      key: 'apiKey',
      label: 'Secret Key',
      required: true,
      type: 'password',
      helpText: 'A secret key from **Settings → API keys** in the [Volanea dashboard](https://app.volanea.com/settings#keys). A test key (`sk_test_…`) logs mail without delivering it.',
    },
  ],
  // Any secret-key route proves the key; listing domains is cheap and read-only.
  test: async (z) => data(z, await z.request({ url: `${apiUrl()}/v1/domains`, skipThrowForStatus: true })),
  connectionLabel: (z, bundle) => `Volanea …${String(bundle.authData.apiKey).slice(-4)}`,
};
