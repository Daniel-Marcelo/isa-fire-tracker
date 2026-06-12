import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Upload } from 'lucide-react';
import type { AppData, FundHolding } from '../types';
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
  Technology:    'bg-indigo-100 text-indigo-700',
  Financials:    'bg-emerald-100 text-emerald-700',
  Healthcare:    'bg-rose-100 text-rose-700',
  Consumer:      'bg-amber-100 text-amber-700',
  Energy:        'bg-orange-100 text-orange-700',
  Industrials:   'bg-cyan-100 text-cyan-700',
  Materials:     'bg-lime-100 text-lime-700',
  Telecom:       'bg-violet-100 text-violet-700',
  'Real Estate': 'bg-sky-100 text-sky-700',
  Utilities:     'bg-teal-100 text-teal-700',
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

function matchesFund(h: { ticker?: string; name: string }, fundId: string) {
  return (
    h.ticker?.toUpperCase() === fundId ||
    h.name.toUpperCase().includes(fundId)
  );
}

export default function LookThrough({ data, fundHoldings }: Props) {
  const { fmt } = useCurrency();
  const [sectorFilter, setSectorFilter] = useState<string>('All');

  const fundRegistry = useMemo(() =>
    fundHoldings.map(u => ({
      id: u.fundTicker.toUpperCase(),
      label: u.fundTicker.toUpperCase(),
      holdings: u.holdings as FundHolding[],
      updated: u.asAt,
    })),
  [fundHoldings]);

  const allHoldings = data.providers.flatMap(p => p.holdings);

  const fundTotals = fundRegistry.map(fund => {
    const held = allHoldings.filter(h => matchesFund(h, fund.id));
    return { ...fund, heldHoldings: held, total: held.reduce((s, h) => s + h.currentValue, 0) };
  });

  const isFundHolding = (h: { ticker?: string; name: string }) =>
    fundRegistry.some(f => matchesFund(h, f.id));

  const directHoldings = allHoldings.filter(h => !isFundHolding(h) && h.ticker);
  const totalPortfolio = allHoldings.reduce((s, h) => s + h.currentValue, 0);

  const rows = useMemo<ExposureRow[]>(() => {
    const map = new Map<string, ExposureRow>();

    fundRegistry.forEach(fund => {
      const userHoldings = allHoldings.filter(h => matchesFund(h, fund.id));
      const total = userHoldings.reduce((s, h) => s + h.currentValue, 0);
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
        existing.directValue = h.currentValue;
        existing.totalValue = existing.fundValue + h.currentValue;
      } else {
        map.set(ticker, {
          ticker,
          name: h.name,
          country: 'US',
          sector: 'Other',
          fundValue: 0,
          directValue: h.currentValue,
          totalValue: h.currentValue,
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
  const sectors = ['All', ...Array.from(new Set(allFundHoldings.map(h => h.sector))).sort()];
  const filtered = sectorFilter === 'All' ? rows : rows.filter(r => r.sector === sectorFilter);
  const coveredPct = rows.reduce((s, r) => s + r.totalPct, 0);

  const anyFundHeld = fundTotals.some(f => f.total > 0);
  if (!anyFundHeld && directHoldings.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center shadow-sm">
        <p className="text-lg font-medium text-gray-500">No look-through data yet</p>
        <p className="text-sm text-gray-400 mt-1 max-w-sm mx-auto">
          Upload a fund's holdings breakdown on the Fund Holdings page, or add direct stock holdings, to see your effective exposure.
        </p>
        <Link
          to="/funds"
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Upload className="w-4 h-4" />
          Go to Fund Holdings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {fundTotals.map(f => (
          <div key={f.id} className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
            <p className="text-sm text-gray-500">{f.label} exposure</p>
            <p className="text-xl font-bold text-gray-900 mt-1">{fmt(f.total)}</p>
            <p className="text-xs text-gray-400 mt-0.5">
              across {f.heldHoldings.length} account{f.heldHoldings.length !== 1 ? 's' : ''}
            </p>
          </div>
        ))}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm">
          <p className="text-sm text-gray-500">Portfolio covered</p>
          <p className="text-xl font-bold text-gray-900 mt-1">{coveredPct.toFixed(1)}%</p>
          <p className="text-xs text-gray-400 mt-0.5">top 50 by effective value</p>
        </div>
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
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr className="text-xs text-gray-500 uppercase tracking-wide">
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
            <tbody className="divide-y divide-gray-50">
              {filtered.map((row, i) => {
                const barPct = Math.min((row.totalValue / (rows[0]?.totalValue || 1)) * 100, 100);
                return (
                  <tr key={row.ticker} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{FLAG[row.country] ?? '🌍'}</span>
                        <div>
                          <div className="font-medium text-gray-900">{row.ticker}</div>
                          <div className="text-xs text-gray-400 truncate max-w-36">{row.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SECTOR_COLOURS[row.sector] ?? 'bg-gray-100 text-gray-600'}`}>
                        {row.sector}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {row.fundValue > 0 ? fmt(row.fundValue) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.directValue > 0
                        ? <span className="text-indigo-600 font-medium">{fmt(row.directValue)}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {fmt(row.totalValue)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {row.totalPct.toFixed(2)}%
                    </td>
                    <td className="px-4 py-3 w-24">
                      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${barPct}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
          <p className="text-xs text-gray-400">
            Fund weights from uploaded Vanguard data.{' '}
            {fundRegistry.map(f => `${f.label}: ${f.updated}`).join(' · ')}.{' '}
            Top 50 positions shown. Direct holdings merged where tickers match.
          </p>
        </div>
      </div>
    </div>
  );
}
