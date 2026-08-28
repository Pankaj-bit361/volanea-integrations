import type { VolaneaClientConfig } from "@volanea/integrations-core";

/**
 * Provider options, as given under `options` in the notification module's
 * provider entry in `medusa-config.ts`.
 *
 * Medusa's first-party providers spell their options in snake_case
 * (`@medusajs/notification-sendgrid` takes `api_key`), so every option is
 * accepted in either style and camelCase wins when both are present.
 */
export interface VolaneaOptions {
  /** Volanea secret key. Required. */
  apiKey?: string;
  api_key?: string;
  /** Override the API host. Defaults to https://api.volanea.com. */
  baseUrl?: string;
  base_url?: string;
  /** Default sender. Must be on a domain verified in Volanea. */
  from?: string;
  /** Default sender display name. */
  fromName?: string;
  from_name?: string;
  /** Default Reply-To. */
  replyTo?: string;
  reply_to?: string;
  /** Abort the request after this many ms. Defaults to 15000. */
  timeout?: number;
  /**
   * Throw when Volanea accepted the request but skipped every recipient.
   * Defaults to true — see the README on why a resolved promise would lie.
   */
  throwOnSkip?: boolean;
  throw_on_skip?: boolean;
  /** Set by Medusa; which channels this provider serves. Not read here. */
  channels?: string[];
}

/**
 * The options after defaults are applied and the aliases collapsed: the shared
 * client config plus the sender defaults only this provider has.
 */
export interface ResolvedOptions extends VolaneaClientConfig {
  from?: string;
  fromName?: string;
  replyTo?: string;
}

/** The body this provider POSTs to /v1/send. */
export interface VolaneaPayload {
  to: string | { email: string; name: string };
  subject?: string;
  html?: string;
  text?: string;
  templateId?: string;
  variables?: Record<string, string | number | boolean>;
  from?: string;
  fromName?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: { filename: string; content: string; contentType?: string }[];
  sendAt?: string;
  createContact?: boolean;
  type?: "transactional" | "marketing";
}
