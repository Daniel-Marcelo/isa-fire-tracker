import { describe, it, expect } from 'vitest';
import type { AppData } from '../types';
import { defaultData } from '../store';
import { aggregatePositions, planNewMoney, positionKey, type Position } from './rebalance';

function makeData(providers: AppData['providers']): AppData {
  return { ...defaultData, providers };
}

function holding(over: Partial<AppData['providers'][0]['holdings'][0]>): AppData['providers'][0]['holdings'][0] {
  return { id: Math.random().toString(36).slice(2), name: 'X', ...over };
}

function provider(holdings: AppData['providers'][0]['holdings']): AppData['providers'][0] {
  return { id: Math.random().toString(36).slice(2), name: 'P', color: '#fff', holdings, snapshots: [] };
}

describe('positionKey', () => {
  it('prefers the uppercased ticker', () => {
    expect(positionKey({ ticker: 'vwrp', name: 'Vanguard All-World' })).toBe('VWRP');
  });

  it('falls back to the exact name for ticker-less holdings, case preserved', () => {
    expect(positionKey({ name: 'Emergency fund' })).toBe('Emergency fund');
    expect(positionKey({ ticker: '  ', name: 'Gold' })).toBe('Gold');
  });
});

describe('aggregatePositions', () => {
  it('merges the same ticker across providers and sums values', () => {
    const data = makeData([
      provider([holding({ ticker: 'VWRP', name: 'All-World', currentValue: 6000 })]),
      provider([holding({ ticker: 'vwrp', name: 'All-World Acc', currentValue: 2000 })]),
    ]);
    const positions = aggregatePositions(data);
    expect(positions).toHaveLength(1);
    expect(positions[0].key).toBe('VWRP');
    expect(positions[0].value).toBe(8000);
  });

  it('keeps distinct ticker-less names separate and sorts by value desc', () => {
    const data = makeData([
      provider([
        holding({ name: 'Cash A', currentValue: 100 }),
        holding({ name: 'Cash B', currentValue: 900 }),
      ]),
    ]);
    const positions = aggregatePositions(data);
    expect(positions.map(p => p.key)).toEqual(['Cash B', 'Cash A']);
  });

  it('treats missing currentValue as 0', () => {
    const data = makeData([provider([holding({ ticker: 'NEW', name: 'New buy' })])]);
    expect(aggregatePositions(data)[0].value).toBe(0);
  });
});

describe('planNewMoney', () => {
  const positions: Position[] = [
    { key: 'VWRP', label: 'All-World', value: 8000 },
    { key: 'VFEG', label: 'EM', value: 1000 },
  ];

  it('sends everything to the underweight position when the contribution fits its deficit', () => {
    // T = 9000 + 1000; targets 80/20 → VFEG deficit 2000-1000=1000, VWRP deficit 0.
    const plan = planNewMoney(positions, [
      { key: 'VWRP', targetPct: 80 },
      { key: 'VFEG', targetPct: 20 },
    ], 1000);
    expect(plan).toEqual([{ key: 'VFEG', buy: 1000 }]);
  });

  it('fills all deficits then spreads the remainder by weight', () => {
    // T = 9000 + 5000 = 14000; deficits: VFEG 2800-1000=1800, VWRP 11200-8000=3200.
    // Deficits sum to exactly the contribution → both fully filled.
    const plan = planNewMoney(positions, [
      { key: 'VWRP', targetPct: 80 },
      { key: 'VFEG', targetPct: 20 },
    ], 5000);
    const byKey = Object.fromEntries(plan.map(r => [r.key, r.buy]));
    expect(byKey['VFEG']).toBeCloseTo(1800, 2);
    expect(byKey['VWRP']).toBeCloseTo(3200, 2);
  });

  it('normalises target weights: 32/8 behaves like 80/20', () => {
    const a = planNewMoney(positions, [{ key: 'VWRP', targetPct: 80 }, { key: 'VFEG', targetPct: 20 }], 3000);
    const b = planNewMoney(positions, [{ key: 'VWRP', targetPct: 32 }, { key: 'VFEG', targetPct: 8 }], 3000);
    expect(a).toEqual(b);
  });

  it('buys sum exactly to the contribution after rounding', () => {
    const plan = planNewMoney(positions, [
      { key: 'VWRP', targetPct: 33.33 },
      { key: 'VFEG', targetPct: 33.33 },
      { key: 'BRK', targetPct: 33.34 },
    ], 1000);
    const sum = plan.reduce((s, r) => s + r.buy, 0);
    expect(Math.round(sum * 100) / 100).toBe(1000);
  });

  it('targets for unheld positions count as value 0', () => {
    const plan = planNewMoney(positions, [{ key: 'GOLD', targetPct: 100 }], 500);
    expect(plan).toEqual([{ key: 'GOLD', buy: 500 }]);
  });

  it('returns [] for zero/negative contributions or no targets', () => {
    expect(planNewMoney(positions, [], 1000)).toEqual([]);
    expect(planNewMoney(positions, [{ key: 'VWRP', targetPct: 100 }], 0)).toEqual([]);
    expect(planNewMoney(positions, [{ key: 'VWRP', targetPct: 100 }], -5)).toEqual([]);
  });
});
