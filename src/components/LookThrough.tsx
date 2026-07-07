import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, Upload } from 'lucide-react';
import type { AppData, FundHolding, UploadedFundHoldings } from '../types';
import { useCurrency } from '../contexts/CurrencyContext';
import ExposureCharts from './ExposureCharts';

interface Props {
  data: AppData;
  fundHoldings: UploadedFundHoldings[];
}

interface ExposureRow {
  ticker: string;
  name: string;
  country: string;
  sector: string;
  fundValue: number;
  directValue: number;
  totalValue: number;
  totalPct: number;
}

const SECTOR_COLOURS: Record<string, string> = {
  Technology:    'bg-indigo-900/40 text-indigo-400',
  Financials:    'bg-emerald-900/40 text-emerald-400',
  Healthcare:    'bg-rose-900/40 text-rose-400',
  Consumer:      'bg-amber-900/40 text-amber-400',
  Energy:        'bg-orange-900/40 text-orange-400',
  Industrials:   'bg-cyan-900/40 text-cyan-400',
  Materials:     'bg-lime-900/40 text-lime-400',
  Telecom:       'bg-violet-900/40 text-violet-400',
  'Real Estate': 'bg-sky-900/40 text-sky-400',
  Utilities:     'bg-teal-900/40 text-teal-400',
};

const FLAG: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', JP: '🇯🇵', KR: '🇰🇷', TW: '🇹🇼',
  NL: '🇳🇱', DK: '🇩🇰', CN: '🇨🇳', HK: '🇭🇰', IN: '🇮🇳',
  SA: '🇸🇦', ZA: '🇿🇦', CH: '🇨🇭', BR: '🇧🇷', MX: '🇲🇽',
  AU: '🇦🇺', DE: '🇩🇪', FR: '🇫🇷', SE: '🇸🇪', SG: '🇸🇬',
  TH: '🇹🇭', ID: '🇮🇩', MY: '🇲🇾', PH: '🇵🇭', HU: '🇭🇺',
  KW: '🇰🇼', QA: '🇶🇦', AE: '🇦🇪', PL: '🇵🇱', TR: '🇹🇷',
  EG: '🇪🇬', GR: '🇬🇷', CL: '🇨🇱', CO: '🇨🇴', PE: '🇵🇪',
};

const FUND_KEYWORDS = /\b(etf|fund|ucits|trust|index|oeic|vct|reit|accumulation|income)\b/i;

function matchesFund(h: { ticker?: string; name: string }, fundId: string) {
  return (
    h.ticker?.toUpperCase() === fundId ||
    h.name.toUpperCase().includes(fundId)
  );
}

