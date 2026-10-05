import { describe, it, expect } from 'vitest';
import { portfolioSummary } from './portfolioSummary';
import type { AppData, Provider } from '../types';

function data(providers: Provider[], contributions: AppData['contributions'] = []): AppData {
  return {
    providers,
    taxYear: 2026,
    contributions,
    fireSettings: {
      currentAge: 40,
      targetRetirementAge: 55,
      monthlyContribution: 0,
      expectedAnnualReturn: 7,
      inflationRate: 3,
      annualExpensesInRetirement: 30000,
      withdrawalRate: 4,
    },
    userSettings: { currency: 'GBP' },
    targets: [],
  };
}

const isa: Provider = {
  id: 'isa', name: 'Vanguard', color: '#6366f1', accountType: 'ISA', owner: 'Daniel',
  holdings: [{ id: 'h1', name: 'VWRL', currentValue: 100, costBasis: 80 }],
  snapshots: [],
};
const sipp: Provider = {
  id: 'sipp', name: 'HL', color: '#818cf8', accountType: 'SIPP',
  holdings: [{ id: 'h2', name: 'SIPP fund', currentValue: 50, costBasis: 40 }],
  snapshots: [],
};

describe('portfolioSummary', () => {
  it('splits pension from accessible money and sums gain', () => {
    const summary = portfolioSummary(data([isa, sipp]));
    expect(summary).toMatchObject({
      total: 150,
      cost: 120,
      gain: 30,
      gainPct: 25,
      accessible: 100,
      pension: 50,
      hasAccounts: true,
    });
  });

  it('reports an empty portfolio without a gain percent', () => {
    const summary = portfolioSummary(data([]));
    expect(summary).toMatchObject({
      total: 0, cost: 0, gain: 0, gainPct: 0, accessible: 0, pension: 0, hasAccounts: false,
    });
  });
});
