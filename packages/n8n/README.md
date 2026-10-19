# n8n-nodes-volanea

[Volanea](https://volanea.com) for [n8n](https://n8n.io): send email, keep contacts in
sync and track events from any workflow, and start workflows when mail is delivered,
bounces, gets opened or clicked, or arrives at an inbox.

## Install

In n8n: **Settings → Community nodes → Install**, and enter `n8n-nodes-volanea`.

Self-hosted from the command line:

```bash
cd ~/.n8n/nodes && npm install n8n-nodes-volanea
```

## Credentials

Create a **Volanea API** credential with a secret key from **Settings → API keys** in
the Volanea dashboard. A test key (`sk_test_…`) renders and logs every message without
delivering it, which is handy while you build the workflow.

## Volanea node

| Resource | Operation | What it does |
| --- | --- | --- |
| Email | Send | `POST /v1/send`: HTML, plain text or a saved template with variables. Comma-separated recipients each get their own copy. Optional sender name, Reply-To, marketing type, scheduled send, binary attachments and an idempotency key. |
| Contact | Create or Update | Upserts by email: first/last name, subscription and custom data. |
| Event | Track | Records an event for a contact, to start Volanea workflows and build segments. |

`from` must be on a domain verified in Volanea; an unverified domain fails the item
with the API's message.

## Volanea Trigger

Pick the events (or **Any Event**) and activate the workflow. The node registers its
own webhook endpoint in Volanea, removes it again when you deactivate the workflow,
and checks the `X-Volanea-Signature` on every delivery, so a forged request is answered
`401` and never starts the workflow.

Each execution receives the event as Volanea sends it:

```json
{
  "eventId": "evt-…",
  "event": "email.bounced",
  "createdAt": "2026-10-18T10:00:00.000Z",
  "contactId": "c-…",
  "emailId": "email-…",
  "data": { "to": "ada@example.com", "detail": "550 5.1.1 user unknown" }
}
```

n8n must be reachable from the internet for the trigger: deliveries come from Volanea's
servers, so set `WEBHOOK_URL` to your public n8n address.

## License

MIT