export default function LookThrough({ data, fundHoldings }: Props) {
  const { fmt } = useCurrency();
  const [sectorFilter, setSectorFilter] = useState<string>('All');
  const [fundsExpanded, setFundsExpanded] = useState(true);

  const fundRegistry = useMemo(() =>
    fundHoldings.map(u => ({
      id: u.fundTicker.toUpperCase(),
      label: u.fundTicker.toUpperCase(),
      name: u.fundName || u.fundTicker.toUpperCase(),
      holdings: u.holdings as FundHolding[],
      updated: u.asAt,
    })),
  [fundHoldings]);

  const allHoldings = data.providers.flatMap(p => p.holdings);

  const fundTotals = fundRegistry.map(fund => {
    const held = allHoldings.filter(h => matchesFund(h, fund.id));
    return { ...fund, heldHoldings: held, total: held.reduce((s, h) => s + (h.currentValue ?? 0), 0) };
  });

  const isFundHolding = (h: { ticker?: string; name: string }) =>
    fundRegistry.some(f => matchesFund(h, f.id));

  const unmatchedFunds = allHoldings.filter(h =>
    !isFundHolding(h) && (h.currentValue ?? 0) > 0 && FUND_KEYWORDS.test(h.name)
  );

  const directHoldings = allHoldings.filter(h => !isFundHolding(h) && !FUND_KEYWORDS.test(h.name) && h.ticker);
  const totalPortfolio = allHoldings.reduce((s, h) => s + (h.currentValue ?? 0), 0);

  const rows = useMemo<ExposureRow[]>(() => {
    const map = new Map<string, ExposureRow>();

    fundRegistry.forEach(fund => {
      const userHoldings = allHoldings.filter(h => matchesFund(h, fund.id));
      const total = userHoldings.reduce((s, h) => s + (h.currentValue ?? 0), 0);
      if (total === 0) return;
      fund.holdings.forEach(fh => {
        const contribution = total * (fh.weight / 100);
        const existing = map.get(fh.ticker);
        if (existing) {
          existing.fundValue += contribution;
          existing.totalValue += contribution;
        } else {
          map.set(fh.ticker, {
            ticker: fh.ticker,
            name: fh.name,
            country: fh.country,
            sector: fh.sector,
            fundValue: contribution,
            directValue: 0,
            totalValue: contribution,
            totalPct: 0,
          });
        }
      });
    });

    directHoldings.forEach(h => {
      const ticker = h.ticker!.toUpperCase();
      const existing = map.get(ticker);
      if (existing) {
        existing.directValue = h.currentValue ?? 0;
        existing.totalValue = existing.fundValue + (h.currentValue ?? 0);
      } else {
        map.set(ticker, {
          ticker,
          name: h.name,
          country: 'US',
          sector: 'Other',
          fundValue: 0,
          directValue: h.currentValue ?? 0,
          totalValue: h.currentValue ?? 0,
          totalPct: 0,
        });
      }
    });

    const sorted = Array.from(map.values())
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, 50);

    return sorted.map(r => ({ ...r, totalPct: totalPortfolio > 0 ? (r.totalValue / totalPortfolio) * 100 : 0 }));
  }, [allHoldings, directHoldings, totalPortfolio, fundRegistry]);

  const allFundHoldings = fundRegistry.flatMap(f => f.holdings);
  const sectors = ['All', ...Array.from(new Set(allFundHoldings.map(h => h.sector).filter(Boolean))).sort()];
  const filtered = sectorFilter === 'All' ? rows : rows.filter(r => r.sector === sectorFilter);
  const coveredPct = rows.reduce((s, r) => s + r.totalPct, 0);

  const activeFunds = fundTotals.filter(f => f.total > 0);
  const unmatchedFundRows = Object.values(
    unmatchedFunds.reduce<Record<string, { label: string; total: number }>>((acc, h) => {
      const key = h.ticker?.toUpperCase() ?? h.name;
      if (!acc[key]) acc[key] = { label: h.ticker?.toUpperCase() ?? h.name, total: 0 };
      acc[key].total += h.currentValue ?? 0;
      return acc;
    }, {})
  ).sort((a, b) => b.total - a.total);
  const allFundRows = [
    ...activeFunds.map(f => ({ label: f.label, total: f.total, hasData: true })),
    ...unmatchedFundRows.map(r => ({ label: r.label, total: r.total, hasData: false })),
  ];
  const totalFundValue = allFundRows.reduce((s, f) => s + f.total, 0);

  const anyFundHeld = fundTotals.some(f => f.total > 0);
  if (!anyFundHeld && directHoldings.length === 0) {
    return (
      <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 p-10 text-center">
        <p className="text-lg font-medium text-slate-500">No look-through data yet</p>
        <p className="text-sm text-slate-600 mt-1 max-w-sm mx-auto">
          Upload a fund's holdings breakdown on the Fund Holdings page, or add direct stock holdings, to see your effective exposure.
        </p>
        <Link
          to="/funds"
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
        >
          <Upload className="w-4 h-4" />
          Go to Fund Holdings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Fund Exposure collapsible card */}
      <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 overflow-hidden">
        <button
          onClick={() => setFundsExpanded(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-slate-700/20 transition-colors"
        >
          <div>
            <p className="font-semibold text-slate-100">Fund Exposure</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {fmt(totalFundValue)} across {allFundRows.length} fund{allFundRows.length !== 1 ? 's' : ''} · top 50 positions · {coveredPct.toFixed(1)}% of portfolio
            </p>
          </div>
          {fundsExpanded
            ? <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
            : <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />}
        </button>
        {fundsExpanded && (
          <div className="border-t border-slate-700/50">
            {allFundRows.map((f, i) => (
              <div
                key={f.label}
                className={`flex items-center justify-between px-4 py-3 ${i < allFundRows.length - 1 ? 'border-b border-slate-700/30' : ''}`}
              >
                <div>
                  <p className="font-medium text-slate-200">{f.label}</p>
                  {!f.hasData && <p className="text-xs text-amber-400 mt-0.5">No holdings uploaded</p>}
                </div>
                <p className="font-semibold text-slate-100 tabular-nums">{fmt(f.total)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Exposure donuts */}
      <ExposureCharts data={data} fundHoldings={fundHoldings} />

      {/* Sector filter */}
      <div className="flex gap-2 flex-wrap">
        {sectors.map(s => (
          <button
            key={s}
            onClick={() => setSectorFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              sectorFilter === s
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 border border-slate-700'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Table — desktop full table, mobile card list */}
      <div className="bg-slate-800/70 rounded-xl border border-slate-700/50 overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-900/60 border-b border-slate-700/50">
              <tr className="text-xs text-slate-600 uppercase tracking-wider">
                <th className="text-left px-4 py-3 font-medium">#</th>
                <th className="text-left px-4 py-3 font-medium">Stock</th>
                <th className="text-left px-4 py-3 font-medium">Sector</th>
                <th className="text-right px-4 py-3 font-medium">Via Funds</th>
                <th className="text-right px-4 py-3 font-medium">Direct</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-right px-4 py-3 font-medium">% Portfolio</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.map((row, i) => {
                const barPct = Math.min((row.totalValue / (rows[0]?.totalValue || 1)) * 100, 100);
                return (
                  <tr key={row.ticker} className="hover:bg-slate-700/20 transition-colors">
                    <td className="px-4 py-3 text-slate-600 text-xs tabular-nums">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{FLAG[row.country] ?? '🌍'}</span>
                        <div>
                          <div className="font-medium text-slate-100">{row.name}</div>
                          <div className="text-xs text-slate-500 font-mono">{row.ticker}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SECTOR_COLOURS[row.sector] ?? 'bg-slate-700 text-slate-400'}`}>
                        {row.sector}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
                      {row.fundValue > 0 ? fmt(row.fundValue) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.directValue > 0
                        ? <span className="text-indigo-400 font-medium">{fmt(row.directValue)}</span>
                        : <span className="text-slate-700">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-100 tabular-nums">
                      {fmt(row.totalValue)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 tabular-nums">
                      {row.totalPct.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 w-24">
                      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${barPct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile card list */}
        <div className="md:hidden divide-y divide-slate-800">
          {filtered.map((row, i) => {
            const barPct = Math.min((row.totalValue / (rows[0]?.totalValue || 1)) * 100, 100);
            const sectorClass = SECTOR_COLOURS[row.sector] ?? 'bg-slate-700 text-slate-400';
            return (
              <div key={row.ticker} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 w-5 tabular-nums">{i + 1}</span>
                  <span className="text-base">{FLAG[row.country] ?? '🌍'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-100 truncate">{row.name}</p>
                    <p className="text-xs text-slate-500 font-mono">{row.ticker}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold text-slate-100 tabular-nums">{fmt(row.totalValue)}</p>
                    <p className="text-xs text-slate-500 tabular-nums">{row.totalPct.toFixed(2)}%</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sectorClass}`}>{row.sector}</span>
                  {row.directValue > 0 && <span className="text-xs text-indigo-400 tabular-nums">Direct {fmt(row.directValue)}</span>}
                  <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${barPct}%` }} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-3 border-t border-slate-700/50 bg-slate-900/40">
          <p className="text-xs text-slate-600">
            Fund weights from uploaded Vanguard data.{' '}
            {fundRegistry.map(f => `${f.label}: ${f.updated}`).join(' · ')}.{' '}
            Top 50 positions shown. Direct holdings merged where tickers match.
          </p>
        </div>
      </div>
    </div>
  );
}
