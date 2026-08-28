import { resolveClientConfig, type VolaneaClientConfig } from "@volanea/integrations-core";
import type { ResolvedOptions, VolaneaOptions } from "./types";

const PACKAGE = "medusa-provider-notification-volanea";
const VERSION = "1.0.0";

/**
 * Collapse the option aliases, apply defaults, and fail loudly on anything
 * missing.
 *
 * Medusa's first-party providers spell their options in snake_case
 * (`@medusajs/notification-sendgrid` takes `api_key`), while this package
 * documents camelCase — so both are accepted and camelCase wins when a config
 * somehow carries each.
 */
export function resolveOptions(options: VolaneaOptions | undefined): ResolvedOptions {
  const o = options ?? {};

  const client: VolaneaClientConfig = resolveClientConfig(
    {
      apiKey: o.apiKey ?? o.api_key,
      baseUrl: o.baseUrl ?? o.base_url,
      timeout: o.timeout,
      throwOnSkip: o.throwOnSkip ?? o.throw_on_skip,
    },
    PACKAGE,
    `${PACKAGE}/${VERSION}`,
  );

  return {
    ...client,
    from: o.from,
    fromName: o.fromName ?? o.from_name,
    replyTo: o.replyTo ?? o.reply_to,
  };
}
