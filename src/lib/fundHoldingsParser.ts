import * as XLSX from 'xlsx';
import type { FundHolding, UploadedFundHoldings } from '../types';

const SECTOR_MAP: Record<string, string> = {
  'Consumer Discretionary': 'Consumer',
  'Consumer Staples': 'Consumer',
  'Basic Materials': 'Materials',
  'Telecommunications': 'Telecom',
  'Communication Services': 'Telecom',
  'Health Care': 'Healthcare',
  'Information Technology': 'Technology',
  'Real Estate': 'Real Estate',
  'Utilities': 'Utilities',
};

function normaliseSector(raw: string): string {
  return SECTOR_MAP[raw] ?? raw;
}

// Detect fund ticker from the Vanguard fund name in the file
const FUND_NAME_MAP: Array<{ pattern: RegExp; ticker: string }> = [
  { pattern: /emerging markets/i, ticker: 'VFEG' },
  { pattern: /ftse all.?world/i, ticker: 'VWRL' },
  { pattern: /developed world/i, ticker: 'VHVG' },
  { pattern: /s&p 500/i, ticker: 'VUAA' },
  { pattern: /ftse 100/i, ticker: 'VUKE' },
  { pattern: /europe/i, ticker: 'VEUR' },
  { pattern: /japan/i, ticker: 'VJPN' },
  { pattern: /us equity/i, ticker: 'VUSA' },
];

function detectFundTicker(fundName: string): string {
  for (const { pattern, ticker } of FUND_NAME_MAP) {
    if (pattern.test(fundName)) return ticker;
  }
  return '';
}

export interface ParseResult {
  fundTicker: string;
  fundName: string;
  asAt: string;
  holdings: FundHolding[];
  totalHoldings: number;
}

export function parseVanguardHoldingsXlsx(file: File): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as string[][];

        // Find the header row (contains "Ticker" or "Holding name")
        let headerRow = -1;
        let fundName = '';
        let asAt = '';

        for (let i = 0; i < Math.min(rows.length, 20); i++) {
          const row = rows[i];
          const joined = row.join(' ').toLowerCase();
          if (joined.includes('ticker') && joined.includes('holding')) {
            headerRow = i;
          }
          // Row 3 (0-indexed) typically has the fund name, row 4 has "As at ..."
          if (row[0] && /vanguard/i.test(String(row[0]))) fundName = String(row[0]);
          if (row[0] && /^as at/i.test(String(row[0]))) asAt = String(row[0]).replace(/^as at\s*/i, '').trim();
        }

        if (headerRow === -1) {
          reject(new Error('Could not find header row. Please ensure this is a Vanguard holdings Excel file.'));
          return;
        }

        const headers = rows[headerRow].map(h => String(h).toLowerCase().trim());
        const colTicker = headers.findIndex(h => h === 'ticker');
        const colName = headers.findIndex(h => h.includes('holding name') || h === 'name');
        const colWeight = headers.findIndex(h => h.includes('% of market') || h.includes('weight') || h.includes('%'));
        const colSector = headers.findIndex(h => h === 'sector');
        const colRegion = headers.findIndex(h => h === 'region' || h === 'country');

        if (colTicker === -1 || colName === -1 || colWeight === -1) {
          reject(new Error('Missing expected columns (Ticker, Holding name, % of market value).'));
          return;
        }

        const raw: FundHolding[] = [];

        for (let i = headerRow + 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row[colTicker] && !row[colName]) continue;

          const ticker = String(row[colTicker] ?? '').trim();
          const name = String(row[colName] ?? '').trim();
          if (!name) continue;

          const weightStr = String(row[colWeight] ?? '').replace('%', '').trim();
          const weight = parseFloat(weightStr);
          if (isNaN(weight) || weight <= 0) continue;

          const country = colRegion !== -1 ? String(row[colRegion] ?? '').trim() : '';
          const sector = colSector !== -1 ? normaliseSector(String(row[colSector] ?? '').trim()) : 'Other';

          raw.push({ ticker, name, weight, country, sector });
        }

        raw.sort((a, b) => b.weight - a.weight);
        const detectedTicker = detectFundTicker(fundName);
        resolve({ fundTicker: detectedTicker, fundName, asAt, holdings: raw, totalHoldings: raw.length });
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsArrayBuffer(file);
  });
}

export function buildUploadedFundHoldings(
  result: ParseResult,
  fundTicker: string,
): UploadedFundHoldings {
  return {
    fundTicker: fundTicker.toUpperCase(),
    fundName: result.fundName,
    asAt: result.asAt,
    uploadedAt: new Date().toISOString(),
    holdings: result.holdings,
  };
}
