import { describe, it, expect, vi, afterEach } from 'vitest';
import { SpendController } from '../spend-control.js';

describe('SpendController', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('per-request limit', () => {
    it('allows spend under the limit', () => {
      const ctrl = new SpendController({ maxPerRequest: 100 });
      expect(ctrl.canSpend(50)).toEqual({ allowed: true });
    });

    it('allows spend exactly at the limit', () => {
      const ctrl = new SpendController({ maxPerRequest: 100 });
      expect(ctrl.canSpend(100)).toEqual({ allowed: true });
    });

    it('rejects spend over the limit', () => {
      const ctrl = new SpendController({ maxPerRequest: 100 });
      const result = ctrl.canSpend(101);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('per-request limit');
    });
  });

  describe('hourly limit', () => {
    it('allows spend within hourly limit', () => {
      const ctrl = new SpendController({ maxHourly: 500 });
      ctrl.recordSpend(200);
      expect(ctrl.canSpend(200)).toEqual({ allowed: true });
    });

    it('rejects spend that would exceed hourly limit', () => {
      const ctrl = new SpendController({ maxHourly: 500 });
      ctrl.recordSpend(400);
      const result = ctrl.canSpend(200);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('hourly limit');
    });

    it('resets after the hourly window', () => {
      const ctrl = new SpendController({ maxHourly: 500 });
      ctrl.recordSpend(500);
      expect(ctrl.canSpend(1).allowed).toBe(false);

      // Advance time past the hourly reset
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61 * 60 * 1000);

      expect(ctrl.canSpend(500)).toEqual({ allowed: true });
    });
  });

  describe('daily limit', () => {
    it('allows spend within daily limit', () => {
      const ctrl = new SpendController({ maxDaily: 2000 });
      ctrl.recordSpend(1000);
      expect(ctrl.canSpend(500)).toEqual({ allowed: true });
    });

    it('rejects spend that would exceed daily limit', () => {
      const ctrl = new SpendController({ maxDaily: 2000 });
      ctrl.recordSpend(1500);
      const result = ctrl.canSpend(600);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('daily limit');
    });

    it('resets after the daily window', () => {
      const ctrl = new SpendController({ maxDaily: 2000 });
      ctrl.recordSpend(2000);
      expect(ctrl.canSpend(1).allowed).toBe(false);

      // Advance time past the daily reset
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);

      expect(ctrl.canSpend(2000)).toEqual({ allowed: true });
    });
  });

  describe('combined limits', () => {
    it('checks all limits together', () => {
      const ctrl = new SpendController({
        maxPerRequest: 100,
        maxHourly: 500,
        maxDaily: 2000,
      });

      // Per-request check first
      expect(ctrl.canSpend(150).allowed).toBe(false);

      // Under all limits
      expect(ctrl.canSpend(50)).toEqual({ allowed: true });
      ctrl.recordSpend(50);

      // Accumulate to hourly limit
      ctrl.recordSpend(400);
      const result = ctrl.canSpend(60);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('hourly limit');
    });
  });

  describe('no limits configured', () => {
    it('allows any spend when no limits are set', () => {
      const ctrl = new SpendController({});
      expect(ctrl.canSpend(999999)).toEqual({ allowed: true });
    });
  });
});
