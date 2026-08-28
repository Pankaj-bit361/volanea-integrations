/**
 * Volanea notification provider for Medusa v2.
 *
 * The shared HTTP client, error mapping and address parsing come from
 * `@volanea/integrations-core`, which is inlined at build time — the published
 * package has no runtime dependencies.
 */
import { ModuleProvider, Modules } from "@medusajs/framework/utils";
import { VolaneaNotificationService } from "./service";

const services = [VolaneaNotificationService];

export default ModuleProvider(Modules.NOTIFICATION, {
  services,
});

export { VolaneaNotificationService };
export { VolaneaClient, VolaneaError, parseAddress } from "@volanea/integrations-core";
export { resolveOptions } from "./options";
export { buildPayload, flattenVariables } from "./payload";
export { normalizeAttachments } from "./attachments";
export * from "./types";
