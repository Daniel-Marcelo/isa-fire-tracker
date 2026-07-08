import { describe, it, expect } from 'vitest';
import { migrateAppData, stripDerived } from './store';
import type { AppData, Holding } from './types';

describe('stripDerived', () => {
  it('drops currentPrice and currentValue but keeps stored fields', () => {
    const holding: Holding = { id: 'h1', name: 'A', units: 10, currentPrice: 5, currentValue: 50, costBasis: 40 };
    const stripped = stripDerived(holding);
    expect('currentPrice' in stripped).toBe(false);
    expect('currentValue' in stripped).toBe(false);
    expect(stripped.units).toBe(10);
    expect(stripped.costBasis).toBe(40);
  });
});

describe('migrateAppData', () => {
  it('migrates legacy currentValue to manualValue when manualValue is absent', () => {
    const legacy = {
      providers: [
        { id: 'p1', name: 'P', color: '#000', holdings: [{ id: 'h1', name: 'A', currentValue: 123 }], snapshots: [] },
      ],
    } as unknown as AppData;
    const migrated = migrateAppData(legacy);
    const holding = migrated.providers[0].holdings[0];
    expect(holding.manualValue).toBe(123);
    expect('currentValue' in holding).toBe(false);
  });

  it('does not override an existing manualValue with a legacy currentValue', () => {
    const legacy = {
      providers: [
        { id: 'p1', name: 'P', color: '#000', holdings: [{ id: 'h1', name: 'A', manualValue: 10, currentValue: 999 }], snapshots: [] },
      ],
    } as unknown as AppData;
    const migrated = migrateAppData(legacy);
    expect(migrated.providers[0].holdings[0].manualValue).toBe(10);
  });

  it('strips derived fields from every migrated holding', () => {
    const legacy = {
      providers: [
        { id: 'p1', name: 'P', color: '#000', holdings: [{ id: 'h1', name: 'A', units: 1, currentPrice: 7, currentValue: 7 }], snapshots: [] },
      ],
    } as unknown as AppData;
    const migrated = migrateAppData(legacy);
    const holding = migrated.providers[0].holdings[0];
    expect('currentPrice' in holding).toBe(false);
    expect('currentValue' in holding).toBe(false);
  });

  it('defaults contributions to [] when missing from the parsed data', () => {
    const legacy = { providers: [] } as unknown as AppData;
    const migrated = migrateAppData(legacy);
    expect(migrated.contributions).toEqual([]);
  });
});
