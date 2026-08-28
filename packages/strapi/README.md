# strapi-provider-email-volanea

Send Strapi's transactional email through [Volanea](https://volanea.com) — admin
invites, password resets, user confirmation emails, and anything you send with
the Email plugin.

Zero runtime dependencies. Works with Strapi v5 on Node 18+.

## Install

```bash
npm install strapi-provider-email-volanea
# or
yarn add strapi-provider-email-volanea
```

## Configure

`config/plugins.js`:

```js
module.exports = ({ env }) => ({
  email: {
    config: {
      provider: 'strapi-provider-email-volanea',
      providerOptions: {
        apiKey: env('VOLANEA_API_KEY'),
      },
      settings: {
        defaultFrom: env('VOLANEA_DEFAULT_FROM', 'no-reply@yourdomain.com'),
        defaultFromName: env('VOLANEA_DEFAULT_FROM_NAME', 'Your App'),
        defaultReplyTo: env('VOLANEA_DEFAULT_REPLY_TO', 'support@yourdomain.com'),
      },
    },
  },
});
```

TypeScript projects — `config/plugins.ts`:

```ts
export default ({ env }) => ({
  email: {
    config: {
      provider: 'strapi-provider-email-volanea',
      providerOptions: {
        apiKey: env('VOLANEA_API_KEY'),
      },
      settings: {
        defaultFrom: env('VOLANEA_DEFAULT_FROM'),
        defaultFromName: env('VOLANEA_DEFAULT_FROM_NAME'),
        defaultReplyTo: env('VOLANEA_DEFAULT_REPLY_TO'),
      },
    },
  },
});
```

`.env`:

```bash
VOLANEA_API_KEY=sk_live_xxxxxxxxxxxx
VOLANEA_DEFAULT_FROM=no-reply@yourdomain.com
VOLANEA_DEFAULT_FROM_NAME=Your App
VOLANEA_DEFAULT_REPLY_TO=support@yourdomain.com
```

Your `defaultFrom` domain must be verified in Volanea before anything sends —
an unverified domain returns HTTP 403. Verify it under **Domains** in the
Volanea dashboard.

## Send

```js
await strapi.plugins.email.services.email.send({
  to: 'customer@example.com',
  subject: 'Welcome aboard',
  html: '<p>Thanks for signing up.</p>',
  text: 'Thanks for signing up.',
});
```

### Volanea templates

Skip inline HTML and render a stored template instead:

```js
await strapi.plugins.email.services.email.send({
  to: 'customer@example.com',
  templateId: 'tpl_welcome',
  variables: { firstName: 'Pankaj', plan: 'Growth' },
});
```

`subject` is optional when the template supplies one.

### Scheduling

```js
await strapi.plugins.email.services.email.send({
  to: 'customer@example.com',
  subject: 'Your trial ends tomorrow',
  html: '<p>…</p>',
  sendAt: '2026-09-01T09:00:00+05:30',
});
```

### Attachments

```js
await strapi.plugins.email.services.email.send({
  to: 'customer@example.com',
  subject: 'Your invoice',
  html: '<p>Invoice attached.</p>',
  attachments: [
    {
      filename: 'invoice.pdf',
      content: pdfBuffer, // Buffer, Uint8Array, string, or data: URI
      contentType: 'application/pdf',
    },
  ],
});
```

Up to 10 attachments per message, 10 MiB per request. The provider does not
read attachments from disk or from a URL — pass the bytes.

A `content` string is treated as **raw text**, the same way Nodemailer treats
it. If you already hold encoded bytes, say so rather than passing them as a
plain string, or they will be encoded a second time:

```js
{ filename: 'invoice.pdf', content: base64String, encoding: 'base64' }
// or
{ filename: 'invoice.pdf', content: 'data:application/pdf;base64,JVBERi0…' }
```

`encoding` accepts any Node `Buffer` encoding (`base64`, `hex`, `utf8`, …).

## Options

### `providerOptions`

| Option        | Type      | Default                     | Description |
| ------------- | --------- | --------------------------- | ----------- |
| `apiKey`      | `string`  | —                           | **Required.** Volanea secret key. |
| `baseUrl`     | `string`  | `https://api.volanea.com`   | Override the API host. |
| `timeout`     | `number`  | `15000`                     | Request timeout in ms. |
| `throwOnSkip` | `boolean` | `true`                      | Throw when every recipient was skipped. See below. |

### `settings`

| Setting           | Description |
| ----------------- | ----------- |
| `defaultFrom`     | From address used when a send does not specify one. |
| `defaultFromName` | Display name for the sender. |
| `defaultReplyTo`  | Reply-To used when a send does not specify one. |
| `defaultSubject`  | Fallback subject line. |
| `defaultType`     | `transactional` (default) or `marketing`. |

## Behaviour worth knowing

**A resolved `send()` does not mean delivered.** Volanea queues the message and
hands it to the provider after responding. Track final delivery with
`GET /v1/emails/{id}` or the `email.*` webhooks, not from the return value.

**Skipped recipients throw by default.** Volanea returns HTTP 200 when a
recipient is suppressed, unsubscribed, or over quota — the message just never
sends. Strapi treats a resolved promise as success, so a suppressed address
would silently swallow a password reset. This provider throws
`all_recipients_skipped` when *every* recipient was skipped. Set
`throwOnSkip: false` to opt out and read `result.skipped` yourself.

**`cc` and `bcc` become extra recipients.** Volanea sends one discrete message
per recipient, so cc and bcc addresses each get their own copy and cannot see
one another — bcc semantics, not cc semantics.

**Marketing mail must say so.** Inline HTML defaults to `transactional`, which
skips the unsubscribe footer and the unsubscribe check. Pass
`type: 'marketing'` for promotional content.

## Errors

Failures throw a `VolaneaEmailError` with a machine-readable `code`. Branch on
`code`, never on the message text.

| `code`                   | Meaning |
| ------------------------ | ------- |
| `template_not_found`     | `templateId` does not exist. |
| `send_failed`            | Pipeline failure with no more specific cause. |
| `validation_error`       | Bad request body; see `error.details`. |
| `unauthorized`           | Missing or invalid API key. |
| `rate_limited`           | Per-project send limit hit. |
| `all_recipients_skipped` | 200 response, nothing sent; see `error.skipped`. |
| `timeout`                | No response within `timeout` ms. |
| `network_error`          | Could not reach the API. |
| `invalid_attachment`     | Attachment had no `content`. |

## Troubleshooting

**403 on every send** — the `from` domain is not verified in Volanea. Check
**Domains** in the dashboard; `defaultFrom` must sit on a verified domain.

**Nothing arrives, no error** — check `result.skipped`. A suppressed address
stays suppressed until you remove it under **Suppressions**.

**Emails send in development but not production** — you are probably using a
test-mode key. Test-mode sends render and log but never leave the building.

**`global fetch is unavailable`** — you are on Node 16 or older. Strapi v5
requires Node 18+.

## Testing locally

Send to `success@simulator.amazonses.com`. It is absorbed by the SES mailbox
simulator: it never bounces and never counts against your quota, bounce rate, or
complaint rate. Never invent an address on a real domain to test with — it will
hard-bounce and damage your sender reputation.

```bash
node test.js   # 21 checks, no network, no dependencies
```

## Links

- [Volanea docs](https://volanea.com/docs)
- [Strapi integration guide](https://volanea.com/docs/integrations/strapi)
- [Strapi email plugin](https://docs.strapi.io/cms/features/email)

## License

MIT
