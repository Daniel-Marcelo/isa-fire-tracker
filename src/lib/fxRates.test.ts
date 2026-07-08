import { describe, it, expect } from 'vitest';
import { convertAmount } from './fxRates';

describe('convertAmount', () => {
  it('GBP to GBP is an identity', () => {
    expect(convertAmount(100, 'GBP', 'GBP', { GBP: 1 })).toBe(100);
  });

  it('USD to GBP divides by the USD rate', () => {
    const rates = { GBP: 1, USD: 1.25 };
    expect(convertAmount(125, 'USD', 'GBP', rates)).toBeCloseTo(125 / 1.25, 8);
  });

  it('normalises GBp (pence) to GBP before converting', () => {
    expect(convertAmount(250, 'GBp', 'GBP', { GBP: 1 })).toBe(2.5);
  });

  // Unknown currencies silently fall back to rate 1 — documenting current
  // (arguably bad) behaviour. This is exactly why providerGbpTotal (snapshots.ts)
  // checks fxRates explicitly rather than relying on convertAmount to fail loudly.
  it('falls back to rate 1 for an unknown currency (documents current behaviour)', () => {
    expect(convertAmount(100, 'XYZ', 'GBP', { GBP: 1 })).toBe(100);
  });
});
