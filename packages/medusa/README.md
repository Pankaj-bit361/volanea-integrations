# medusa-provider-notification-volanea

Send Medusa's transactional email through [Volanea](https://volanea.com) — order
confirmations, shipment notices, password resets, customer invites, and anything
else you dispatch through the Notification Module.

Zero runtime dependencies. Medusa v2, Node 20+.

## Install

```bash
npm install medusa-provider-notification-volanea
```

## Register

`medusa-config.ts`:

```ts
module.exports = defineConfig({
  modules: [
    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "medusa-provider-notification-volanea",
            id: "volanea",
            options: {
              channels: ["email"],
              apiKey: process.env.VOLANEA_API_KEY,
              from: process.env.VOLANEA_FROM,
              fromName: process.env.VOLANEA_FROM_NAME,
            },
          },
        ],
      },
    },
  ],
})
```

`.env`:

```bash
VOLANEA_API_KEY=sk_live_xxxxxxxxxxxx
VOLANEA_FROM=orders@yourstore.com
VOLANEA_FROM_NAME=Your Store
```

Only one provider can serve a channel, so this replaces whatever was on
`email` before.

**`from` must be on a domain verified in Volanea.** An unverified domain is a
403 on every send, not a warning. Verify it under **Domains** in the dashboard
before you register the provider.

## Send

```ts
const notificationModuleService = container.resolve(Modules.NOTIFICATION)

await notificationModuleService.createNotifications({
  to: "customer@example.com",
  channel: "email",
  template: "tpl_order_placed",     // a Volanea template id
  data: {
    order: { id: order.id, total: "$49.00" },
    customer: { first_name: "Ada" },
  },
})
```

Or with inline content and no stored template:

```ts
await notificationModuleService.createNotifications({
  to: "customer@example.com",
  channel: "email",
  template: "",
  content: {
    subject: "Your order shipped",
    html: "<p>On its way.</p>",
    text: "On its way.",
  },
})
```

## Two behaviours to design around

**1. A 200 does not mean delivered.** `/v1/send` returns as soon as the message
is durably queued; the provider hand-off happens afterwards. This provider
reports *accepted*, never *delivered*. For the real outcome, subscribe a
webhook endpoint to `email.delivered`, `email.bounced` and `email.complained`
and correlate on the id this provider returns.

**2. A 200 can mean nothing was sent.** Volanea reports per-recipient skips —
suppressed, unsubscribed, over quota, reputation-paused — inside a *successful*
body. Medusa reads a resolved promise as success, so a fully skipped send would
otherwise vanish: the notification row says sent, and the customer never got
their order confirmation.

So when every recipient was skipped, this provider throws
(`all_recipients_skipped`). Set `throwOnSkip: false` if you would rather have
the send resolve and read the skips out of your logs.

## Options

| Option | Default | Purpose |
| --- | --- | --- |
| `apiKey` | — | **Required.** Volanea secret key. |
| `baseUrl` | `https://api.volanea.com` | Override the API host. |
| `from` | — | Default sender. Must be on a verified domain. |
| `fromName` | — | Default sender display name. |
| `replyTo` | — | Default Reply-To. |
| `timeout` | `15000` | Abort the request after this many ms. |
| `throwOnSkip` | `true` | Throw when every recipient was skipped. |
| `channels` | — | Read by Medusa, not by this provider. |

Medusa's first-party providers spell options in snake_case (`api_key`), so every
option above is also accepted in that style — `api_key`, `base_url`,
`from_name`, `reply_to`, `throw_on_skip`. camelCase wins if you supply both.

A missing or malformed option throws at construction, so a misconfigured
provider stops Medusa from booting rather than failing silently at the first
order.

## How a notification maps onto the API

| Medusa | Volanea | Notes |
| --- | --- | --- |
| `to` | `to` | `"Ada <ada@x.com>"` splits into an addressed recipient. |
| `template` | `templateId` | A non-empty template names the body. |
| `content.subject` | `subject` | Sent either way, so it can override a template's subject. |
| `content.html` / `.text` | `html` / `text` | Used only when there is no `template`. |
| `data` | `variables` | Flattened — see below. |
| `from` | `from` + `fromName` | A display name is split out. |
| `attachments` | `attachments` | `content` is base64; `content_type` → `contentType`. |
| `provider_data.idempotencyKey` | `Idempotency-Key` header | A repeat replays the stored response instead of sending twice. |

