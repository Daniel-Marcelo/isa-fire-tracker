import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchLivePrices, searchStocks, __resetStockCache } from './firebasePrices';

// Firestore REST doc shape: { fields: { symbol: { stringValue }, latestPrice: { doubleValue }, currency: { stringValue } } }
function makeDoc(symbol: string, price: number, currency = 'GBP') {
  return {
    fields: {
      symbol: { stringValue: symbol },
      name: { stringValue: symbol },
      latestPrice: { doubleValue: price },
      currency: { stringValue: currency },
    },
  };
}

function listResponse(documents: unknown[], nextPageToken?: string) {
  return {
    ok: true,
    json: async () => ({ documents, ...(nextPageToken ? { nextPageToken } : {}) }),
  };
}

describe('firebasePrices', () => {
  beforeEach(() => {
    __resetStockCache();
    vi.restoreAllMocks();
  });

  it('paginates the stock list: a symbol that only appears on page 2 is still resolved', async () => {
    const page1 = [makeDoc('AAPL', 230)];
    const page2 = [makeDoc('TSLA', 400)];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(listResponse(page1, 'token-2'))
      .mockResolvedValueOnce(listResponse(page2));
    vi.stubGlobal('fetch', fetchMock);

    const prices = await fetchLivePrices(['TSLA']);
    expect(prices.TSLA).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondCallUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondCallUrl).toContain('pageToken=token-2');
  });

  it('searchStocks can resolve a symbol that only appears on page 2', async () => {
    const page1 = [makeDoc('AAPL', 230)];
    const page2 = [makeDoc('TSLA', 400)];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(listResponse(page1, 'token-2'))
      .mockResolvedValueOnce(listResponse(page2));
    vi.stubGlobal('fetch', fetchMock);

    const results = await searchStocks('TSLA');
    expect(results.some(r => r.symbol === 'TSLA')).toBe(true);
  });

  it('falls back to the single-doc endpoint when a requested ticker is missing from the list', async () => {
    const listFetch = vi.fn().mockResolvedValue(listResponse([makeDoc('AAPL', 230)]));
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/stocks/TSLA')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            fields: {
              symbol: { stringValue: 'TSLA' },
              name: { stringValue: 'Tesla' },
              latestPrice: { doubleValue: 400 },
              currency: { stringValue: 'USD' },
            },
          }),
        });
      }
      return listFetch();
    });
    vi.stubGlobal('fetch', fetchMock);

    const prices = await fetchLivePrices(['AAPL', 'TSLA']);
    expect(prices.AAPL).toBe(230);
    expect(prices.TSLA).toBe(400);
  });

  it('passes the original-case ticker to the single-doc fallback endpoint', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/stocks/tsla.L')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            fields: {
              symbol: { stringValue: 'tsla.L' },
              latestPrice: { doubleValue: 123 },
              currency: { stringValue: 'GBP' },
            },
          }),
        });
      }
      return Promise.resolve(listResponse([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const prices = await fetchLivePrices(['tsla.L']);
    expect(prices['tsla.L']).toBe(123);
    const fallbackCall = fetchMock.mock.calls.find(c => (c[0] as string).includes('/stocks/'));
    expect(fallbackCall?.[0]).toContain('/stocks/tsla.L');
  });

  it('a single unknown/404 ticker does not suppress prices for other holdings in the same refresh', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/stocks/UNKNOWN')) {
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }
      return Promise.resolve(listResponse([makeDoc('AAPL', 230)]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const prices = await fetchLivePrices(['AAPL', 'UNKNOWN']);
    expect(prices.AAPL).toBe(230);
    expect(prices.UNKNOWN).toBeUndefined();
  });

  it('total feed outage still resolves to {} without throwing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchLivePrices(['AAPL'])).resolves.toEqual({});
  });
});
