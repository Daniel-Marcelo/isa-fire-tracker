import { describe, it, expect } from 'vitest';
import { BROKER_PARSERS } from './csvParsers';

const t212 = BROKER_PARSERS.find(p => p.id === 'trading212')!.parse;
const freetrade = BROKER_PARSERS.find(p => p.id === 'freetrade')!.parse;
const hl = BROKER_PARSERS.find(p => p.id === 'hl')!.parse;

const T212_HEADER = 'Action,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Total,Currency (Total)';

describe('parseTrading212', () => {
  it('aggregates units and costBasis across two buys of the same ticker', () => {
    const csv = [
      T212_HEADER,
      'Market buy,AAPL,Apple,5,100,GBP,1,500,GBP',
      'Market buy,AAPL,Apple,5,100,GBP,1,500,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP').holdings;
    expect(result).toHaveLength(1);
    expect(result[0].units).toBeCloseTo(10, 8);
    expect(result[0].costBasis).toBeCloseTo(1000, 2);
    expect(result[0].currency).toBe('GBP');
  });

  it('captures the instrument currency (Currency (Price / share)) on the holding for a non-GBP ticker', () => {
    const csv = [
      T212_HEADER,
      'Market buy,AAPL,Apple,10,230,USD,1,1725,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP').holdings;
    expect(result).toHaveLength(1);
    expect(result[0].currency).toBe('USD');
    expect(result[0].costBasis).toBeCloseTo(2300, 2); // 230 x 10, in USD — not the Total column's 1725 GBP
  });

  it('reduces costBasis proportionally on sell, and treats negative Total values as absolute (sign-safety)', () => {
    const csv = [
      T212_HEADER,
      'Market buy,AAPL,Apple,10,10,GBP,1,-100,GBP',
      'Market sell,AAPL,Apple,5,10,GBP,1,-50,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP').holdings;
    expect(result).toHaveLength(1);
    expect(result[0].costBasis).toBeCloseTo(50, 2);
    expect(result[0].units).toBeCloseTo(5, 8);
  });

  it('clamps units and costBasis at 0 when a sell exceeds the held amount, rather than going negative', () => {
    const csv = [
      T212_HEADER,
      'Market buy,AAPL,Apple,5,100,GBP,1,500,GBP',
      'Market sell,AAPL,Apple,10,100,GBP,1,1000,GBP',
      'Market buy,AAPL,Apple,2,100,GBP,1,200,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP').holdings;
    expect(result).toHaveLength(1);
    // Without clamping this would be units -3 / costBasis -300.
    expect(result[0].units).toBeCloseTo(2, 8);
    expect(result[0].costBasis).toBeCloseTo(200, 2);
  });

  it('handles Stock split close then Stock split open: units change, costBasis preserved', () => {
    const csv = [
      T212_HEADER,
      'Market buy,TSLA,Tesla,10,50,GBP,1,500,GBP',
      'Stock split close,TSLA,Tesla,10,0,GBP,1,0,GBP',
      'Stock split open,TSLA,Tesla,30,0,GBP,1,0,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP').holdings;
    expect(result).toHaveLength(1);
    expect(result[0].units).toBeCloseTo(30, 8);
    expect(result[0].costBasis).toBeCloseTo(500, 2);
  });

  it('parses a quoted field containing a comma as a single field', () => {
    const csv = [
      T212_HEADER,
      'Market buy,GOOG,"Alphabet, Inc.",1,100,GBP,1,100,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP').holdings;
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alphabet, Inc.');
  });

  it('uses Price/share x shares (in the instrument currency) as cost whenever a price is present', () => {
    const csv = [
      T212_HEADER,
      'Market buy,X,X,1,999,USD,1,100,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP').holdings;
    // Price is populated (999), so cost = 999 x 1 share, tagged USD — not the
    // Total column's 100 GBP. Cost and currency must travel together.
    expect(result[0].costBasis).toBeCloseTo(999, 2);
    expect(result[0].currency).toBe('USD');
  });

  it('uses price x shares when Currency (Price / share) matches user currency', () => {
    const csv = [
      T212_HEADER,
      'Market buy,Y,Y,2,50,USD,1,999,GBP',
    ].join('\n');
    const result = t212(csv, 'USD').holdings;
    expect(result[0].costBasis).toBeCloseTo(100, 2);
    expect(result[0].currency).toBe('USD');
  });

  it('currency resolution fallback: no price data, neither Total nor Price currency matches, so Total x exchange rate is used', () => {
    const csv = [
      T212_HEADER,
      'Market buy,Z,Z,1,0,EUR,1.25,80,GBP',
    ].join('\n');
    const result = t212(csv, 'USD').holdings;
    expect(result[0].costBasis).toBeCloseTo(100, 2);
    expect(result[0].currency).toBe('EUR');
  });

  it('currency resolution fallback: no price data, Total currency matches user currency', () => {
    const csv = [
      T212_HEADER,
      'Market buy,X2,X2,1,0,USD,1,100,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP').holdings;
    expect(result[0].costBasis).toBeCloseTo(100, 2);
    expect(result[0].currency).toBe('GBP');
  });

  it('excludes holdings with zero remaining units from the output', () => {
    const csv = [
      T212_HEADER,
      'Market buy,W,W,4,25,GBP,1,100,GBP',
      'Market sell,W,W,4,25,GBP,1,100,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP').holdings;
    expect(result.find(h => h.ticker === 'W')).toBeUndefined();
  });

  it('strips a trailing CRLF carriage return so the last column (Currency (Total)) is a clean ISO code', () => {
    const csv = [
      T212_DIV_HEADER,
      'Market buy,2025-01-02 10:00:00,tx1,AAPL,Apple,5,100,GBP,1,500,GBP',
      'Dividend (Ordinary),2025-03-10 14:30:00,tx2,AAPL,Apple,5,0.24,USD,1.27,0.95,GBP',
    ].join('\r\n') + '\r\n';
    const result = t212(csv, 'GBP');
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].currency).toBe('GBP');
    expect(result.dividends).toHaveLength(1);
    expect(result.dividends[0].currency).toBe('GBP');
    expect(result.dividends[0].currency.endsWith('\r')).toBe(false);
  });
});

