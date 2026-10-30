import { describe, it, expect } from 'vitest';
import { HISTORICAL_REAL_RETURNS as R } from './historicalReturns';

describe('HISTORICAL_REAL_RETURNS', () => {
  it('covers consecutive years from 1871', () => {
    expect(R[0].year).toBe(1871);
    expect(R.length).toBeGreaterThanOrEqual(150);
    for (let i = 1; i < R.length; i++) expect(R[i].year).toBe(R[i - 1].year + 1);
  });

  it('has plausible real returns', () => {
    for (const r of R) {
      expect(r.real).toBeGreaterThan(-0.5);
      expect(r.real).toBeLessThan(0.6);
    }
    const mean = R.reduce((s, r) => s + r.real, 0) / R.length;
    expect(mean).toBeGreaterThan(0.05);
    expect(mean).toBeLessThan(0.1);
  });

  it('includes the known crashes', () => {
    const at = (year: number) => R.find(r => r.year === year)!.real;
    expect(at(1931)).toBeLessThan(-0.3);
    expect(at(1974)).toBeLessThan(-0.2);
    expect(at(2008)).toBeLessThan(-0.3);
  });
});
