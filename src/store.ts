import type { AppData, FireSettings, UserSettings } from './types';

const currentTaxYear = (): number => {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
};

const defaultFireSettings: FireSettings = {
  currentAge: 30,
  targetRetirementAge: 55,
  currentSavings: 0,
  monthlyContribution: 1000,
  monthlyPensionContribution: 0,
  pensionAccessAge: 57,
  expectedAnnualReturn: 7,
  inflationRate: 3,
  annualExpensesInRetirement: 25000,
  withdrawalRate: 3.5,
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
};

export function exportData(data: AppData): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
        resolve({
          ...defaultData,
          ...parsed,
          fireSettings: { ...defaultData.fireSettings, ...parsed.fireSettings },
          userSettings: { ...defaultData.userSettings, ...parsed.userSettings },
        });
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

export { currentTaxYear };