Everything is sent as `type: "transactional"` — an order confirmation has to
reach someone who unsubscribed from marketing. Pass
`provider_data: { type: "marketing" }` for a send that should honour
unsubscribes and carry the unsubscribe footer.

`provider_data` also passes `headers`, `sendAt`, `createContact`, `replyTo` and
`variables` straight through.

### Why `data` is flattened

Volanea validates `variables` as a flat `Record<string, string | number |
boolean>` and rejects anything else with a 422 — but Medusa's `data` is
routinely nested. This provider flattens to dotted keys rather than rejecting:

```ts
{ order: { id: "order_01", total: 4900 }, items: [{ title: "Mug" }] }
// becomes
{ "order.id": "order_01", "order.total": 4900,
  "items.length": 1, "items.0.title": "Mug" }
```

Volanea's renderer resolves a placeholder by trying the literal key first, so
`{{order.id}}` in your template picks the flattened key up unchanged — you write
the template exactly as the nested data reads. `null` and `undefined` are
dropped rather than rendering the literal text "null"; `Date` values become ISO
strings.

### Attachments

`content` is treated as **already base64**, matching Medusa's own type and how
its providers hand attachments to SendGrid. Buffers, `Uint8Array`s and `data:`
URIs are also accepted. Up to 10 attachments, 10 MiB per request. Nothing is
read from disk or from a URL — pass the bytes.

## Errors

Every failure arrives as a `MedusaError` naming the specific cause. Branch on
the code, never on the wording.

| Code | Meaning |
| --- | --- |
| `unauthorized` | Missing or invalid API key. |
| `send_failed` | Send rejected — an unverified `from` domain is the usual cause, and the domain is named in the message. |
| `template_not_found` | The `template` is not a Volanea template id. |
| `validation_error` | The request was malformed; the failing fields are in `details`. |
| `idempotency_key_reused` | Same key, different body. Nothing was sent. |
| `rate_limited` | Per-project burst cap. The retry delay is in the message. |
| `all_recipients_skipped` | Accepted, but every recipient was skipped. |
| `invalid_attachment` | An attachment had no content. |
| `timeout` | No response within `timeout` ms. |
| `network_error` | The API was unreachable. |
| `bad_response` | A non-JSON response. |

A raw `fetch` error never reaches Medusa — transport failures are wrapped
before they leave the provider.

## Troubleshooting

**403 on every send** — the `from` domain is not verified in Volanea. Check
**Domains** in the dashboard. This is the single most common cause of a
provider that "doesn't work" from the first order onward.

**Nothing arrives and there is no error** — you are running with
`throwOnSkip: false`, and the recipients were skipped. Check the logs for
`recipient(s) skipped`, then **Suppressions** in the dashboard. A suppressed
address stays suppressed until you remove it.

**It works in development but not production** — you are almost certainly using
a test-mode key. Test-mode sends render, validate and log, but never leave the
building. The provider logs a warning on every test-mode send; check for
`sent with a test-mode key`.

**Medusa boots but the provider is never called** — another provider holds the
`email` channel. Only one provider serves a channel; remove the other entry.

**`apiKey is required` at boot** — the option did not reach the provider. It
belongs in the provider entry's own `options`, not the notification module's
top-level `options`.

## Testing locally

Send to `success@simulator.amazonses.com`. It is absorbed by the SES mailbox
simulator: it never bounces, and it never counts against your quota, bounce
rate, or sender reputation.

Do **not** invent a test address on a real domain. It hard-bounces, and hard
bounces damage the sender reputation of every domain on your account.

```bash
npm test    # builds, then runs the suite against the built output
```

The suite uses Node's built-in test runner with no framework dependency:
`test/payload.test.js` and `test/client.test.js` cover the mapping and the HTTP
client in isolation, and `test/medusa-contract.test.js` loads the built entry
point against the real `@medusajs/framework` so an upstream signature change
fails here instead of at your boot.

## Licence

MIT
