export interface Holding {
  id: string;
  name: string;
  ticker?: string;
  units?: number;
  currentPrice?: number;
  currentValue: number;
  costBasis?: number;
  currency?: string; // ISO 4217 code for the price/value denomination, default 'GBP'
}

export type AccountType = 'ISA' | 'SIPP' | 'GIA' | 'Workplace Pension';

export interface Provider {
  id: string;
  name: string;
  owner?: string;
  accountType?: AccountType;
  color: string;
  holdings: Holding[];
  snapshots: Snapshot[];
  lastCsvImport?: string; // ISO datetime of most recent CSV import
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

export interface UserSettings {
  currency: string; // ISO 4217 currency code, e.g. 'GBP', 'USD', 'EUR'
}

export interface AppData {
  providers: Provider[];
  taxYear: number; // e.g. 2025 means tax year 2025/26
  contributions: TaxYearContribution[];
  fireSettings: FireSettings;
  userSettings: UserSettings;
}

export interface TaxYearContribution {
  taxYear: number;
  amount: number;
}

export interface FundHolding {
  ticker: string;
  name: string;
  weight: number; // % of fund NAV
  country: string;
  sector: string;
}

export interface UploadedFundHoldings {
  fundTicker: string;  // e.g. 'VFEG'
  fundName: string;
  asAt: string;        // e.g. "30 Apr 2026"
  uploadedAt: string;  // ISO datetime
  holdings: FundHolding[];
}
