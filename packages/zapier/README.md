# Volanea for Zapier

The Volanea Zapier integration, built on `zapier-platform-core`. It is deployed to
Zapier with the Zapier CLI, never published to npm.

| | Key | What it does |
| --- | --- | --- |
| Trigger | `event` | **New Event**: mail received, delivered, bounced, opened, clicked, failed, sent; contact created or unsubscribed. A REST hook: subscribing registers a Volanea webhook endpoint for the Zap, unsubscribing deletes it, and every delivery's `X-Volanea-Signature` is checked. |
| Action | `send_email` | **Send Email**: HTML, plain text or a saved template with variables. |
| Action | `contact` | **Create or Update Contact** by email, with custom fields. |
| Action | `track_event` | **Track Event** for a contact, to start Volanea workflows. |

Auth is a secret key (custom auth), tested with `GET /v1/domains`.

## Test

```bash
npm install
npm test   # schema validation + signature checks
# against a real API (a local stack works; the trigger test runs its own hook receiver):
VOLANEA_API_URL=http://localhost:4197 VOLANEA_KEY=sk_… FROM=hi@your-verified.domain npm test
```

## Deploy

```bash
npx zapier-platform-cli login
npx zapier-platform-cli register "Volanea"   # once; writes .zapierapprc
npx zapier-platform-cli push
```

The integration starts private. Share it by invite link from the Zapier developer
platform, then submit it for public listing when it has a few live users.
