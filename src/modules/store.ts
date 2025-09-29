// Simple state management for the charting app

import type { QuoteCandle } from '../api/historicalQuotes';

export type DrawShape =
  | { type: 'trendline'; points: [number, number][] }
  | { type: 'hline'; y: number };

export type State = {
  underlying: 'NIFTY' | 'BANKNIFTY';
  timeframe: '1m' | '5m' | '1h' | '1d';
  loading: boolean;
  error: string | null;
  data: QuoteCandle[];
  tool: 'none' | 'trendline' | 'hline';
  shapes: DrawShape[];
  drawing: DrawShape | null;
};

const listeners: Array<(state: State) => void> = [];

let state: State = {
  underlying: 'NIFTY',
  timeframe: '1m',
  loading: false,
  error: null,
  data: [],
  tool: 'none',
  shapes: [],
  drawing: null,
};

export function getState() {
  return state;
}

export function setState(partial: Partial<State>) {
  state = { ...state, ...partial };
  listeners.forEach(cb => {
    cb(state);
  });
}

export function subscribe(cb: (state: State) => void) {
  listeners.push(cb);
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx > -1) listeners.splice(idx, 1);
  };
}
