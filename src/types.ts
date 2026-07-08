export interface Holding {
  id: string;
  name: string;
  ticker?: string;
  units?: number;
  costBasis?: number;       // total cost in native currency (stored)
  manualValue?: number;     // current value in native currency, for ticker-less holdings (stored)
  currency?: string;        // native currency ISO 4217, default 'GBP' (stored)
  // Runtime-derived — not persisted to Supabase:
  currentPrice?: number;
  currentValue?: number;
}

export type AccountType = 'ISA' | 'SIPP' | 'GIA' | 'Workplace Pension' | 'Cash ISA' | 'Savings';

export interface Provider {
  id: string;
  name: string;
  owner?: string;
  accountType?: AccountType;
  color: string;
  holdings: Holding[];
  snapshots: Snapshot[];
  dividends?: DividendRecord[]; // from CSV imports; absent on pre-feature data
  lastCsvImport?: string; // ISO datetime of most recent CSV import
}

export interface Snapshot {
  date: string; // ISO date string
  totalValue: number;
}

export interface DividendRecord {
  id: string;       // dedupe key — broker tx id if present, else date|ticker|amount
  date: string;     // ISO date YYYY-MM-DD
  ticker: string;
  name?: string;
  amount: number;   // net cash received, in `currency`
  currency: string; // ISO 4217
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
  returnVolatility?: number; // annual return std dev in %, for Monte Carlo (default 15)
}

export interface UserSettings {
  currency: string; // ISO 4217 currency code, e.g. 'GBP', 'USD', 'EUR'
}

export interface AllocationTarget {
  key: string;       // uppercase ticker, or exact holding name for ticker-less positions
  targetPct: number; // 0..100; treated as a weight if the sum isn't 100
}

export interface AppData {
  providers: Provider[];
  taxYear: number; // e.g. 2025 means tax year 2025/26
  contributions: TaxYearContribution[];
  fireSettings: FireSettings;
  userSettings: UserSettings;
  targets: AllocationTarget[];
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
