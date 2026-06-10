// VFEG (Vanguard FTSE Emerging Markets UCITS ETF USD Accumulating) top holdings
// Weights are APPROXIMATE % of fund NAV — verify and update periodically from:
// https://www.vanguard.co.uk/professional/product/etf/equity/9534/ftse-emerging-markets-ucits-etf-usd-accumulating#portfolio-data
export const VFEG_UPDATED = '2026-06-approx';

import type { FundHolding } from './vwrl-holdings';

export const VFEG_HOLDINGS: FundHolding[] = [
  { ticker: 'TSM',     name: 'Taiwan Semiconductor Manufacturing', weight: 9.50, country: 'TW', sector: 'Technology' },
  { ticker: '005930',  name: 'Samsung Electronics Co Ltd',         weight: 5.00, country: 'KR', sector: 'Technology' },
  { ticker: '700',     name: 'Tencent Holdings Ltd',               weight: 4.00, country: 'CN', sector: 'Technology' },
  { ticker: 'BABA',    name: 'Alibaba Group Holding Ltd',          weight: 2.50, country: 'CN', sector: 'Consumer' },
  { ticker: '2222',    name: 'Saudi Aramco',                       weight: 2.00, country: 'SA', sector: 'Energy' },
  { ticker: '000660',  name: 'SK hynix Inc',                       weight: 1.90, country: 'KR', sector: 'Technology' },
  { ticker: 'RELIANCE',name: 'Reliance Industries Ltd',            weight: 1.50, country: 'IN', sector: 'Energy' },
  { ticker: 'HDFCBANK',name: 'HDFC Bank Ltd',                      weight: 1.20, country: 'IN', sector: 'Financials' },
  { ticker: '3690',    name: 'Meituan',                            weight: 1.00, country: 'CN', sector: 'Consumer' },
  { ticker: 'PDD',     name: 'PDD Holdings Inc',                   weight: 0.90, country: 'CN', sector: 'Consumer' },
  { ticker: 'JD',      name: 'JD.com Inc',                         weight: 0.80, country: 'CN', sector: 'Consumer' },
  { ticker: 'INFY',    name: 'Infosys Ltd',                        weight: 0.70, country: 'IN', sector: 'Technology' },
  { ticker: 'ICICIBANK',name: 'ICICI Bank Ltd',                    weight: 0.70, country: 'IN', sector: 'Financials' },
  { ticker: '1211',    name: 'BYD Co Ltd',                         weight: 0.60, country: 'CN', sector: 'Consumer' },
  { ticker: '939',     name: 'China Construction Bank',            weight: 0.60, country: 'CN', sector: 'Financials' },
  { ticker: '1398',    name: 'Industrial & Commercial Bank of China', weight: 0.50, country: 'CN', sector: 'Financials' },
  { ticker: '2318',    name: 'Ping An Insurance Group',            weight: 0.50, country: 'CN', sector: 'Financials' },
  { ticker: '9999',    name: 'NetEase Inc',                        weight: 0.50, country: 'CN', sector: 'Technology' },
  { ticker: '1810',    name: 'Xiaomi Corp',                        weight: 0.40, country: 'CN', sector: 'Technology' },
  { ticker: 'BIDU',    name: 'Baidu Inc',                          weight: 0.40, country: 'CN', sector: 'Technology' },
  { ticker: 'TCOM',    name: 'Trip.com Group Ltd',                 weight: 0.40, country: 'CN', sector: 'Consumer' },
  { ticker: 'NPN',     name: 'Naspers Ltd',                        weight: 0.30, country: 'ZA', sector: 'Technology' },
  { ticker: '035420',  name: 'NAVER Corp',                         weight: 0.30, country: 'KR', sector: 'Technology' },
  { ticker: '105560',  name: 'KB Financial Group Inc',             weight: 0.30, country: 'KR', sector: 'Financials' },
  { ticker: '005380',  name: 'Hyundai Motor Co',                   weight: 0.30, country: 'KR', sector: 'Consumer' },
  { ticker: 'OTHER',   name: 'Other',                              weight: 63.20, country: '',  sector: 'Other' },
];
