import { createHmac, timingSafeEqual } from "node:crypto";
import {
  NodeApiError,
  type IDataObject,
  type IHookFunctions,
  type IHttpRequestMethods,
  type INodeType,
  type INodeTypeDescription,
  type IWebhookFunctions,
  type IWebhookResponseData,
  type JsonObject,
} from "n8n-workflow";

async function api(this: IHookFunctions, method: IHttpRequestMethods, path: string, body?: IDataObject): Promise<IDataObject> {
  const credentials = await this.getCredentials("volaneaApi");
  const baseUrl = String(credentials.baseUrl || "https://api.volanea.com").replace(/\/+$/, "");
  try {
    const res = (await this.helpers.httpRequestWithAuthentication.call(this, "volaneaApi", {
      method,
      url: `${baseUrl}${path}`,
      body,
      json: true,
    })) as IDataObject;
    return (res?.data as IDataObject) ?? res;
  } catch (error) {
    throw new NodeApiError(this.getNode(), error as JsonObject);
  }
}

/** X-Volanea-Signature: t=<unix-ms>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}`>. */
export function verifySignature(header: string | undefined, rawBody: string, secret: string, now = Date.now()): boolean {
  const parts = Object.fromEntries((header ?? "").split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t)) return false;
  if (Math.abs(now - t) > 5 * 60 * 1000) return false; // stale or replayed
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

const EVENTS = [
  { name: "Any Event", value: "*" },
  { name: "Email Bounced", value: "email.bounced" },
  { name: "Email Clicked", value: "email.clicked" },
  { name: "Email Complained", value: "email.complained" },
  { name: "Email Delivered", value: "email.delivered" },
  { name: "Email Failed", value: "email.failed" },
  { name: "Email Opened", value: "email.opened" },
  { name: "Email Received", value: "email.received", description: "Mail arrived at an inbox or inbound address" },
  { name: "Email Sent", value: "email.sent" },
  { name: "Contact Created", value: "contact.created" },
  { name: "Contact Unsubscribed", value: "contact.unsubscribed" },
];

export class VolaneaTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Volanea Trigger",
    name: "volaneaTrigger",
    icon: "file:volanea.svg",
    group: ["trigger"],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description: "Starts the workflow when Volanea sends an event: delivered, bounced, opened, clicked, received…",
    defaults: { name: "Volanea Trigger" },
    inputs: [],
    outputs: ["main"],
    credentials: [{ name: "volaneaApi", required: true }],
    webhooks: [{ name: "default", httpMethod: "POST", responseMode: "onReceived", path: "webhook" }],
    properties: [
      {
        displayName: "Events",
        name: "events",
        type: "multiOptions",
        options: EVENTS,
        default: ["email.received"],
        required: true,
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData("node");
        if (!data.endpointId) return false;
        const endpoints = (await api.call(this, "GET", "/v1/webhooks")) as unknown as IDataObject[];
        const url = this.getNodeWebhookUrl("default");
        const mine = (Array.isArray(endpoints) ? endpoints : []).find((e) => e.webhookEndpointId === data.endpointId && e.url === url);
        if (!mine) {
          delete data.endpointId;
          delete data.secret;
          return false;
        }
        return true;
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const events = this.getNodeParameter("events") as string[];
        const res = await api.call(this, "POST", "/v1/webhooks", {
          url: this.getNodeWebhookUrl("default") as string,
          description: `n8n — ${this.getWorkflow().name ?? "workflow"}`,
          ...(events.includes("*") ? {} : { events }),
        });
        const data = this.getWorkflowStaticData("node");
        data.endpointId = res.webhookEndpointId;
        data.secret = res.secret;
        return Boolean(res.webhookEndpointId);
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData("node");
        if (data.endpointId) {
          try {
            await api.call(this, "DELETE", `/v1/webhooks/${data.endpointId}`);
          } catch {
            // already gone — nothing to clean up
          }
        }
        delete data.endpointId;
        delete data.secret;
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const secret = this.getWorkflowStaticData("node").secret as string | undefined;
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody?.toString("utf8") ?? JSON.stringify(req.body);
    const signature = this.getHeaderData()["x-volanea-signature"] as string | undefined;

    // The secret is the one Volanea returned when create() registered this endpoint.
    if (!secret || !verifySignature(signature, raw, secret)) {
      const res = this.getResponseObject();
      res.status(401).json({ error: "invalid signature" });
      return { noWebhookResponse: true };
    }
    return { workflowData: [this.helpers.returnJsonArray(req.body as IDataObject)] };
  }
}
