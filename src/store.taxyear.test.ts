import { describe, it, expect, vi, afterEach } from 'vitest';
import { currentTaxYear, setTaxYearContribution, defaultData } from './store';
import type { AppData } from './types';

afterEach(() => {
  vi.useRealTimers();
});

describe('currentTaxYear', () => {
  it('returns the previous year on 5 April (last day of the old tax year)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 5)); // 5 April 2026
    expect(currentTaxYear()).toBe(2025);
  });

  it('returns the current year on 6 April (first day of the new tax year)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 6)); // 6 April 2026
    expect(currentTaxYear()).toBe(2026);
  });

  it('returns the previous year in January', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 15)); // 15 January 2026
    expect(currentTaxYear()).toBe(2025);
  });

  it('returns the current year in July', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8)); // 8 July 2026
    expect(currentTaxYear()).toBe(2026);
  });
});

describe('setTaxYearContribution', () => {
  const base = (): AppData => ({
    ...defaultData,
    contributions: [
      { taxYear: 2024, amount: 5000 },
      { taxYear: 2026, amount: 8500 },
    ],
  });

  it('adds a new entry for a year not yet present', () => {
    const result = setTaxYearContribution(base(), 2025, 1000);
    expect(result.contributions).toEqual([
      { taxYear: 2024, amount: 5000 },
      { taxYear: 2025, amount: 1000 },
      { taxYear: 2026, amount: 8500 },
    ]);
  });

  it('replaces the amount for a year already present (upsert)', () => {
    const result = setTaxYearContribution(base(), 2026, 12000);
    expect(result.contributions).toEqual([
      { taxYear: 2024, amount: 5000 },
      { taxYear: 2026, amount: 12000 },
    ]);
  });

  it('keeps contributions sorted ascending by tax year', () => {
    const result = setTaxYearContribution(base(), 2020, 3000);
    expect(result.contributions.map(c => c.taxYear)).toEqual([2020, 2024, 2026]);
  });

  it('removes the entry when the amount is zero', () => {
    const result = setTaxYearContribution(base(), 2026, 0);
    expect(result.contributions).toEqual([{ taxYear: 2024, amount: 5000 }]);
  });

  it('does not mutate the input data', () => {
    const data = base();
    setTaxYearContribution(data, 2026, 12000);
    expect(data.contributions).toEqual([
      { taxYear: 2024, amount: 5000 },
      { taxYear: 2026, amount: 8500 },
    ]);
  });
});
