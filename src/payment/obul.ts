import { PaymentBackend, ProviderConfig, ProviderResponse } from '../types.js';

export class ObulPaymentBackend implements PaymentBackend {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl: string = 'https://obul.polymerdao.xyz') {
    this.apiKey = apiKey;
    // Strip trailing slash for consistency
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /**
   * Rewrite a direct provider URL to go through Obul's proxy.
   * Input:  https://x402engine.app/api/llm/claude-opus
   * Output: https://obul.polymerdao.xyz/proxy/https/x402engine.app/api/llm/claude-opus
   */
  rewriteUrl(directUrl: string): string {
    const parsed = new URL(directUrl);
    const scheme = parsed.protocol.replace(':', ''); // "https" or "http"
    const hostAndPath = parsed.host + parsed.pathname;
    return `${this.baseUrl}/proxy/${scheme}/${hostAndPath}`;
  }

  async sendRequest(params: {
    provider: ProviderConfig;
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Buffer;
    stream: boolean;
  }): Promise<ProviderResponse> {
    const proxyUrl = this.rewriteUrl(params.url);

    const headers: Record<string, string> = {
      ...params.headers,
      'x-obul-api-key': this.apiKey,
    };

    const response = await fetch(proxyUrl, {
      method: params.method,
      headers,
      body: params.method !== 'GET' ? new Uint8Array(params.body) : undefined,
    });

    // Convert response headers to a plain object
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (params.stream && response.body) {
      return {
        status: response.status,
        headers: responseHeaders,
        body: Buffer.alloc(0),
        stream: response.body as unknown as ReadableStream,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      status: response.status,
      headers: responseHeaders,
      body: Buffer.from(arrayBuffer),
    };
  }
}
