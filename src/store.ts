import type { AppData, FireSettings, Holding, UserSettings } from './types';

const currentTaxYear = (): number => {
  const now = new Date();
  const y = now.getFullYear();
  // UK tax year starts 6 April. Jan 1 – Apr 5 belongs to the previous year's tax year.
  return now.getMonth() > 3 || (now.getMonth() === 3 && now.getDate() >= 6) ? y : y - 1;
};

const defaultFireSettings: FireSettings = {
  currentAge: 30,
  targetRetirementAge: 55,
  monthlyContribution: 1000,
  monthlyPensionContribution: 0,
  pensionAccessAge: 57,
  expectedAnnualReturn: 7,
  inflationRate: 3,
  annualExpensesInRetirement: 25000,
  withdrawalRate: 3.5,
  returnVolatility: 15,
  fireMode: 'earliest',
  targetConfidence: 90,
  planToAge: 95,
  statePensionEnabled: true,
  statePensionAnnual: 12000,
  statePensionAge: 67,
  pensionTaxRate: 15,
};

const defaultUserSettings: UserSettings = {
  currency: 'GBP',
};

export const defaultData: AppData = {
  providers: [],
  taxYear: currentTaxYear(),
  contributions: [],
  fireSettings: defaultFireSettings,
  userSettings: defaultUserSettings,
  targets: [],
};

/** Drop runtime-derived fields so they are never persisted or exported. */
export function stripDerived(holding: Holding): Holding {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { currentPrice, currentValue, ...stored } = holding;
  return stored as Holding;
}

/** Normalise possibly-old AppData: legacy stored currentValue becomes manualValue; derived fields removed. */
export function migrateAppData(parsed: AppData): AppData {
  return {
    ...defaultData,
    ...parsed,
    fireSettings: { ...defaultData.fireSettings, ...parsed.fireSettings },
    userSettings: { ...defaultData.userSettings, ...parsed.userSettings },
    contributions: parsed.contributions ?? [],
    targets: parsed.targets ?? [],
    providers: (parsed.providers ?? []).map(p => ({
      ...p,
      snapshots: p.snapshots ?? [],
      dividends: p.dividends ?? [],
      holdings: (p.holdings ?? []).map(h => {
        const migrated = h.manualValue == null && h.currentValue != null
          ? { ...h, manualValue: h.currentValue }
          : h;
        return stripDerived(migrated);
      }),
    })),
  };
}

export function exportData(data: AppData): void {
  const cleaned: AppData = {
    ...data,
    providers: data.providers.map(p => ({
      ...p,
      holdings: p.holdings.map(stripDerived),
    })),
  };
  const blob = new Blob([JSON.stringify(cleaned, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `isa-fire-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importData(file: File): Promise<AppData> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target!.result as string);
        resolve(migrateAppData(parsed));
      } catch {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function getCurrentTaxYearContribution(data: AppData): number {
  const ty = currentTaxYear();
  return data.contributions.find(c => c.taxYear === ty)?.amount ?? 0;
}

export function setTaxYearContribution(data: AppData, taxYear: number, amount: number): AppData {
  const others = data.contributions.filter(c => c.taxYear !== taxYear);
  const contributions = amount > 0
    ? [...others, { taxYear, amount }].sort((a, b) => a.taxYear - b.taxYear)
    : others; // zero/cleared entries are removed, not stored
  return { ...data, contributions };
}

export { currentTaxYear };
