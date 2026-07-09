import type { DividendRecord } from '../types';

export interface ParsedHolding {
  ticker: string;
  name: string;
  units: number;
  costBasis: number; // total invested, in `currency` below
  currency: string;  // currency costBasis (and the instrument) is expressed in
}

export interface ParsedImport {
  holdings: ParsedHolding[];
  dividends: DividendRecord[];
}

export interface BrokerParser {
  id: string;
  label: string;
  parse: (csv: string, currency: string) => ParsedImport;
}

// ---------------------------------------------------------------------------
// Trading 212
// ---------------------------------------------------------------------------

function parseTrading212(csv: string, currency: string): ParsedImport {
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

  const col = (name: string) => header.indexOf(name);
  const iAction = col('Action');
  const iTime = col('Time');
  const iTicker = col('Ticker');
  const iName = col('Name');
  const iShares = col('No. of shares');
  const iPrice = col('Price / share');
  const iPriceCurrency = col('Currency (Price / share)');
  const iExchangeRate = col('Exchange rate');
  const iTotal = col('Total');
  const iTotalCurrency = col('Currency (Total)');
  const iId = col('ID');

  type Entry = { units: number; costBasis: number; currency: string };
  const map = new Map<string, Entry & { name: string }>();
  const dividends: DividendRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (!row || row.length < 4) continue;

    const action = row[iAction]?.trim();
    const ticker = row[iTicker]?.trim();
    const name = row[iName]?.replace(/^"|"$/g, '').trim() ?? ticker;
    const shares = parseFloat(row[iShares]) || 0;

    // Resolve cost basis in the *instrument's own* currency (Currency (Price / share)),
    // not the user's preferred display currency — the holding's stored currency and its
    // costBasis must agree, or a later currency switch double-converts (see plan).
    const totalCurrency = row[iTotalCurrency]?.trim();
    const priceCurrency = row[iPriceCurrency]?.trim();
    const rawTotal = Math.abs(parseFloat(row[iTotal]) || 0);
    const rawPrice = parseFloat(row[iPrice]) || 0;
    const exchangeRate = parseFloat(row[iExchangeRate]) || 1;

    let total: number;
    let rowCurrency: string;
    if (rawPrice > 0) {
      // Price/share is populated: native cost is price x shares, already in priceCurrency.
      total = Math.abs(rawPrice * shares);
      rowCurrency = priceCurrency || currency;
    } else if (totalCurrency === currency) {
      // No price data (e.g. some corporate-action rows); fall back to whichever total
      // column we can trust, and tag the row with the currency that total is actually in.
      total = rawTotal;
      rowCurrency = totalCurrency;
    } else if (priceCurrency === currency) {
      total = Math.abs(rawPrice * shares);
      rowCurrency = priceCurrency;
    } else {
      // Convert from account base currency to instrument currency via exchange rate.
      // exchangeRate = priceCurrency per totalCurrency (e.g. USD per GBP), so
      // Total * exchangeRate lands in priceCurrency.
      total = rawTotal * exchangeRate;
      rowCurrency = priceCurrency || totalCurrency || currency;
    }

    if (!ticker || !action) continue;

    // Dividend rows: Action starts with "Dividend" — e.g. "Dividend (Ordinary)",
    // "Dividend (Dividends paid by us corporations)". Total is the net cash
    // credited (after withholding) in Currency (Total).
    if (/^dividend/i.test(action)) {
      // Slice the date out of "YYYY-MM-DD HH:MM:SS" rather than Date-parsing it —
      // timezone shifts could move a payment across a year boundary.
      const date = (iTime !== -1 ? row[iTime]?.trim().slice(0, 10) : '') ?? '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && rawTotal > 0) {
        const brokerId = iId !== -1 ? row[iId]?.trim() : '';
        dividends.push({
          id: brokerId || `${date}|${ticker}|${rawTotal.toFixed(2)}`,
          date,
          ticker,
          name,
          amount: rawTotal,
          currency: totalCurrency || 'GBP',
        });
      }
      continue;
    }

    if (!map.has(ticker)) map.set(ticker, { units: 0, costBasis: 0, name, currency: rowCurrency });

    const entry = map.get(ticker)!;

    if (action === 'Market buy') {
      entry.units += shares;
      entry.costBasis += total;
    } else if (action === 'Market sell') {
      // Reduce cost basis proportionally
      const soldFraction = entry.units > 0 ? shares / entry.units : 0;
      entry.costBasis = Math.max(0, entry.costBasis * (1 - soldFraction));
      entry.units = Math.max(0, entry.units - shares);
    } else if (action === 'Stock split close') {
      // Remove old share count; cost basis stays (reopened at new count)
      entry.units = Math.max(0, entry.units - shares);
    } else if (action === 'Stock split open') {
      entry.units += shares;
    }
  }

  return {
    holdings: Array.from(map.entries())
      .filter(([, e]) => e.units > 0.000001)
      .map(([ticker, e]) => ({
        ticker,
        name: e.name,
        units: parseFloat(e.units.toFixed(8)),
        costBasis: parseFloat(e.costBasis.toFixed(2)),
        currency: e.currency,
      })),
    dividends,
  };
}