describe('parseFreetrade', () => {
  it('parses buy/sell using Type,Symbol,Title,Quantity,Total Amount headers', () => {
    const csv = [
      'Type,Symbol,Title,Quantity,Total Amount',
      'buy,VOD,Vodafone,100,50',
      'sell,VOD,Vodafone,40,20',
    ].join('\n');
    const result = freetrade(csv, 'GBP').holdings;
    expect(result).toHaveLength(1);
    expect(result[0].units).toBeCloseTo(60, 8);
    expect(result[0].costBasis).toBeCloseTo(30, 2);
    expect(result[0].currency).toBe('GBP');
  });

  it('tags holdings with the Account Currency column when present', () => {
    const csv = [
      'Type,Symbol,Title,Quantity,Total Amount,Account Currency',
      'buy,AAPL,Apple,10,2000,USD',
    ].join('\n');
    const result = freetrade(csv, 'GBP').holdings;
    expect(result[0].currency).toBe('USD');
  });
});

describe('parseHL', () => {
  it('finds the header row when it is not on line 0, parses Purchase, and handles £ and thousands commas', () => {
    const csv = [
      'HL Transaction Export',
      'Stock Description,Type,Quantity,Net Amount',
      '"HSBC Holdings",Purchase,"1,000","£1,000.00"',
    ].join('\n');
    const result = hl(csv, 'GBP').holdings;
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('HSBC Holdings');
    expect(result[0].units).toBeCloseTo(1000, 8);
    expect(result[0].costBasis).toBeCloseTo(1000, 2);
    expect(result[0].currency).toBe('GBP');
  });
});

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

const T212_DIV_HEADER = 'Action,Time,ID,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Total,Currency (Total)';

describe('Trading 212 dividends', () => {
  it('parses dividend rows with net Total and Currency (Total), keeping buys separate', () => {
    const csv = [
      T212_DIV_HEADER,
      'Market buy,2025-01-02 10:00:00,tx1,AAPL,Apple,5,100,GBP,1,500,GBP',
      'Dividend (Ordinary),2025-03-10 14:30:00,tx2,AAPL,Apple,5,0.24,USD,1.27,0.95,GBP',
      'Dividend (Dividends paid by us corporations),2025-06-10 14:30:00,tx3,AAPL,Apple,5,0.25,USD,1.27,1.02,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP');
    expect(result.holdings).toHaveLength(1);
    expect(result.dividends).toHaveLength(2);
    expect(result.dividends[0]).toEqual({
      id: 'tx2', date: '2025-03-10', ticker: 'AAPL', name: 'Apple', amount: 0.95, currency: 'GBP',
    });
  });

  it('synthesizes a stable id when the ID column is absent', () => {
    const csv = [
      'Action,Time,Ticker,Name,No. of shares,Price / share,Currency (Price / share),Exchange rate,Total,Currency (Total)',
      'Dividend (Ordinary),2025-03-10 14:30:00,VOD,Vodafone,100,0.04,GBP,1,4.00,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP');
    expect(result.dividends).toHaveLength(1);
    expect(result.dividends[0].id).toBe('2025-03-10|VOD|4.00');
  });

  it('skips dividend rows without a parseable date and never lets them affect holdings', () => {
    const csv = [
      T212_HEADER, // no Time column at all
      'Market buy,AAPL,Apple,5,100,GBP,1,500,GBP',
      'Dividend (Ordinary),AAPL,Apple,5,0.24,USD,1.27,0.95,GBP',
    ].join('\n');
    const result = t212(csv, 'GBP');
    expect(result.dividends).toHaveLength(0);
    expect(result.holdings).toHaveLength(1);
    expect(result.holdings[0].units).toBeCloseTo(5, 8);
  });
});

describe('Freetrade dividends', () => {
  it('parses DIVIDEND rows case-insensitively with Timestamp and Account Currency', () => {
    const csv = [
      'Type,Symbol,Title,Quantity,Total Amount,Timestamp,Account Currency',
      'buy,VOD,Vodafone,100,50,2025-01-05T09:00:00Z,GBP',
      'DIVIDEND,VOD,Vodafone,,3.20,2025-04-02T00:00:00Z,GBP',
    ].join('\n');
    const result = freetrade(csv, 'GBP');
    expect(result.holdings).toHaveLength(1);
    expect(result.dividends).toEqual([
      { id: '2025-04-02|VOD|3.20', date: '2025-04-02', ticker: 'VOD', name: 'Vodafone', amount: 3.2, currency: 'GBP' },
    ]);
  });
});

describe('HL dividends', () => {
  it('parses dividend income rows before the quantity guard and converts DD/MM/YYYY dates', () => {
    const csv = [
      'Date,Stock Description,Type,Quantity,Net Amount',
      '10/03/2025,"HSBC Holdings Dividend",DIV,,"£12.50"',
      '01/02/2025,"HSBC Holdings",Purchase,100,"£650.00"',
    ].join('\n');
    const result = hl(csv, 'GBP');
    expect(result.holdings).toHaveLength(1);
    expect(result.dividends).toHaveLength(1);
    expect(result.dividends[0].date).toBe('2025-03-10');
    expect(result.dividends[0].amount).toBeCloseTo(12.5, 2);
    expect(result.dividends[0].currency).toBe('GBP');
  });
});
