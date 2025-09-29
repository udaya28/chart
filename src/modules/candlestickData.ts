// Infinite scroll: prevent duplicate/overlapping fetches and extend window if no data
const fetchedRanges = new Set<string>();
export let fetchInProgress = false;
export async function prependOlderCandles(
  requiredCandleCount: number,
  multiplier: number = 1.5,
) {
  const { underlying, timeframe, data, loading } = getState();
  if (loading || !data.length || fetchInProgress) return;
  fetchInProgress = true;
  try {
    let earliest = data[0].ts;
    let to = new Date(earliest);
    let interval = (TIMEFRAME_MAP[timeframe] || '1D') as
      | '1M'
      | '5M'
      | '1H'
      | '1D';
    // Estimate days to fetch based on interval and requiredCandleCount
    let daysPerCandle = 1;
    if (
      interval === '1M' ||
      interval === '5M' ||
      interval === '15M' ||
      interval === '30M'
    ) {
      daysPerCandle = 1 / 24 / 12; // ~5 min per candle, so 12 per hour, 24 hours
    } else if (interval === '1H') {
      daysPerCandle = 1 / 24; // 1 hour per candle, 24 per day
    } else if (interval === '1D') {
      daysPerCandle = 1;
    }
    // Only fetch as many days as needed for the user's leftward movement (with a small buffer)
    let windowDays = Math.ceil(
      requiredCandleCount * daysPerCandle * multiplier,
    ); // dynamic buffer
    let from = new Date(to);
    from.setDate(to.getDate() - windowDays);
    const fetchKey = `${underlying}|${interval}|${from
      .toISOString()
      .slice(0, 10)}|${to.toISOString().slice(0, 10)}`;
    if (fetchedRanges.has(fetchKey)) {
      fetchInProgress = false;
      return;
    }
    fetchedRanges.add(fetchKey);
    const resp = await fetchHistoricalCandleData(underlying, {
      from_date: from.toISOString().slice(0, 10),
      to_date: to.toISOString().slice(0, 10),
      interval,
      skip_last_ts: true,
    });
    const newCandles: QuoteCandle[] = resp?.candles || [];
    // Remove any overlap/duplicates
    const existingTimestamps = new Set(data.map(d => d.ts));
    const filtered = newCandles.filter(c => !existingTimestamps.has(c.ts));
    if (filtered.length > 0) {
      setState({ data: [...filtered, ...data] });
    }
  } catch (e) {
    setState({
      error: (e as Error).message || 'Failed to fetch data',
    });
  } finally {
    fetchInProgress = false;
  }
}
// Data fetching logic for candlestick data
import { setState, getState } from './store';
import { fetchHistoricalCandleData } from '../api/historicalQuotes';
import type { QuoteCandle } from '../api/historicalQuotes';

const TIMEFRAME_MAP: Record<string, string> = {
  '1m': '1M',
  '5m': '5M',
  '1h': '1H',
  '1d': '1D',
};

function getDateRange(): { from_date: string; to_date: string } {
  // For MVP, fetch last 30 days
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 30);
  return {
    from_date: from.toISOString().slice(0, 10),
    to_date: to.toISOString().slice(0, 10),
  };
}

export async function loadCandlestickData() {
  const { underlying, timeframe } = getState();
  setState({ loading: true, error: null });
  try {
    const { from_date, to_date } = getDateRange();
    const interval = (TIMEFRAME_MAP[timeframe] || '1D') as
      | '1M'
      | '5M'
      | '1H'
      | '1D';
    const resp = await fetchHistoricalCandleData(underlying, {
      from_date,
      to_date,
      interval,
      skip_last_ts: false,
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
