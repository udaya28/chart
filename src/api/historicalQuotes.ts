function urlForHistoricalCandleData(symbol: Tradingsymbol): string {
  return `/api/v1/compute/candles/${symbol}`;
}

export type Tradingsymbol = string;

export type QuoteCandle = {
  ts: string;

  open: number;
  high: number;
  close: number;
  low: number;

  oi: number;
  volume: number;
};

type HistoricalCandleResp = {
  candles: QuoteCandle[];
};

type HistoricalCandleReqParams = {
  from_date: string;
  to_date: string;
  interval: '1M' | '5M' | '15M' | '30M' | '1H' | '1D';
  skip_last_ts: boolean;
};

export async function fetchHistoricalCandleData(
  symbol: Tradingsymbol,
  params: HistoricalCandleReqParams,
): Promise<HistoricalCandleResp | undefined> {
  const resp = await fetch(urlForHistoricalCandleData(symbol), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  console.log('fetchHistoricalCandleData', resp.status, resp.statusText);

  if (!resp.ok) {
    console.error('Failed to fetch historical candle data:', resp.statusText);
    return undefined;
  }

  const data = await resp.json();
  return data.payload as HistoricalCandleResp;
}

// Example usage
/**

const data = await fetchHistoricalCandleData('NIFTY', {
  from_date: '2021-05-29',
  to_date: '2022-05-29',
  interval: '1D',
  skip_last_ts: false,
})

 */
