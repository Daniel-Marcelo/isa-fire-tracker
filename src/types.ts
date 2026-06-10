export interface Holding {
  id: string;
  name: string;
  ticker?: string;
  units?: number;
  currentPrice?: number;
  currentValue: number;
  costBasis?: number;
}

export type AccountType = 'ISA' | 'SIPP' | 'GIA' | 'Workplace Pension' | 'Other';

export interface Provider {
  id: string;
  name: string;
  owner?: string;
  accountType?: AccountType;
  color: string;
  holdings: Holding[];
  snapshots: Snapshot[];
}

export interface Snapshot {
  date: string; // ISO date string
  totalValue: number;
}

export interface FireSettings {
  currentAge: number;
  targetRetirementAge: number;
  currentSavings: number;
  monthlyContribution: number;
  monthlyPensionContribution: number;
  pensionAccessAge: number;
  expectedAnnualReturn: number;
  inflationRate: number;
  annualExpensesInRetirement: number;
  withdrawalRate: number;
}

export interface AppData {
  providers: Provider[];
  taxYear: number; // e.g. 2025 means tax year 2025/26
  contributions: TaxYearContribution[];
  fireSettings: FireSettings;
}

export interface TaxYearContribution {
  taxYear: number;
  amount: number;
}
