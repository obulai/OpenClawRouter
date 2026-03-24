export class OpenClawRouterError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "OpenClawRouterError";
  }
}

export class TranslateError extends OpenClawRouterError {
  constructor(message: string) {
    super(message, "TRANSLATE_ERROR");
  }
}

export class ProviderError extends OpenClawRouterError {
  constructor(
    message: string,
    public statusCode: number,
    public retryable: boolean,
  ) {
    super(message, "PROVIDER_ERROR");
  }
}

export class PaymentError extends OpenClawRouterError {
  constructor(message: string) {
    super(message, "PAYMENT_ERROR");
  }
}

export class ConfigError extends OpenClawRouterError {
  constructor(message: string) {
    super(message, "CONFIG_ERROR");
  }
}
