# Volanea integrations

Framework integrations for [Volanea](https://volanea.com). One shared core, one
published package per framework. (The n8n nodes call the API through n8n's own
authenticated HTTP helper, so they don't use core.)

| Package | npm | What it does |
| --- | --- | --- |
| [`packages/strapi`](packages/strapi) | `strapi-provider-email-volanea` | Strapi v5 email provider — admin invites, password resets, user confirmations |
| [`packages/medusa`](packages/medusa) | `medusa-provider-notification-volanea` | Medusa v2 notification provider — order confirmations, password resets, invites |
| [`packages/n8n`](packages/n8n) | `n8n-nodes-volanea` | n8n community nodes — send email, upsert contacts, track events; trigger on delivery, bounce, open, click and inbound mail |
| [`packages/zapier`](packages/zapier) | *Zapier CLI push* | Zapier app — New Event trigger (REST hook), Send Email, Create or Update Contact, Track Event |
| [`packages/github-action`](packages/github-action) | *its own repo* | `volanea/send-email` GitHub Action for CI — release notes, deploy alerts |
| [`packages/core`](packages/core) | *never published* | Shared HTTP client, error mapping, skip handling, address parsing |

## Zero runtime dependencies, by construction

Every published package installs with **no dependencies of its own**. Core is
not a dependency — it is listed in each package's `devDependencies`, which is
what makes tsup treat it as internal and inline it into `dist/`. The tarball
contains the shared code, not a link to it.

Two things have to be true for that to hold, and both are checked below:

- `dist/index.js` must not `require("@volanea/integrations-core")`
- `dist/index.d.ts` must not `import ... from "@volanea/integrations-core"` —
  and must not reference core's *internal* files either. Core is built to a
  single flat `dist/index.d.ts` for exactly this reason: a d.ts that still said
  `from "./errors"` would ship a dangling type reference to every consumer.

```bash
npm run build
# Match imports, not prose — the doc comments mention core by name on purpose.
grep -nE "(require\(|from )['\"]@volanea/integrations-core" \
  packages/*/dist/index.js packages/*/dist/index.d.ts    # expect no matches
```

The only external imports left in a built `.d.ts` should be the package's own
peer dependency (`@medusajs/*` for the Medusa provider; none for Strapi).

Because the providers inline core's built types, **core builds first**. The root
`build` script orders it explicitly, and each package has a `prebuild` that
builds core, so `npm run build -w <package>` on its own is also correct.

## What is shared, and what deliberately is not

Core holds what is genuinely identical in both ecosystems: the HTTP client, the
`send_failed` → `details[0].code` unwrapping, skip handling, address parsing,
and the `VolaneaError` type.

**Attachment encoding is not shared, on purpose.** A string `content` means:

| | Meaning | Why |
| --- | --- | --- |
| Strapi | raw text | Nodemailer's rule; Strapi's Email plugin passes attachments straight through |
| Medusa | already base64 | Medusa's own type declares `content: string` and its providers hand it to SendGrid |

The two ecosystems genuinely disagree. Unifying this would silently corrupt
every attachment in one of them, so each package implements its own and each
file carries a comment pointing at the other. Do not "fix" this.

## Development

```bash
npm install          # workspaces
npm run build        # core first, then both providers
npm test             # core 24, strapi 24, medusa 53
```

Tests use Node's built-in runner — no test framework anywhere in the tree. Each
package tests against its **built** output, not its source, so a packaging
mistake fails the suite rather than the customer.

## Releasing

Each package publishes independently, from its own directory:

```bash
cd packages/strapi && npm publish
```

`prepublishOnly` rebuilds first. Before publishing a provider for the first
time, verify the tarball in a clean project rather than with `npm link` —
a symlink resolves paths that a real install does not, so it hides exactly the
failures that only appear after publishing (build output missing from `files`,
`main`/`types` pointing at something that was never emitted, a dangling type
import):

```bash
npm pack
cd /tmp && mkdir check && cd check && npm init -y
npm install /path/to/package-1.0.0.tgz
npm ls --all      # the provider, and nothing under it
```

## Licence

MIT
