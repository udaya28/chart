import { setState, getState } from './store';
import { fetchHistoricalCandleData } from '../api/historicalQuotes';
import type { QuoteCandle } from '../api/historicalQuotes';

const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1M',
  '5m': '5M',
  '15m': '15M',
  '30m': '30M',
  '1h': '1H',
  '1d': '1D',
};

export async function loadCandlestickData() {
  const { underlying, timeframe } = getState();
  setState({ loading: true, error: null });
  try {
    const interval = (TIMEFRAME_MAP[timeframe] || '1D') as
      | '1M'
      | '5M'
      | '15M'
      | '30M'
      | '1H'
      | '1D';
    const resp = await fetchHistoricalCandleData(underlying, {
      interval,
    });
    const data: QuoteCandle[] = resp?.candles || [];
    setState({ data, loading: false });
  } catch (e) {
    setState({
      error: (e as Error).message || 'Failed to fetch data',
      loading: false,
      data: [],
    });
  }
}
