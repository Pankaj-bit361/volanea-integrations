import {
  NodeApiError,
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type IHttpRequestMethods,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
  type JsonObject,
} from "n8n-workflow";

/** Calls the Volanea API with the node's credential and unwraps `{ success, data }`. */
export async function volaneaRequest(
  this: IExecuteFunctions,
  method: IHttpRequestMethods,
  path: string,
  body?: IDataObject,
  headers: Record<string, string> = {},
): Promise<IDataObject> {
  const credentials = await this.getCredentials("volaneaApi");
  const baseUrl = String(credentials.baseUrl || "https://api.volanea.com").replace(/\/+$/, "");
  try {
    const res = (await this.helpers.httpRequestWithAuthentication.call(this, "volaneaApi", {
      method,
      url: `${baseUrl}${path}`,
      body,
      headers,
      json: true,
    })) as IDataObject;
    return (res?.data as IDataObject) ?? res;
  } catch (error) {
    throw new NodeApiError(this.getNode(), error as JsonObject);
  }
}

const list = (value: string): string[] =>
  value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export class Volanea implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Volanea",
    name: "volanea",
    icon: "file:volanea.svg",
    group: ["output"],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description: "Send email, upsert contacts and track events with Volanea",
    defaults: { name: "Volanea" },
    inputs: ["main"],
    outputs: ["main"],
    usableAsTool: true,
    credentials: [{ name: "volaneaApi", required: true }],
    properties: [
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        options: [
          { name: "Email", value: "email" },
          { name: "Contact", value: "contact" },
          { name: "Event", value: "event" },
        ],
        default: "email",
      },

      // ── Email ───────────────────────────────────────────────────────────
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["email"] } },
        options: [{ name: "Send", value: "send", action: "Send an email", description: "Send a transactional or marketing email" }],
        default: "send",
      },
      {
        displayName: "From",
        name: "from",
        type: "string",
        default: "",
        placeholder: "hello@yourdomain.com",
        description: "Must be on a domain verified in Volanea. Leave empty to use the template's sender.",
        displayOptions: { show: { resource: ["email"] } },
      },
      {
        displayName: "To",
        name: "to",
        type: "string",
        default: "",
        required: true,
        placeholder: "ada@example.com, bob@example.com",
        description: "One address, or several separated by commas (each gets its own copy, up to 50)",
        displayOptions: { show: { resource: ["email"] } },
      },
      {
        displayName: "Content",
        name: "content",
        type: "options",
        options: [
          { name: "HTML", value: "html" },
          { name: "Plain Text", value: "text" },
          { name: "Template", value: "template" },
        ],
        default: "html",
        displayOptions: { show: { resource: ["email"] } },
      },
      {
        displayName: "Subject",
        name: "subject",
        type: "string",
        default: "",
        description: "Required unless a template provides one",
        displayOptions: { show: { resource: ["email"] } },
      },
      {
        displayName: "HTML",
        name: "html",
        type: "string",
        typeOptions: { rows: 6 },
        default: "",
        displayOptions: { show: { resource: ["email"], content: ["html"] } },
      },
      {
        displayName: "Text",
        name: "text",
        type: "string",
        typeOptions: { rows: 6 },
        default: "",
        displayOptions: { show: { resource: ["email"], content: ["text"] } },
      },
      {
        displayName: "Template ID",
        name: "templateId",
        type: "string",
        default: "",
        required: true,
        placeholder: "tmpl-…",
        displayOptions: { show: { resource: ["email"], content: ["template"] } },
      },
      {
        displayName: "Variables",
        name: "variables",
        type: "fixedCollection",
        typeOptions: { multipleValues: true },
        placeholder: "Add Variable",
        default: {},
        description: "Values for {{placeholders}} in the subject and body",
        displayOptions: { show: { resource: ["email"] } },
        options: [
          {
            name: "variable",
            displayName: "Variable",
            values: [
              { displayName: "Name", name: "name", type: "string", default: "" },
              { displayName: "Value", name: "value", type: "string", default: "" },
            ],
          },
        ],
      },
      {
        displayName: "Additional Fields",
        name: "emailOptions",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["email"] } },
        options: [
          { displayName: "From Name", name: "fromName", type: "string", default: "" },
          { displayName: "Reply-To", name: "replyTo", type: "string", default: "" },
          {
            displayName: "Type",
            name: "type",
            type: "options",
            options: [
              { name: "Transactional", value: "transactional", description: "Always sent, even to unsubscribed contacts" },
              { name: "Marketing", value: "marketing", description: "Skips unsubscribed contacts and adds the unsubscribe footer" },
            ],
            default: "transactional",
          },
          { displayName: "Send At", name: "sendAt", type: "dateTime", default: "", description: "Schedule the send instead of sending now" },
          {
            displayName: "Attachments (Binary Properties)",
            name: "attachments",
            type: "string",
            default: "",
            placeholder: "data, invoice",
            description: "Names of binary properties on the input item to attach, separated by commas (up to 10)",
          },
          {
            displayName: "Idempotency Key",
            name: "idempotencyKey",
            type: "string",
            default: "",
            description: "A retry with the same key returns the first result instead of sending again",
          },
        ],
      },

      // ── Contact ─────────────────────────────────────────────────────────
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["contact"] } },
        options: [{ name: "Create or Update", value: "upsert", action: "Create or update a contact", description: "Matched by email address" }],
        default: "upsert",
      },
      {
        displayName: "Email",
        name: "email",
        type: "string",
        placeholder: "name@email.com",
        default: "",
        required: true,
        displayOptions: { show: { resource: ["contact", "event"] } },
      },
      {
        displayName: "Additional Fields",
        name: "contactOptions",
        type: "collection",
        placeholder: "Add Field",
        default: {},
        displayOptions: { show: { resource: ["contact"] } },
        options: [
          { displayName: "First Name", name: "firstName", type: "string", default: "" },
          { displayName: "Last Name", name: "lastName", type: "string", default: "" },
          { displayName: "Subscribed", name: "subscribed", type: "boolean", default: true },
          { displayName: "Data (JSON)", name: "data", type: "json", default: "{}", description: "Custom fields, e.g. {\"plan\": \"pro\"}" },
        ],
      },

      // ── Event ───────────────────────────────────────────────────────────
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["event"] } },
        options: [{ name: "Track", value: "track", action: "Track an event", description: "Record what a contact did, to trigger workflows and build segments" }],
        default: "track",
      },
      {
        displayName: "Event Name",
        name: "eventName",
        type: "string",
        default: "",
        required: true,
        placeholder: "order_completed",
        displayOptions: { show: { resource: ["event"] } },
      },
      {
        displayName: "Data (JSON)",
        name: "eventData",
        type: "json",
        default: "{}",
        description: "Properties of the event, e.g. {\"total\": 49}",
        displayOptions: { show: { resource: ["event"] } },
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter("resource", i) as string;
        let result: IDataObject;

        if (resource === "email") result = await sendEmail.call(this, i);
        else if (resource === "contact") result = await upsertContact.call(this, i);
        else result = await trackEvent.call(this, i);

        out.push({ json: result, pairedItem: { item: i } });
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
          continue;
        }
        throw error;
      }
    }
    return [out];
  }
}