// ---------------------------------------------------------------------------
// Freetrade (basic export format)
// ---------------------------------------------------------------------------

function parseFreetrade(csv: string, currency: string): ParsedImport {
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

  const col = (name: string) => header.indexOf(name);
  const iType = col('Type');
  const iTicker = col('Symbol');
  const iName = col('Title');
  const iShares = col('Quantity');
  const iTotal = col('Total Amount');
  const iTimestamp = col('Timestamp');
  const iAccountCurrency = col('Account Currency');

  type Entry = { units: number; costBasis: number; name: string; currency: string };
  const map = new Map<string, Entry>();
  const dividends: DividendRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (!row || row.length < 3) continue;

    const type = row[iType]?.trim().toLowerCase();
    const ticker = row[iTicker]?.trim();
    const name = row[iName]?.replace(/^"|"$/g, '').trim() ?? ticker;
    const shares = parseFloat(row[iShares]) || 0;
    const total = Math.abs(parseFloat(row[iTotal]) || 0);
    // Freetrade exports only give account-currency totals, no reliable per-instrument
    // currency — tag holdings with the account currency (falling back to the display
    // currency param); the feed-currency decoupling in applyLivePrices is what makes
    // live *values* correct despite this.
    const accountCurrency = (iAccountCurrency !== -1 ? row[iAccountCurrency]?.trim() : '') || currency;

    if (!ticker || !type) continue;

    if (type === 'dividend') {
      const ts = (iTimestamp !== -1 ? row[iTimestamp]?.trim() : '') ?? '';
      const date = ts.slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && total > 0) {
        dividends.push({
          id: `${date}|${ticker}|${total.toFixed(2)}`,
          date,
          ticker,
          name,
          amount: total,
          currency: accountCurrency || 'GBP',
        });
      }
      continue;
    }

    if (!map.has(ticker)) map.set(ticker, { units: 0, costBasis: 0, name, currency: accountCurrency });
    const entry = map.get(ticker)!;

    if (type === 'buy') {
      entry.units += shares;
      entry.costBasis += total;
    } else if (type === 'sell') {
      const soldFraction = entry.units > 0 ? shares / entry.units : 0;
      entry.costBasis = Math.max(0, entry.costBasis * (1 - soldFraction));
      entry.units = Math.max(0, entry.units - shares);
    }
  }

  return {
    holdings: Array.from(map.entries())
      .filter(([, e]) => e.units > 0.000001)
      .map(([ticker, e]) => ({
        ticker,
        name: e.name,
        units: parseFloat(e.units.toFixed(8)),
        costBasis: parseFloat(e.costBasis.toFixed(2)),
        currency: e.currency,
      })),
    dividends,
  };
}

