import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils";
import type { Logger, NotificationTypes } from "@medusajs/framework/types";
import { INVALID_DATA_CODES, VolaneaClient, VolaneaError } from "@volanea/integrations-core";
import { resolveOptions } from "./options";
import { buildPayload, type NotificationLike } from "./payload";
import type { ResolvedOptions, VolaneaOptions } from "./types";

type InjectedDependencies = {
  logger: Logger;
};

export class VolaneaNotificationService extends AbstractNotificationProviderService {
  static identifier = "volanea";

  protected readonly config_: ResolvedOptions;
  protected readonly client_: VolaneaClient;
  protected readonly logger_: Logger;

  /**
   * Medusa calls this before constructing the provider, so a typo in
   * medusa-config.ts is reported at boot with the option named.
   */
  static validateOptions(options: Record<string, unknown>): void {
    resolveOptions(options as VolaneaOptions);
  }

  constructor({ logger }: InjectedDependencies, options: VolaneaOptions) {
    super();
    this.config_ = resolveOptions(options);
    this.client_ = new VolaneaClient(this.config_);
    this.logger_ = logger;
  }

  async send(
    notification: NotificationTypes.ProviderSendNotificationDTO,
  ): Promise<NotificationTypes.ProviderSendNotificationResultsDTO> {
    if (!notification) {
      throw new MedusaError(MedusaError.Types.INVALID_DATA, "No notification information provided");
    }

    const payload = this.wrap(() =>
      buildPayload(notification as unknown as NotificationLike, this.config_),
    );

    const idempotencyKey = (notification.provider_data as Record<string, unknown> | undefined)
      ?.idempotencyKey as string | undefined;

    const result = await this.wrapAsync(() => this.client_.send(payload, idempotencyKey));

    if (result.testMode) {
      this.logger_?.warn?.(
        "[volanea] sent with a test-mode key — the message was rendered and logged but not delivered.",
      );
    }
    if (result.skipped.length) {
      const reasons = [...new Set(result.skipped.map((m) => m.skipped))].join(", ");
      this.logger_?.warn?.(`[volanea] ${result.skipped.length} recipient(s) skipped (${reasons}).`);
    }

    // The Volanea message id, so Medusa's notification row can be correlated
    // with the delivery, bounce and complaint webhooks later.
    return { id: result.accepted[0]?.id };
  }

  /** Convert a VolaneaError into the MedusaError shape Medusa expects. */
  private toMedusaError(error: unknown): MedusaError {
    if (!(error instanceof VolaneaError)) {
      const message = error instanceof Error ? error.message : String(error);
      return new MedusaError(MedusaError.Types.UNEXPECTED_STATE, `Failed to send email: ${message}`);
    }
    const type = INVALID_DATA_CODES.has(error.code)
      ? MedusaError.Types.INVALID_DATA
      : MedusaError.Types.UNEXPECTED_STATE;
    return new MedusaError(type, `Failed to send email: ${error.code} — ${error.message}`);
  }

  private wrap<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      throw this.toMedusaError(error);
    }
  }

  private async wrapAsync<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw this.toMedusaError(error);
    }
  }
}

export default VolaneaNotificationService;