function parseJson(this: IExecuteFunctions, value: unknown, field: string, i: number): IDataObject {
  if (value && typeof value === "object") return value as IDataObject;
  const s = String(value ?? "").trim();
  if (!s) return {};
  try {
    return JSON.parse(s) as IDataObject;
  } catch {
    throw new NodeOperationError(this.getNode(), `${field} is not valid JSON`, { itemIndex: i });
  }
}

async function sendEmail(this: IExecuteFunctions, i: number): Promise<IDataObject> {
  const content = this.getNodeParameter("content", i) as string;
  const to = list(this.getNodeParameter("to", i) as string);
  if (to.length === 0) throw new NodeOperationError(this.getNode(), "Add at least one recipient", { itemIndex: i });
  const options = this.getNodeParameter("emailOptions", i, {}) as IDataObject;
  const vars = (this.getNodeParameter("variables", i, {}) as { variable?: Array<{ name: string; value: string }> }).variable ?? [];

  const body: IDataObject = { to: to.length === 1 ? to[0] : to };
  const from = (this.getNodeParameter("from", i) as string).trim();
  const subject = (this.getNodeParameter("subject", i) as string).trim();
  if (from) body.from = from;
  if (subject) body.subject = subject;
  if (content === "html") body.html = this.getNodeParameter("html", i) as string;
  if (content === "text") body.text = this.getNodeParameter("text", i) as string;
  if (content === "template") body.templateId = (this.getNodeParameter("templateId", i) as string).trim();
  if (vars.length) body.variables = Object.fromEntries(vars.filter((v) => v.name).map((v) => [v.name, v.value]));
  for (const key of ["fromName", "replyTo", "type"] as const) if (options[key]) body[key] = options[key];
  if (options.sendAt) body.sendAt = new Date(options.sendAt as string).toISOString();

  if (options.attachments) {
    const names = list(options.attachments as string);
    body.attachments = [];
    for (const name of names) {
      const binary = this.helpers.assertBinaryData(i, name);
      const buffer = await this.helpers.getBinaryDataBuffer(i, name);
      (body.attachments as IDataObject[]).push({
        filename: binary.fileName ?? name,
        content: buffer.toString("base64"),
        contentType: binary.mimeType || "application/octet-stream",
      });
    }
  }

  const headers: Record<string, string> = options.idempotencyKey ? { "Idempotency-Key": String(options.idempotencyKey) } : {};
  return volaneaRequest.call(this, "POST", "/v1/send", body, headers);
}

async function upsertContact(this: IExecuteFunctions, i: number): Promise<IDataObject> {
  const options = this.getNodeParameter("contactOptions", i, {}) as IDataObject;
  const body: IDataObject = { email: (this.getNodeParameter("email", i) as string).trim() };
  for (const key of ["firstName", "lastName"] as const) if (options[key]) body[key] = options[key];
  if (options.subscribed !== undefined) body.subscribed = options.subscribed;
  if (options.data !== undefined) body.data = parseJson.call(this, options.data, "Data", i);
  return volaneaRequest.call(this, "POST", "/v1/contacts", body);
}

async function trackEvent(this: IExecuteFunctions, i: number): Promise<IDataObject> {
  const body: IDataObject = {
    name: (this.getNodeParameter("eventName", i) as string).trim(),
    email: (this.getNodeParameter("email", i) as string).trim(),
  };
  const data = parseJson.call(this, this.getNodeParameter("eventData", i, "{}"), "Data", i);
  if (Object.keys(data).length) body.data = data;
  return volaneaRequest.call(this, "POST", "/v1/events", body);
}