// ---------------------------------------------------------------------------
// Hargreaves Lansdown (transaction history export)
// ---------------------------------------------------------------------------

function parseHL(csv: string, _currency: string): ParsedImport {
  const lines = csv.trim().split('\n');
  // HL includes some header rows before the actual CSV header; find it
  let headerIdx = lines.findIndex(l => l.toLowerCase().includes('stock description') || l.toLowerCase().includes('sedol'));
  if (headerIdx === -1) headerIdx = 0;

  const header = lines[headerIdx].split(',').map(h => h.replace(/"/g, '').trim());
  const col = (name: string) => header.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));

  const iDesc = col('description');
  const iType = col('type') !== -1 ? col('type') : col('trade type');
  const iQty = col('quantity') !== -1 ? col('quantity') : col('units');
  const iValue = col('net amount') !== -1 ? col('net amount') : col('value');
  const iDate = col('date');

  type Entry = { units: number; costBasis: number; name: string };
  const map = new Map<string, Entry>();
  const dividends: DividendRecord[] = [];
  // HL transaction exports don't carry a reliable per-instrument currency; the
  // account (and this parser) is always GBP.
  const HL_CURRENCY = 'GBP';

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (!row || row.length < 3) continue;

    const desc = row[iDesc]?.replace(/^"|"$/g, '').trim() ?? '';
    const type = row[iType]?.trim().toLowerCase() ?? '';
    const qty = Math.abs(parseFloat(row[iQty]?.replace(/,/g, '')) || 0);
    const value = Math.abs(parseFloat(row[iValue]?.replace(/[£,]/g, '')) || 0);

    // Dividend/income rows come before the qty guard: HL leaves quantity blank
    // for income lines. HL has no reliable type flag across account types, so
    // match defensively; worst case a file yields no dividends.
    if (desc && value > 0 && (type.includes('div') || /dividend/i.test(desc))) {
      const m = (iDate !== -1 ? row[iDate]?.trim() ?? '' : '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) {
        const date = `${m[3]}-${m[2]}-${m[1]}`; // DD/MM/YYYY → ISO
        dividends.push({
          id: `${date}|${desc}|${value.toFixed(2)}`,
          date,
          ticker: desc, // HL transaction exports key by description, not ticker
          name: desc,
          amount: value,
          currency: 'GBP',
        });
      }
      continue;
    }

    if (!desc || qty === 0) continue;
    // Use description as key (HL doesn't always include ticker in transaction export)
    const key = desc;
    if (!map.has(key)) map.set(key, { units: 0, costBasis: 0, name: desc });
    const entry = map.get(key)!;

    if (type.includes('buy') || type.includes('purchase')) {
      entry.units += qty;
      entry.costBasis += value;
    } else if (type.includes('sell')) {
      const soldFraction = entry.units > 0 ? qty / entry.units : 0;
      entry.costBasis = Math.max(0, entry.costBasis * (1 - soldFraction));
      entry.units = Math.max(0, entry.units - qty);
    }
  }

  return {
    holdings: Array.from(map.entries())
      .filter(([, e]) => e.units > 0.000001)
      .map(([ticker, e]) => ({
        ticker,
        name: e.name,
        units: parseFloat(e.units.toFixed(8)),
        costBasis: parseFloat(e.costBasis.toFixed(2)),
        currency: HL_CURRENCY,
      })),
    dividends,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCSVRow(rawLine: string): string[] {
  // Windows/CRLF broker exports (e.g. Trading 212) leave a trailing \r on the last
  // column of every row when the file is split on '\n' alone. Strip it here so it
  // never corrupts the last column (Currency (Total) / ID).
  const line = rawLine.replace(/\r$/, '');
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const BROKER_PARSERS: BrokerParser[] = [
  { id: 'trading212', label: 'Trading 212', parse: parseTrading212 },
  { id: 'freetrade', label: 'Freetrade', parse: parseFreetrade },
  { id: 'hl', label: 'Hargreaves Lansdown', parse: parseHL },
];
