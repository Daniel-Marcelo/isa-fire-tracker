import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchLivePrices, fetchQuotes, searchStocks, __resetStockCache } from './firebasePrices';

// Firestore REST doc shape: { fields: { symbol: { stringValue }, latestPrice: { doubleValue }, currency: { stringValue } } }
function makeDoc(symbol: string, price: number, currency = 'GBP', lastUpdated?: string) {
  return {
    fields: {
      symbol: { stringValue: symbol },
      name: { stringValue: symbol },
      latestPrice: { doubleValue: price },
      currency: { stringValue: currency },
      ...(lastUpdated ? { lastUpdated: { timestampValue: lastUpdated } } : {}),
    },
  };
}

function listResponse(documents: unknown[], nextPageToken?: string) {
  return {
    ok: true,
    json: async () => ({ documents, ...(nextPageToken ? { nextPageToken } : {}) }),
  };
}

/** :batchGet returns a bare ARRAY of { found } / { missing } rows, not { documents }. */
function batchGetResponse(rows: unknown[]) {
  return { ok: true, json: async () => rows };
}

/** A batchGet the feed couldn't serve, so resolution falls through to the list. */
const batchGetFailed = { ok: false, json: async () => ({}) };

const isBatchGet = (call: unknown[]) => String(call[0]).includes(':batchGet');
const listCalls = (mock: { mock: { calls: unknown[][] } }) => mock.mock.calls.filter(c => !isBatchGet(c));

