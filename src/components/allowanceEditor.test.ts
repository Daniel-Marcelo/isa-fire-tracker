import { describe, expect, it } from 'vitest';
import { defaultData, setTaxYearContribution } from '../store';
import { initialAllowanceEditor } from './AllowanceScreen';

describe('initialAllowanceEditor', () => {
  it('prefills every stored year so a save does not wipe a previous year', () => {
    const contributions = [
      { taxYear: 2024, amount: 8000 },
      { taxYear: 2026, amount: 5000 },
    ];
    const { years, amounts } = initialAllowanceEditor(contributions, 2026);

    expect(years).toEqual([2024, 2026]);
    expect(amounts).toEqual({ 2024: '8000', 2026: '5000' });

    let data = { ...defaultData, contributions };
    for (const y of years) {
      const raw = Number(amounts[y]);
      const amount = Number.isFinite(raw) ? Math.max(0, raw) : 0;
      data = setTaxYearContribution(data, y, amount);
    }

    expect(data.contributions).toEqual(contributions);
  });

  it('includes the current tax year when nothing has been saved for it', () => {
    const { years, amounts } = initialAllowanceEditor([{ taxYear: 2024, amount: 1000 }], 2026);
    expect(years).toEqual([2024, 2026]);
    expect(amounts[2026]).toBe('');
  });
});
