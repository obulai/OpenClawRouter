export interface SpendLimits {
  maxPerRequest?: number; // in USD cents
  maxHourly?: number;     // in USD cents
  maxDaily?: number;      // in USD cents
}

export class SpendController {
  private hourlySpend: number = 0;
  private dailySpend: number = 0;
  private hourlyResetAt: number;
  private dailyResetAt: number;

  constructor(private limits: SpendLimits) {
    const now = Date.now();
    this.hourlyResetAt = now + 60 * 60 * 1000;
    this.dailyResetAt = now + 24 * 60 * 60 * 1000;
  }

  /**
   * Check if a request with the given cost is allowed.
   */
  canSpend(amountCents: number): { allowed: boolean; reason?: string } {
    this.maybeReset();

    if (this.limits.maxPerRequest !== undefined && amountCents > this.limits.maxPerRequest) {
      return {
        allowed: false,
        reason: `Request cost ${amountCents}c exceeds per-request limit of ${this.limits.maxPerRequest}c`,
      };
    }

    if (this.limits.maxHourly !== undefined && this.hourlySpend + amountCents > this.limits.maxHourly) {
      return {
        allowed: false,
        reason: `Would exceed hourly limit of ${this.limits.maxHourly}c (current: ${this.hourlySpend}c, request: ${amountCents}c)`,
      };
    }

    if (this.limits.maxDaily !== undefined && this.dailySpend + amountCents > this.limits.maxDaily) {
      return {
        allowed: false,
        reason: `Would exceed daily limit of ${this.limits.maxDaily}c (current: ${this.dailySpend}c, request: ${amountCents}c)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a successful spend.
   */
  recordSpend(amountCents: number): void {
    this.maybeReset();
    this.hourlySpend += amountCents;
    this.dailySpend += amountCents;
  }

  /**
   * Reset counters if their windows have elapsed.
   */
  private maybeReset(): void {
    const now = Date.now();

    if (now >= this.hourlyResetAt) {
      this.hourlySpend = 0;
      this.hourlyResetAt = now + 60 * 60 * 1000;
    }

    if (now >= this.dailyResetAt) {
      this.dailySpend = 0;
      this.dailyResetAt = now + 24 * 60 * 60 * 1000;
    }
  }
}