describe('firebasePrices', () => {
  beforeEach(() => {
    __resetStockCache();
    vi.restoreAllMocks();
  });

  it('paginates the stock list: a symbol that only appears on page 2 is still resolved', async () => {
    const page1 = [makeDoc('AAPL', 230)];
    const page2 = [makeDoc('TSLA', 400)];
    // batchGet misses, so resolution falls through to the paginated list.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(batchGetFailed)
      .mockResolvedValueOnce(listResponse(page1, 'token-2'))
      .mockResolvedValueOnce(listResponse(page2));
    vi.stubGlobal('fetch', fetchMock);

    const prices = await fetchLivePrices(['TSLA']);
    expect(prices.TSLA).toBe(400);
    expect(listCalls(fetchMock)).toHaveLength(2);
    expect(String(listCalls(fetchMock)[1][0])).toContain('pageToken=token-2');
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

describe('fetchQuotes — price age', () => {
  beforeEach(() => {
    __resetStockCache();
    vi.restoreAllMocks();
  });

  it('returns price, currency and asOf together in one pass over the feed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      batchGetResponse([{ found: makeDoc('AAPL', 340.08, 'USD', '2026-07-28T21:08:41.732Z') }]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const quotes = await fetchQuotes(['AAPL']);
    expect(quotes.AAPL).toEqual({
      price: 340.08,
      currency: 'USD',
      asOf: Date.parse('2026-07-28T21:08:41.732Z'),
    });
    // Previously price and currency each triggered their own walk of the list.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('yields asOf: null when the feed omits lastUpdated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(listResponse([makeDoc('AAPL', 230)])));
    const quotes = await fetchQuotes(['AAPL']);
    expect(quotes.AAPL.price).toBe(230);
    expect(quotes.AAPL.asOf).toBeNull();
  });

  it('yields asOf: null rather than NaN for an unparseable timestamp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      listResponse([makeDoc('AAPL', 230, 'GBP', 'not-a-date')]),
    ));
    const quotes = await fetchQuotes(['AAPL']);
    // NaN would make `now - asOf > threshold` false, silently reading as fresh.
    expect(quotes.AAPL.asOf).toBeNull();
  });

  it('carries asOf through the single-doc fallback for a symbol missing from the list', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('/stocks/TSLA')) {
        return Promise.resolve({
          ok: true,
          json: async () => makeDoc('TSLA', 400, 'USD', '2026-07-29T09:00:00.000Z'),
        });
      }
      return Promise.resolve(listResponse([makeDoc('AAPL', 230)]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const quotes = await fetchQuotes(['TSLA']);
    expect(quotes.TSLA.price).toBe(400);
    expect(quotes.TSLA.asOf).toBe(Date.parse('2026-07-29T09:00:00.000Z'));
  });

  it('asks for only the documents held, via :batchGet, and never scans the list', async () => {
    const fetchMock = vi.fn().mockResolvedValue(batchGetResponse([
      { found: makeDoc('AAPL', 230) },
      { found: makeDoc('VUSA', 85) },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const quotes = await fetchQuotes(['AAPL', 'VUSA']);
    expect(quotes.AAPL.price).toBe(230);
    expect(quotes.VUSA.price).toBe(85);

    // The whole point of the plan: a routine refresh must not pull the ~1.5 MB
    // full collection.
    expect(listCalls(fetchMock)).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(':batchGet');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.documents).toEqual([
      expect.stringContaining('/stocks/AAPL'),
      expect.stringContaining('/stocks/VUSA'),
    ]);
    // Masking out the large `meta` map is what makes this cheap.
    expect(body.mask.fieldPaths).toContain('lastUpdated');
    expect(body.mask.fieldPaths).not.toContain('meta');
  });

  it('falls back to the case-insensitive list when batchGet reports the doc missing', async () => {
    // Firestore doc ids are case-sensitive: 'vusa' misses, but the list has 'VUSA'.
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes(':batchGet')) {
        return Promise.resolve(batchGetResponse([{ missing: 'projects/nw-scrape/.../stocks/vusa' }]));
      }
      return Promise.resolve(listResponse([makeDoc('VUSA', 85)]));
    });
    vi.stubGlobal('fetch', fetchMock);

    const quotes = await fetchQuotes(['vusa']);
    expect(quotes.vusa.price).toBe(85);
    expect(listCalls(fetchMock).length).toBeGreaterThan(0);
  });

  it('chunks more than 100 tickers into separate batchGet requests', async () => {
    const tickers = Array.from({ length: 150 }, (_, i) => `T${i}`);
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>(url => {
      if (String(url).includes(':batchGet')) {
        return Promise.resolve(batchGetResponse(tickers.map(t => ({ found: makeDoc(t, 10) }))));
      }
      return Promise.resolve(listResponse([]));
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchQuotes(tickers);
    const batchCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes(':batchGet'));
    expect(batchCalls).toHaveLength(2);
    const docsIn = (call: [string, RequestInit?]) => JSON.parse(String(call[1]?.body)).documents;
    expect(docsIn(batchCalls[0])).toHaveLength(100);
    expect(docsIn(batchCalls[1])).toHaveLength(50);
  });

  it('a non-ok batchGet falls through to the list rather than returning {}', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(batchGetFailed)
      .mockResolvedValue(listResponse([makeDoc('AAPL', 230)]));
    vi.stubGlobal('fetch', fetchMock);

    const quotes = await fetchQuotes(['AAPL']);
    expect(quotes.AAPL.price).toBe(230);
  });

  it('searchStocks masks out the heavy meta field', async () => {
    const fetchMock = vi.fn().mockResolvedValue(listResponse([makeDoc('AAPL', 230)]));
    vi.stubGlobal('fetch', fetchMock);

    await searchStocks('app');
    const url = String(listCalls(fetchMock)[0][0]);
    expect(url).toContain('mask.fieldPaths=symbol');
    expect(url).toContain('mask.fieldPaths=lastUpdated');
  });

  it('normalises pence to pounds while keeping the timestamp intact', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      listResponse([makeDoc('VUSA', 8500, 'GBp', '2026-07-29T09:00:00.000Z')]),
    ));
    const quotes = await fetchQuotes(['VUSA']);
    expect(quotes.VUSA.price).toBe(85);
    expect(quotes.VUSA.currency).toBe('GBP');
    expect(quotes.VUSA.asOf).toBe(Date.parse('2026-07-29T09:00:00.000Z'));
  });
});
