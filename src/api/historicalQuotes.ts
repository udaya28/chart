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
  interval: '1M' | '5M' | '15M' | '30M' | '1H' | '1D';
  skip_last_ts?: boolean;
};

const INTERVAL_TO_MS: Record<HistoricalCandleReqParams['interval'], number> = {
  '1M': 60 * 1000,
  '5M': 5 * 60 * 1000,
  '15M': 15 * 60 * 1000,
  '30M': 30 * 60 * 1000,
  '1H': 60 * 60 * 1000,
  '1D': 24 * 60 * 60 * 1000,
};

const TEN_YEARS_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const MAX_CANDLES = 5000;
function isTradingDay(date: Date): boolean {
  const day = date.getDay();
  return day !== 0 && day !== 6; // Skip Sundays (0) and Saturdays (6)
}

function generateTradingTimestamps(intervalMs: number, now: number): number[] {
  const timestamps: number[] = [];
  const startDate = new Date(now - TEN_YEARS_MS);
  startDate.setHours(0, 0, 0, 0);

  const endDate = new Date(now);
  endDate.setHours(23, 59, 59, 999);

  for (
    const day = new Date(startDate);
    day <= endDate;
    day.setDate(day.getDate() + 1)
  ) {
    if (!isTradingDay(day)) continue;

    if (intervalMs >= INTERVAL_TO_MS['1D']) {
      const sessionClose = new Date(day);
      sessionClose.setHours(15, 30, 0, 0);
      const ts = sessionClose.getTime();
      if (ts <= now) timestamps.push(ts);
      continue;
    }

    const sessionStart = new Date(day);
    sessionStart.setHours(9, 15, 0, 0);
    let currentTs = sessionStart.getTime();
    const sessionEnd = new Date(day);
    sessionEnd.setHours(15, 30, 0, 0);
    const sessionEndTs = sessionEnd.getTime();

    while (currentTs <= sessionEndTs && currentTs <= now) {
      timestamps.push(currentTs);
      currentTs += intervalMs;
    }
  }

  return timestamps;
}

function createRandomGenerator(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundToTwo(num: number): number {
  return Math.round(num * 100) / 100;
}

export async function fetchHistoricalCandleData(
  symbol: Tradingsymbol,
  params: HistoricalCandleReqParams,
): Promise<HistoricalCandleResp | undefined> {
  const intervalMs = INTERVAL_TO_MS[params.interval];

  if (!intervalMs) {
    console.warn(
      'Unsupported interval. Returning empty response.',
      params.interval,
    );
    return { candles: [] };
  }

  const now = Date.now();
  const timestamps = generateTradingTimestamps(intervalMs, now);
  if (timestamps.length === 0) {
    return { candles: [] };
  }

  const step = Math.max(1, Math.floor(timestamps.length / MAX_CANDLES));
  const random = createRandomGenerator(`${symbol}-${params.interval}-10y`);

  const candles: QuoteCandle[] = [];
  let lastClose = 100 + random() * 200;

  const selectedIndices: number[] = [];
  for (let i = 0; i < timestamps.length; i += step) {
    selectedIndices.push(i);
  }
  const lastIndex = timestamps.length - 1;
  if (selectedIndices[selectedIndices.length - 1] !== lastIndex) {
    selectedIndices.push(lastIndex);
  }

  let previousTs: number | null = null;

  for (const idx of selectedIndices) {
    const currentTs = timestamps[idx];
    const deltaMs = previousTs === null ? intervalMs : currentTs - previousTs;
    const timeScale = Math.max(1, deltaMs / intervalMs);
    const stepScale = Math.sqrt(timeScale);
    const driftFactor = (random() - 0.5) * 0.2;
    const volatility = Math.max(
      0.5,
      lastClose * (0.005 + random() * 0.02) * stepScale,
    );

    const open = roundToTwo(
      Math.max(1, lastClose + volatility * (random() - 0.5)),
    );
    const close = roundToTwo(
      Math.max(1, open + volatility * (random() - 0.5 + driftFactor)),
    );
    const high = roundToTwo(
      Math.max(open, close) + volatility * random() * 0.6,
    );
    const low = roundToTwo(
      Math.max(0.5, Math.min(open, close) - volatility * random() * 0.6),
    );
    const volume = Math.round(500 + random() * 2500 * stepScale);
    const oi = Math.round(100 + random() * 400);

    candles.push({
      ts: new Date(currentTs).toISOString(),
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      oi,
      volume,
    });

    lastClose = close;
    previousTs = currentTs;
  }

  if (params.skip_last_ts && candles.length > 0) {
    candles.pop();
  }

  return { candles };
}

// Example usage
/**

const data = await fetchHistoricalCandleData('NIFTY', {
  interval: '1D',
})

 */
