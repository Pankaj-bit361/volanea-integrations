/**
 * Volanea email provider for Strapi v5.
 *
 * Maps `strapi.plugins.email.services.email.send()` onto Volanea's
 * `POST /v1/send`. The shared HTTP client, error mapping and address parsing
 * come from `@volanea/integrations-core`, which is inlined at build time — the
 * published package has no runtime dependencies.
 */
import {
  VolaneaClient,
  VolaneaError,
  parseAddress,
  parseAddressList,
  resolveClientConfig,
  type VolaneaSendResult,
} from "@volanea/integrations-core";
import { buildPayload, type StrapiSendOptions, type StrapiSettings } from "./payload";
import { normalizeAttachments } from "./attachments";

const PACKAGE = "strapi-provider-email-volanea";
const VERSION = "1.0.0";

export interface StrapiProviderOptions {
  /** Volanea secret key. Required. */
  apiKey?: string;
  /** Override the API base URL. */
  baseUrl?: string;
  /** Request timeout in ms. Defaults to 15000. */
  timeout?: number;
  /**
   * Throw when Volanea accepted the request but skipped every recipient
   * (suppressed, unsubscribed, over quota). Defaults to true.
   */
  throwOnSkip?: boolean;
}

export interface StrapiProvider {
  send(options: StrapiSendOptions): Promise<VolaneaSendResult>;
}

export function init(
  providerOptions: StrapiProviderOptions = {},
  settings: StrapiSettings = {},
): StrapiProvider {
  const config = resolveClientConfig(
    providerOptions,
    PACKAGE,
    `${PACKAGE}/${VERSION}`,
  );
  const client = new VolaneaClient(config);

  return {
    async send(options: StrapiSendOptions): Promise<VolaneaSendResult> {
      return client.send(buildPayload(options, settings));
    },
  };
}

/** Exposed for tests. */
export const _internals = {
  buildPayload,
  parseAddress,
  parseAddressList,
  normalizeAttachments,
};

export { VolaneaError };
export type { StrapiSendOptions, StrapiSettings };
