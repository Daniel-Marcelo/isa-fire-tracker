export interface ParsedHolding {
  ticker: string;
  name: string;
  units: number;
  costBasis: number; // total invested in user's preferred currency (net of sells)
}

export interface BrokerParser {
  id: string;
  label: string;
  parse: (csv: string, currency: string) => ParsedHolding[];
}

// ---------------------------------------------------------------------------
// Trading 212
// ---------------------------------------------------------------------------

function parseTrading212(csv: string, currency: string): ParsedHolding[] {
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

  const col = (name: string) => header.indexOf(name);
  const iAction = col('Action');
  const iTicker = col('Ticker');
  const iName = col('Name');
  const iShares = col('No. of shares');
  const iPrice = col('Price / share');
  const iPriceCurrency = col('Currency (Price / share)');
  const iExchangeRate = col('Exchange rate');
  const iTotal = col('Total');
  const iTotalCurrency = col('Currency (Total)');

  type Entry = { units: number; costBasis: number };
  const map = new Map<string, Entry & { name: string }>();

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (!row || row.length < 4) continue;

    const action = row[iAction]?.trim();
    const ticker = row[iTicker]?.trim();
    const name = row[iName]?.replace(/^"|"$/g, '').trim() ?? ticker;
    const shares = parseFloat(row[iShares]) || 0;

    // Resolve cost in the user's preferred currency.
    // The CSV gives us two options: Total (account base currency) or Price/share (instrument currency).
    // We pick whichever column already matches; if neither does, fall back to Total and convert
    // using the exchange rate (Total = Price * shares / exchangeRate, so Price * shares = Total * exchangeRate).
    const totalCurrency = row[iTotalCurrency]?.trim();
    const priceCurrency = row[iPriceCurrency]?.trim();
    const rawTotal = Math.abs(parseFloat(row[iTotal]) || 0);
    const rawPrice = parseFloat(row[iPrice]) || 0;
    const exchangeRate = parseFloat(row[iExchangeRate]) || 1;

    let total: number;
    if (totalCurrency === currency) {
      total = rawTotal;
    } else if (priceCurrency === currency) {
      total = Math.abs(rawPrice * shares);
    } else {
      // Convert from account base currency to preferred currency via exchange rate.
      // exchangeRate = priceCurrency per totalCurrency (e.g. USD per GBP).
      total = rawTotal * exchangeRate;
    }

    if (!ticker || !action) continue;

    if (!map.has(ticker)) map.set(ticker, { units: 0, costBasis: 0, name });

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

  return Array.from(map.entries())
    .filter(([, e]) => e.units > 0.000001)
    .map(([ticker, e]) => ({
      ticker,
      name: e.name,
      units: parseFloat(e.units.toFixed(8)),
      costBasis: parseFloat(e.costBasis.toFixed(2)),
    }));
}

// ---------------------------------------------------------------------------
// Freetrade (basic export format)
// ---------------------------------------------------------------------------

function parseFreetrade(csv: string, _currency: string): ParsedHolding[] {
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

  const col = (name: string) => header.indexOf(name);
  const iType = col('Type');
  const iTicker = col('Symbol');
  const iName = col('Title');
  const iShares = col('Quantity');
  const iTotal = col('Total Amount');

  type Entry = { units: number; costBasis: number; name: string };
  const map = new Map<string, Entry>();

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (!row || row.length < 3) continue;

    const type = row[iType]?.trim().toLowerCase();
    const ticker = row[iTicker]?.trim();
    const name = row[iName]?.replace(/^"|"$/g, '').trim() ?? ticker;
    const shares = parseFloat(row[iShares]) || 0;
    const total = Math.abs(parseFloat(row[iTotal]) || 0);

    if (!ticker || !type) continue;
    if (!map.has(ticker)) map.set(ticker, { units: 0, costBasis: 0, name });
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

  return Array.from(map.entries())
    .filter(([, e]) => e.units > 0.000001)
    .map(([ticker, e]) => ({
      ticker,
      name: e.name,
      units: parseFloat(e.units.toFixed(8)),
      costBasis: parseFloat(e.costBasis.toFixed(2)),
    }));
}

// ---------------------------------------------------------------------------
// Hargreaves Lansdown (transaction history export)
// ---------------------------------------------------------------------------

function parseHL(csv: string, _currency: string): ParsedHolding[] {
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

  type Entry = { units: number; costBasis: number; name: string };
  const map = new Map<string, Entry>();

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const row = parseCSVRow(lines[i]);
    if (!row || row.length < 3) continue;

    const desc = row[iDesc]?.replace(/^"|"$/g, '').trim() ?? '';
    const type = row[iType]?.trim().toLowerCase() ?? '';
    const qty = Math.abs(parseFloat(row[iQty]?.replace(/,/g, '')) || 0);
    const value = Math.abs(parseFloat(row[iValue]?.replace(/[£,]/g, '')) || 0);

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

  return Array.from(map.entries())
    .filter(([, e]) => e.units > 0.000001)
    .map(([ticker, e]) => ({
      ticker,
      name: e.name,
      units: parseFloat(e.units.toFixed(8)),
      costBasis: parseFloat(e.costBasis.toFixed(2)),
    }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCSVRow(line: string): string[] {
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
