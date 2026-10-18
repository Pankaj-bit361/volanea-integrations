import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties } from "n8n-workflow";

export class VolaneaApi implements ICredentialType {
  name = "volaneaApi";

  displayName = "Volanea API";

  documentationUrl = "https://volanea.com/docs/integrations/n8n";

  properties: INodeProperties[] = [
    {
      displayName: "Secret Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      placeholder: "sk_live_…",
      description: "A secret key from Settings → API keys. A test key (sk_test_…) renders and logs mail without delivering it.",
    },
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      default: "https://api.volanea.com",
      description: "Only change this to point at a self-hosted or local Volanea API",
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: { Authorization: "=Bearer {{$credentials.apiKey}}" },
    },
  };

  // Any secret-key route works; listing domains is cheap and read-only.
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
      url: "/v1/domains",
    },
  };
}
