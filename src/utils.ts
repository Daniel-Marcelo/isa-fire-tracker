export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatCurrencyShort(value: number): string {
  if (value >= 1_000_000) return `£${(value / 1_000_000).toFixed(2)}m`;
  if (value >= 1_000) return `£${(value / 1_000).toFixed(1)}k`;
  return formatCurrency(value);
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const PROVIDER_COLORS = [
  // Blues
  '#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd',
  // Reds
  '#b91c1c', '#ef4444', '#f87171', '#fca5a5',
  // Purples
  '#7c3aed', '#a78bfa',
  // Greens
  '#059669', '#34d399',
  // Oranges / Ambers
  '#d97706', '#fb923c',
  // Pinks
  '#db2777', '#f472b6',
  // Teals / Cyan
  '#0e7490', '#22d3ee',
  // Slate / Dark
  '#334155', '#64748b',
];

export function taxYearLabel(year: number): string {
  return `${year}/${String(year + 1).slice(2)}`;
}
