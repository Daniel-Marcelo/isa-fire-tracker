// VWRL (Vanguard FTSE All-World UCITS ETF) top holdings
// Weights are approximate % of fund NAV — update periodically from:
// https://www.vanguard.co.uk/professional/product/etf/equity/9505/ftse-all-world-ucits-etf-usd-distributing#portfolio-data
export const VWRL_UPDATED = '2026-06';

export interface FundHolding {
  ticker: string;
  name: string;
  weight: number; // % of fund
  country: string;
  sector: string;
}

export const VWRL_HOLDINGS: FundHolding[] = [
  { ticker: 'NVDA',    name: 'NVIDIA Corp',                          weight: 4.58, country: 'US', sector: 'Technology' },
  { ticker: 'AAPL',    name: 'Apple Inc',                            weight: 3.83, country: 'US', sector: 'Technology' },
  { ticker: 'MSFT',    name: 'Microsoft Corp',                       weight: 2.97, country: 'US', sector: 'Technology' },
  { ticker: 'AMZN',    name: 'Amazon.com Inc',                       weight: 2.49, country: 'US', sector: 'Consumer' },
  { ticker: 'GOOGL',   name: 'Alphabet Inc (Class A)',               weight: 2.19, country: 'US', sector: 'Technology' },
  { ticker: 'AVGO',    name: 'Broadcom Inc',                         weight: 1.89, country: 'US', sector: 'Technology' },
  { ticker: 'GOOG',    name: 'Alphabet Inc (Class C)',               weight: 1.78, country: 'US', sector: 'Technology' },
  { ticker: 'TSM',     name: 'Taiwan Semiconductor Manufacturing',   weight: 1.61, country: 'TW', sector: 'Technology' },
  { ticker: 'META',    name: 'Meta Platforms Inc',                   weight: 1.31, country: 'US', sector: 'Technology' },
  { ticker: 'TSLA',    name: 'Tesla Inc',                            weight: 1.06, country: 'US', sector: 'Consumer' },
  { ticker: 'LLY',     name: 'Eli Lilly & Co',                      weight: 0.73, country: 'US', sector: 'Healthcare' },
  { ticker: 'JPM',     name: 'JPMorgan Chase & Co',                  weight: 0.71, country: 'US', sector: 'Financials' },
  { ticker: 'BRK.B',   name: 'Berkshire Hathaway Inc',              weight: 0.69, country: 'US', sector: 'Financials' },
  { ticker: '005930',  name: 'Samsung Electronics Co Ltd',           weight: 0.69, country: 'KR', sector: 'Technology' },
  { ticker: 'XOM',     name: 'Exxon Mobil Corp',                     weight: 0.64, country: 'US', sector: 'Energy' },
  { ticker: 'MU',      name: 'Micron Technology Inc',                weight: 0.57, country: 'US', sector: 'Technology' },
  { ticker: 'WMT',     name: 'Walmart Inc',                          weight: 0.56, country: 'US', sector: 'Consumer' },
  { ticker: 'AMD',     name: 'Advanced Micro Devices Inc',           weight: 0.56, country: 'US', sector: 'Technology' },
  { ticker: 'ASML',    name: 'ASML Holding NV',                      weight: 0.55, country: 'NL', sector: 'Technology' },
  { ticker: 'V',       name: 'Visa Inc',                             weight: 0.54, country: 'US', sector: 'Financials' },
  { ticker: 'JNJ',     name: 'Johnson & Johnson',                    weight: 0.54, country: 'US', sector: 'Healthcare' },
  { ticker: '000660',  name: 'SK hynix Inc',                         weight: 0.46, country: 'KR', sector: 'Technology' },
  { ticker: 'COST',    name: 'Costco Wholesale Corp',                weight: 0.44, country: 'US', sector: 'Consumer' },
  { ticker: 'INTC',    name: 'Intel Corp',                           weight: 0.41, country: 'US', sector: 'Technology' },
  { ticker: 'CAT',     name: 'Caterpillar Inc',                      weight: 0.40, country: 'US', sector: 'Industrials' },
  { ticker: 'MA',      name: 'Mastercard Inc',                       weight: 0.40, country: 'US', sector: 'Financials' },
  { ticker: 'NFLX',    name: 'Netflix Inc',                          weight: 0.39, country: 'US', sector: 'Technology' },
  { ticker: 'ABBV',    name: 'AbbVie Inc',                           weight: 0.37, country: 'US', sector: 'Healthcare' },
  { ticker: '700',     name: 'Tencent Holdings Ltd',                 weight: 0.36, country: 'CN', sector: 'Technology' },
  { ticker: 'CSCO',    name: 'Cisco Systems Inc',                    weight: 0.36, country: 'US', sector: 'Technology' },
  { ticker: 'CVX',     name: 'Chevron Corp',                         weight: 0.35, country: 'US', sector: 'Energy' },
  { ticker: 'PG',      name: 'Procter & Gamble Co',                  weight: 0.34, country: 'US', sector: 'Consumer' },
  { ticker: 'UNH',     name: 'UnitedHealth Group Inc',               weight: 0.33, country: 'US', sector: 'Healthcare' },
  { ticker: 'LRCX',    name: 'Lam Research Corp',                    weight: 0.32, country: 'US', sector: 'Technology' },
  { ticker: 'HD',      name: 'Home Depot Inc',                       weight: 0.32, country: 'US', sector: 'Consumer' },
  { ticker: 'AMAT',    name: 'Applied Materials Inc',                weight: 0.31, country: 'US', sector: 'Technology' },
  { ticker: 'HSBA',    name: 'HSBC Holdings PLC',                    weight: 0.31, country: 'GB', sector: 'Financials' },
  { ticker: 'BAC',     name: 'Bank of America Corp',                 weight: 0.30, country: 'US', sector: 'Financials' },
  { ticker: 'KO',      name: 'Coca-Cola Co',                         weight: 0.30, country: 'US', sector: 'Consumer' },
  { ticker: 'PLTR',    name: 'Palantir Technologies Inc',            weight: 0.30, country: 'US', sector: 'Technology' },
  { ticker: 'GE',      name: 'General Electric Co',                  weight: 0.30, country: 'US', sector: 'Industrials' },
  { ticker: 'GEV',     name: 'GE Vernova Inc',                       weight: 0.29, country: 'US', sector: 'Industrials' },
  { ticker: 'BABA',    name: 'Alibaba Group Holding Ltd',            weight: 0.28, country: 'CN', sector: 'Consumer' },
  { ticker: 'AZN',     name: 'AstraZeneca PLC',                      weight: 0.28, country: 'GB', sector: 'Healthcare' },
  { ticker: 'ROG',     name: 'Roche Holding AG',                     weight: 0.28, country: 'CH', sector: 'Healthcare' },
  { ticker: 'NOVN',    name: 'Novartis AG',                          weight: 0.28, country: 'CH', sector: 'Healthcare' },
  { ticker: 'ORCL',    name: 'Oracle Corp',                          weight: 0.27, country: 'US', sector: 'Technology' },
  { ticker: 'OTHER',   name: 'Other',                                weight: 60.76, country: '',  sector: 'Other' },
];
