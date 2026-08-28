import { VolaneaError } from "./errors";

export const DEFAULT_BASE_URL = "https://api.volanea.com";
export const DEFAULT_TIMEOUT_MS = 15_000;
const SEND_PATH = "/v1/send";

/** One entry in `data.messages` of a successful send response. */
export interface VolaneaMessage {
  id?: string;
  to?: string;
  status?: "sent" | "scheduled" | "queued";
  skipped?: string;
}

export interface VolaneaSendResult {
  messages: VolaneaMessage[];
  /** Messages the API took responsibility for — these have an id. */
  accepted: VolaneaMessage[];
  /** Recipients the API declined to mail, with the reason. */
  skipped: VolaneaMessage[];
  testMode: boolean;
  replay: boolean;
}

export interface VolaneaClientConfig {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  /** Sent as User-Agent, so the API can attribute traffic to a provider. */
  userAgent: string;
  /** Throw when the API accepted the request but skipped every recipient. */
  throwOnSkip: boolean;
}

/**
 * Validate the parts of a config that are the same for every integration.
 *
 * This runs at construction time on purpose: a provider missing its key must
 * fail while the framework is booting, not resolve fine until the first real
 * message and then lose it. `label` names the package in the message, since
 * the reader is looking at a framework's config file, not at this code.
 */
export function resolveClientConfig(
  input: {
    apiKey?: string;
    baseUrl?: string;
    timeout?: number;
    throwOnSkip?: boolean;
  },
  label: string,
  userAgent: string,
): VolaneaClientConfig {
  if (!input.apiKey) {
    throw new VolaneaError(
      `[${label}] \`apiKey\` is required. Set it from an environment variable ` +
        `rather than hard-coding the key.`,
      { code: "invalid_options" },
    );
  }

  if (typeof fetch !== "function") {
    throw new VolaneaError(
      `[${label}] global fetch is unavailable. This provider requires Node 18 or newer.`,
      { code: "invalid_options" },
    );
  }

  const timeout = input.timeout ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new VolaneaError(
      `[${label}] \`timeout\` must be a positive number of milliseconds, got ${String(input.timeout)}.`,
      { code: "invalid_options" },
    );
  }

  return {
    apiKey: input.apiKey,
    baseUrl: String(input.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    timeout,
    throwOnSkip: input.throwOnSkip ?? true,
    userAgent,
  };
}

interface ErrorBody {
  success?: boolean;
  error?: string;
  code?: string;
  details?: { code?: string }[];
}

type SuccessBody = {
  success?: boolean;
  data?: { messages?: VolaneaMessage[]; testMode?: boolean; replay?: boolean };
};

/** A dependency-free client for the one endpoint these integrations need. */
export class VolaneaClient {
  constructor(private readonly config: VolaneaClientConfig) {}

  async send(payload: unknown, idempotencyKey?: string): Promise<VolaneaSendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeout);

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}${SEND_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "User-Agent": this.config.userAgent,
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      const err = error as { name?: string; message?: string };
      if (err?.name === "AbortError") {
        throw new VolaneaError(`Volanea did not respond within ${this.config.timeout}ms.`, {
          code: "timeout",
        });
      }
      throw new VolaneaError(
        `Could not reach the Volanea API: ${err?.message ?? "unknown network error"}`,
        { code: "network_error" },
      );
    } finally {
      clearTimeout(timer);
    }

    let body: (ErrorBody & SuccessBody) | undefined;
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new VolaneaError(
        `Volanea returned a non-JSON response (HTTP ${response.status}).`,
        { code: "bad_response", status: response.status },
      );
    }

    if (!response.ok || body?.success === false) {
      throw toSendError(body ?? {}, response);
    }

    const messages = body?.data?.messages ?? [];
    const accepted = messages.filter((m) => m.id);
    const skipped = messages.filter((m) => m.skipped);

    // A 200 does not imply anyone was mailed. Skips ride along inside a
    // successful body, and both frameworks read a resolved promise as "sent" —
    // so an entirely skipped send has to be raised, or a password reset
    // disappears with nothing in the logs to explain it.
    if (this.config.throwOnSkip && !accepted.length && skipped.length) {
      const reasons = [...new Set(skipped.map((m) => m.skipped))].join(", ");
      throw new VolaneaError(
        `Volanea skipped every recipient (${reasons}). No email was sent.`,
        { code: "all_recipients_skipped", skipped },
      );
    }

    return {
      messages,
      accepted,
      skipped,
      testMode: Boolean(body?.data?.testMode),
      replay: Boolean(body?.data?.replay),
    };
  }
}

/**
 * Turn an error body into a VolaneaError.
 *
 * Branching happens on `code`, never on the wording of `error`. Every failure
 * inside the send pipeline keeps the top-level code `send_failed` and names the
 * real cause in `details[0].code`, so that is what gets surfaced — otherwise a
 * bad template id and a paused project look identical to a caller.
 */
export function toSendError(body: ErrorBody, response: Response): VolaneaError {
  const cause = body.details?.[0]?.code;
  const code = cause ?? body.code ?? httpFallbackCode(response.status);
  const retryAfter =
    response.status === 429 ? response.headers?.get?.("Retry-After") ?? undefined : undefined;

  const message = retryAfter
    ? `${body.error ?? "Volanea rate limit reached"} (retry after ${retryAfter}s)`
    : body.error ?? `Volanea send failed (HTTP ${response.status}).`;

  return new VolaneaError(message, { code, status: response.status, details: body.details });
}

function httpFallbackCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 429) return "rate_limited";
  return "send_failed";
}
