// Chart rendering logic using PixiJS and D3
import { Application } from '@pixi/app';
import { Graphics } from '@pixi/graphics';
import { Text, TextStyle } from '@pixi/text';
import { DropShadowFilter } from '@pixi/filter-drop-shadow';
import * as d3 from 'd3';
import { subscribe, getState } from './store';
import type { QuoteCandle } from '../api/historicalQuotes';

// Crosshair state (module scope)
let crosshair = {
  x: null as number | null,
  y: null as number | null,
  candleIdx: null as number | null,
};

type VisibleCenter = {
  idx: number;
  centerX: number;
  left: number;
  right: number;
};

let currentVisibleCenters: VisibleCenter[] = [];

// Shared chart dimensions and margin (module scope)
const width = window.innerWidth;
const height = window.innerHeight;
const margin = { left: 20, right: 70, top: 20, bottom: 50 };

const SMA_PERIOD = 20;
let cachedSmaSource: QuoteCandle[] | null = null;
let cachedSmaValues: Array<number | null> = [];

type Point = { x: number; y: number };

function drawSmoothCurve(
  graphics: Graphics,
  points: Point[],
  smoothing = 0.75,
) {
  if (points.length === 0) return;
  if (points.length === 1) {
    graphics.moveTo(points[0].x, points[0].y);
    graphics.lineTo(points[0].x, points[0].y);
    return;
  }

  graphics.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? points[i + 1];

    const cp1x = p1.x + ((p2.x - p0.x) * smoothing) / 6;
    const cp1y = p1.y + ((p2.y - p0.y) * smoothing) / 6;
    const cp2x = p2.x - ((p3.x - p1.x) * smoothing) / 6;
    const cp2y = p2.y - ((p3.y - p1.y) * smoothing) / 6;

    graphics.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

function computeSma(data: QuoteCandle[], period: number): Array<number | null> {
  if (!data.length) return [];
  const result: Array<number | null> = new Array(data.length).fill(null);
  if (period <= 1) {
    data.forEach((candle, idx) => {
      result[idx] = candle.close;
    });
    return result;
  }
  let rollingSum = 0;
  for (let idx = 0; idx < data.length; idx += 1) {
    rollingSum += data[idx].close;
    if (idx >= period) {
      rollingSum -= data[idx - period].close;
    }
    if (idx >= period - 1) {
      result[idx] = rollingSum / period;
    }
  }
  return result;
}

function getSmaValues(data: QuoteCandle[]): Array<number | null> {
  if (cachedSmaSource === data) {
    return cachedSmaValues;
  }
  cachedSmaValues = computeSma(data, SMA_PERIOD);
  cachedSmaSource = data;
  return cachedSmaValues;
}

// Exported function to initialize the chart
export function initChart(container: HTMLElement) {
  let app: Application | null = null;

  // Make chart full screen
  // Prevent page scroll and overflow
  document.body.style.margin = '0';
  document.body.style.overflow = 'hidden';
  container.style.width = '100vw';
  container.style.height = '100vh';
  container.style.overflow = 'hidden';
  container.style.position = 'relative';
  container.style.background = '#181a20';
  container.style.left = '';
  container.style.top = '';

  function resizeApp() {
    if (!app) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    app.renderer.resize(w, h);
    (app.view as HTMLCanvasElement).style.width = w + 'px';
    (app.view as HTMLCanvasElement).style.height = h + 'px';
    triggerRender();
  }
  app = new Application({
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: 0x181a20,
  });
  (app.view as HTMLCanvasElement).style.display = 'block';
  (app.view as HTMLCanvasElement).style.width = '100vw';
  (app.view as HTMLCanvasElement).style.height = '100vh';
  (app.view as HTMLCanvasElement).style.position = 'absolute';
  (app.view as HTMLCanvasElement).style.top = '0';
  (app.view as HTMLCanvasElement).style.left = '0';
  (app.view as HTMLCanvasElement).style.zIndex = '0';
  container.appendChild(app.view as HTMLCanvasElement);
  window.addEventListener('resize', resizeApp);

  // Zoom and pan state
  let windowStart = 0; // float, 0 = leftmost candle
  let windowSize = 50; // number of candles visible
  let lastDataRef: QuoteCandle[] | null = null;
  let isPanning = false;
  let panStartX = 0;
  let panStartWindow = 0;

  function triggerRender() {
    const state = getState();
    const data = state.data || [];
    if (state.data !== lastDataRef) {
      lastDataRef = state.data;
      windowStart = Math.max(0, data.length - windowSize);
    }
    renderChart(state, windowStart, windowSize, app);
  }

  subscribe(() => triggerRender());
  triggerRender();

  // Mouse wheel for zoom (centered on mouse)
  (app.view as HTMLCanvasElement).addEventListener('wheel', e => {
    e.preventDefault();
    const state = getState();
    const data = state.data;
    if (!data.length) return;
    const rect = (app.view as HTMLCanvasElement).getBoundingClientRect();
    const chartWidth = Math.max(1, rect.width - margin.left - margin.right);
    const mouseX = e.clientX - rect.left;
    const mouseFrac = Math.min(
      1,
      Math.max(0, (mouseX - margin.left) / chartWidth),
    );
    const oldSize = windowSize;
    const minSize = Math.min(10, data.length);
    const maxSize = data.length;
    windowSize = Math.max(
      minSize,
      Math.min(maxSize, windowSize * (e.deltaY > 0 ? 1.1 : 0.9)),
    );
    const candleIdxUnderMouse = windowStart + mouseFrac * oldSize;
    windowStart += (oldSize - windowSize) * mouseFrac;
    const maxStart = Math.max(0, data.length - windowSize);
    if (!Number.isFinite(windowStart)) {
      windowStart = 0;
    }
    windowStart = Math.max(0, Math.min(windowStart, maxStart));
    if (Number.isFinite(candleIdxUnderMouse)) {
      const clampedIdx = Math.max(
        0,
        Math.min(data.length - 1, candleIdxUnderMouse),
      );
      const targetStart = clampedIdx - mouseFrac * windowSize;
      windowStart = Math.max(0, Math.min(targetStart, maxStart));
    }
    triggerRender();
  });

  // Mouse drag for pan
  (app.view as HTMLCanvasElement).addEventListener('mousedown', event => {
    if (
      (event as MouseEvent).button === 1 ||
      (event as MouseEvent).button === 0
    ) {
      isPanning = true;
      panStartX = (event as MouseEvent).clientX;
      panStartWindow = windowStart;
      (app.view as HTMLCanvasElement).style.cursor = 'grabbing';
    }
  });
  window.addEventListener('mousemove', event => {
    if (isPanning) {
      const state = getState();
      const data = state.data;
      if (!data.length) return;
      const dx = (event as MouseEvent).clientX - panStartX;
      const chartWidth = Math.max(
        1,
        (app.view as HTMLCanvasElement).width - margin.left - margin.right,
      );
      const pxPerCandle = chartWidth / Math.max(1, windowSize);
      const newWindowStart = panStartWindow - dx / pxPerCandle;
      const maxStart = Math.max(0, data.length - windowSize);
      windowStart = Math.max(0, Math.min(newWindowStart, maxStart));
      triggerRender();
    }
  });
  window.addEventListener('mouseup', () => {
    isPanning = false;
    (app.view as HTMLCanvasElement).style.cursor = '';
  });

  (app.view as HTMLCanvasElement).addEventListener('mousemove', event => {
    // Crosshair logic
    const rect = (app.view as HTMLCanvasElement).getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const state = getState();
    const data = state.data || [];
    const chartLeft = margin.left;
    const chartRight = width - margin.right;
    if (
      data.length > 0 &&
      currentVisibleCenters.length > 0 &&
      mouseX >= chartLeft - 10 &&
      mouseX <= chartRight + 10
    ) {
      let nearest: VisibleCenter | null = null;
      let nearestDist = Number.POSITIVE_INFINITY;
      for (const center of currentVisibleCenters) {
        const dist = Math.abs(center.centerX - mouseX);
        if (dist < nearestDist) {
          nearest = center;
          nearestDist = dist;
        }
      }
      if (nearest) {
        const clampedY = Math.max(
          margin.top,
          Math.min(mouseY, height - margin.bottom),
        );
        crosshair = {
          x: nearest.centerX,
          y: clampedY,
          candleIdx: Math.max(0, Math.min(data.length - 1, nearest.idx)),
        };
        triggerRender();
      }
    }
    // Hide crosshair on mouse up outside chart
    // crosshair.x = crosshair.y = crosshair.candleIdx = null;
  });

  return app;
}

function renderChart(
  state: ReturnType<typeof getState>,
  windowStart = 0,
  windowSize = 50,
  app?: Application | null,
) {
  if (!app) return;
  app.stage.removeChildren();
  currentVisibleCenters = [];
  const crosshairActive =
    typeof crosshair.x === 'number' &&
    typeof crosshair.y === 'number' &&
    typeof crosshair.candleIdx === 'number';

  if (state.loading) {
    const loadingText = new Text(
      'Loading...',
      new TextStyle({ fill: 0xffffff, fontSize: 16 }),
    );
    loadingText.x = width / 2 - 40;
    loadingText.y = height / 2 - 10;
    app.stage.addChild(loadingText);
    return;
  }
  if (state.error) {
    const errorText = new Text(
      'Error: ' + state.error,
      new TextStyle({ fill: 0xff5555, fontSize: 16 }),
    );
    errorText.x = width / 2 - 60;
    errorText.y = height / 2 - 10;
    app.stage.addChild(errorText);
    return;
  }
  if (!state.data || state.data.length === 0) {
    const noDataText = new Text(
      'No data',
      new TextStyle({ fill: 0xffffff, fontSize: 16 }),
    );
    noDataText.x = width / 2 - 30;
    noDataText.y = height / 2 - 10;
    app.stage.addChild(noDataText);
    return;
  }

  // Prepare data
  const data = state.data;
  const movingAverage = getSmaValues(data);
  const domain = data.map(d => d.ts);
  // Allow windowStart to be negative (scroll beyond data)
  windowSize = Math.max(5, windowSize);
  // If windowStart < 0, show empty space for missing candles
  const startIdx = Math.floor(windowStart);
  const endIdx = Math.ceil(windowStart + windowSize);
  // Build visibleDomain: pad with nulls for missing candles
  const visibleDomain: Array<QuoteCandle['ts'] | null> = [];
  const visibleData: Array<QuoteCandle | undefined> = [];
  for (let i = startIdx; i < endIdx; ++i) {
    if (i < 0 || i >= domain.length) {
      // empty slot, mark as null and undefined for candle
      visibleDomain.push(null);
      visibleData.push(undefined);
    } else {
      visibleDomain.push(domain[i]);
      visibleData.push(data[i]);
    }
  }
  // Helper: check if visibleDomain covers multiple days
  function visibleCoversMultipleDays(): boolean {
    const firstTs = visibleDomain.find(
      (ts): ts is QuoteCandle['ts'] => ts !== null,
    );
    const lastTs = [...visibleDomain]
      .reverse()
      .find((ts): ts is QuoteCandle['ts'] => ts !== null);
    if (!firstTs || !lastTs) return false;
    const first = new Date(firstTs);
    const last = new Date(lastTs);
    return (
      first.getFullYear() !== last.getFullYear() ||
      first.getMonth() !== last.getMonth() ||
      first.getDate() !== last.getDate()
    );
  }
  const x = d3
    .scaleBand()
    .domain(visibleDomain.map((_, i) => i.toString()))
    .range([margin.left, width - margin.right])
    .padding(0.3);
  // Y scale: price
  // Only use visible candles for y scale
  const visibleCandles = visibleData.filter(
    (d): d is QuoteCandle => d !== undefined,
  );
  const y = d3
    .scaleLinear()
    .domain([
      visibleCandles.length > 0 ? d3.min(visibleCandles, d => d.low) ?? 0 : 0,
      visibleCandles.length > 0 ? d3.max(visibleCandles, d => d.high) ?? 1 : 1,
    ])
    .nice()
    .range([height - margin.bottom, margin.top]);

  const visiblePrices = visibleCandles.flatMap(candle => [
    candle.low,
    candle.high,
  ]);
  const minVisible = visiblePrices.length ? Math.min(...visiblePrices) : 0;
  const maxVisible = visiblePrices.length ? Math.max(...visiblePrices) : 1;
  const visibleRangePx = Math.abs(y(minVisible) - y(maxVisible));

  // Draw Y axis bar (right)
  const yAxisBar = new Graphics();
  yAxisBar.beginFill(0x23272f, 0.98);
  yAxisBar.drawRoundedRect(
    width - margin.right,
    margin.top,
    margin.right,
    height - margin.top - margin.bottom,
    12,
  );
  yAxisBar.endFill();
  yAxisBar.filters = [
    new DropShadowFilter({
      color: 0x000000,
      alpha: 0.25,
      blur: 6,
      distance: 2,
      rotation: 90,
    }),
  ];
  app.stage.addChild(yAxisBar);
  // Draw Y axis (price) labels
  // Calculate number of Y ticks based on available space (min 30px per label)
  const yTickCount = Math.max(
    4,
    Math.floor((height - margin.top - margin.bottom) / 50),
  );
  const yTicks = y.ticks(yTickCount);
  yTicks.forEach(price => {
    const yPos = y(price);
    // Draw grid line
    const grid = new Graphics();
    grid
      .lineStyle({ width: 1, color: 0x22262c, alpha: 0.7 })
      .moveTo(margin.left, yPos)
      .lineTo(width - margin.right, yPos);
    app.stage.addChild(grid);
    // Draw Y axis label
    const label = new Text(
      price.toFixed(2),
      new TextStyle({
        fill: 0xffffff,
        fontSize: 11,
        fontWeight: 'bold',
        fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
        dropShadow: true,
        dropShadowColor: '#000',
        dropShadowBlur: 4,
        dropShadowAlpha: 0.4,
        letterSpacing: 1.2,
        padding: 4,
      }),
    );
    label.x = width - margin.right + 16;
    label.y = yPos - 14;
    app.stage.addChild(label);
  });

  // Draw X axis bar (bottom)
  const xAxisBar = new Graphics();
  xAxisBar.beginFill(0x23272f, 0.98);
  xAxisBar.drawRoundedRect(
    margin.left,
    height - margin.bottom,
    width - margin.left - margin.right,
    margin.bottom,
    12,
  );
  xAxisBar.endFill();
  xAxisBar.filters = [
    new DropShadowFilter({
      color: 0x000000,
      alpha: 0.25,
      blur: 6,
      distance: 2,
      rotation: 270,
    }),
  ];
  app.stage.addChild(xAxisBar);
  // Draw X axis (date) labels
  const timeframe = state.timeframe;
  const baseSpacing =
    timeframe === '1d'
      ? 160
      : timeframe === '1h'
      ? 120
      : timeframe === '5m'
      ? 100
      : 80;
  const validTicks = visibleDomain
    .map((ts, i) => (ts ? { ts, i } : null))
    .filter(
      (entry): entry is { ts: QuoteCandle['ts']; i: number } => entry !== null,
    );
  const scaleStep =
    typeof (x as { step?: () => number }).step === 'function'
      ? (x as { step: () => number }).step()
      : x.bandwidth();
  const minLabelSpacing = Math.max(baseSpacing, scaleStep * 1.5);
  type TickRender = { ts: QuoteCandle['ts']; i: number; centerX: number };
  const ticksToRender: TickRender[] = [];
  validTicks.forEach((entry, idx) => {
    const xPos = x(entry.i.toString());
    if (xPos === undefined) return;
    const centerX = xPos + x.bandwidth() / 2;
    const isFirst = ticksToRender.length === 0;
    const lastTick = ticksToRender[ticksToRender.length - 1];
    if (isFirst || centerX - lastTick.centerX >= minLabelSpacing) {
      ticksToRender.push({ ...entry, centerX });
      return;
    }
    const isLast = idx === validTicks.length - 1;
    if (isLast) {
      ticksToRender[ticksToRender.length - 1] = { ...entry, centerX };
    }
  });

  ticksToRender.forEach(({ ts, centerX }) => {
    const grid = new Graphics();
    grid
      .lineStyle({ width: 1, color: 0x22262c, alpha: 0.7 })
      .moveTo(centerX, margin.top)
      .lineTo(centerX, height - margin.bottom);
    app.stage.addChild(grid);

    const date = new Date(ts);
    let labelStr = '';
    if (data.length > 0) {
      const tf = (timeframe || '').toLowerCase();
      const isIntraday = tf.endsWith('m') || tf.endsWith('h');
      const multiDay = visibleCoversMultipleDays();
      if (multiDay) {
        labelStr = `${date.toLocaleDateString([], {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
        })} ${date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}`;
      } else if (isIntraday) {
        labelStr = date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      } else {
        labelStr = date.toLocaleDateString([], {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
        });
      }
    }

    const label = new Text(
      labelStr,
      new TextStyle({
        fill: 0xffffff,
        fontSize: 11,
        fontWeight: 'bold',
        fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
        dropShadow: true,
        dropShadowColor: '#000',
        dropShadowBlur: 4,
        dropShadowAlpha: 0.4,
        letterSpacing: 1.2,
        padding: 4,
      }),
    );
    label.anchor.set(0.5, 0);
    label.x = centerX;
    label.y = height - margin.bottom + 12;
    app.stage.addChild(label);
  });

  // Draw candlesticks (only for visibleDomain slots with data)
  visibleDomain.forEach((ts, i) => {
    const d = visibleData[i];
    if (!ts || !d) return; // empty slot, no candle
    const xPos = x(i.toString());
    if (xPos === undefined) return;
    const candleWidth = x.bandwidth();
    const color = d.close >= d.open ? 0x4caf50 : 0xf44336;
    const actualIdx = startIdx + i;

    // Set a minimum candle height as a fraction of visible range
    const minCandleFrac = 0.04; // 4% of visible range
    const minCandleHeight = Math.max(2, visibleRangePx * minCandleFrac);

    // Wick
    const wick = new Graphics();
    let wickY1 = y(d.high);
    let wickY2 = y(d.low);
    if (Math.abs(wickY1 - wickY2) < minCandleHeight) {
      const center = (wickY1 + wickY2) / 2;
      wickY1 = center - minCandleHeight / 2;
      wickY2 = center + minCandleHeight / 2;
    }
    wick
      .lineStyle({ width: 1, color })
      .moveTo(xPos + candleWidth / 2, wickY1)
      .lineTo(xPos + candleWidth / 2, wickY2);
    app.stage.addChild(wick);
    // Body
    const body = new Graphics();
    let bodyY = y(Math.max(d.open, d.close));
    let bodyHeight = Math.abs(y(d.open) - y(d.close));
    if (bodyHeight < minCandleHeight) {
      bodyY = y((d.open + d.close) / 2) - minCandleHeight / 2;
      bodyHeight = minCandleHeight;
    }
    body
      .beginFill(color)
      .drawRect(xPos, bodyY, candleWidth, bodyHeight)
      .endFill();
    app.stage.addChild(body);

    currentVisibleCenters.push({
      idx: actualIdx,
      centerX: xPos + candleWidth / 2,
      left: xPos,
      right: xPos + candleWidth,
    });
  });

  if (movingAverage.length) {
    type MaPoint = { defined: boolean; x: number; y: number };
    const maPoints: MaPoint[] = visibleDomain.map((ts, i) => {
      const actualIdx = startIdx + i;
      if (!ts || actualIdx < 0 || actualIdx >= movingAverage.length) {
        return { defined: false, x: 0, y: 0 };
      }
      const maValue = movingAverage[actualIdx];
      const candle = visibleData[i];
      if (maValue === null || maValue === undefined || !candle) {
        return { defined: false, x: 0, y: 0 };
      }
      const xPos = x(i.toString());
      if (xPos === undefined) {
        return { defined: false, x: 0, y: 0 };
      }
      const centerX = xPos + x.bandwidth() / 2;
      const yPos = y(maValue);
      if (!Number.isFinite(yPos)) {
        return { defined: false, x: 0, y: 0 };
      }
      return { defined: true, x: centerX, y: yPos };
    });
    if (maPoints.some(point => point.defined)) {
      const segments: Point[][] = [];
      let current: Point[] = [];
      maPoints.forEach(point => {
        if (!point.defined) {
          if (current.length) {
            segments.push(current);
            current = [];
          }
          return;
        }
        current.push({ x: point.x, y: point.y });
      });
      if (current.length) {
        segments.push(current);
      }

      segments.forEach(segment => {
        if (segment.length < 2) return;
        const maLine = new Graphics();
        maLine.lineStyle({ width: 2, color: 0xffc107, alpha: 0.92 });
        drawSmoothCurve(maLine, segment, 0.85);
        app.stage.addChild(maLine);
      });
    }

    let latestMaValue: number | null = null;
    for (let idx = movingAverage.length - 1; idx >= 0; idx -= 1) {
      const val = movingAverage[idx];
      if (val !== null && val !== undefined && Number.isFinite(val)) {
        latestMaValue = val;
        break;
      }
    }
    if (latestMaValue !== null) {
      const maBadge = new Text(
        `MA${SMA_PERIOD} ${latestMaValue.toFixed(2)}`,
        new TextStyle({
          fill: 0xffc107,
          fontSize: 13,
          fontWeight: 'bold',
          fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
          dropShadow: true,
          dropShadowColor: '#000',
          dropShadowBlur: 4,
          dropShadowAlpha: 0.4,
          letterSpacing: 1,
          padding: 4,
        }),
      );
      maBadge.x = margin.left + 12;
      maBadge.y = margin.top + 12;
      app.stage.addChild(maBadge);
    }
  }
  // Draw crosshair last so it sits atop all geometry
  if (crosshairActive) {
    const vLine = new Graphics();
    vLine.lineStyle({ width: 1, color: 0x888888, alpha: 0.7 });
    for (let yPos = margin.top; yPos < height - margin.bottom; yPos += 6) {
      vLine.moveTo(crosshair.x as number, yPos);
      vLine.lineTo(crosshair.x as number, yPos + 3);
    }
    app.stage.addChild(vLine);

    const hLine = new Graphics();
    hLine.lineStyle({ width: 1, color: 0x888888, alpha: 0.7 });
    for (let xPos = margin.left; xPos < width - margin.right; xPos += 6) {
      hLine.moveTo(xPos, crosshair.y as number);
      hLine.lineTo(xPos + 3, crosshair.y as number);
    }
    app.stage.addChild(hLine);

    const d = state.data?.[crosshair.candleIdx as number];
    if (d) {
      const idx = crosshair.candleIdx as number;
      const maValue =
        idx >= 0 && idx < movingAverage.length ? movingAverage[idx] : null;
      const maInfo =
        maValue !== null && maValue !== undefined
          ? `  MA${SMA_PERIOD} ${maValue.toFixed(2)}`
          : '';
      const ohlcStr = `O ${d.open}  H ${d.high}  L ${d.low}  C ${d.close}${maInfo}`;
      const ohlcText = new Text(
        ohlcStr,
        new TextStyle({
          fill: 0xffffff,
          fontSize: 14,
          fontWeight: 'bold',
          fontFamily: 'Inter, Segoe UI, Arial, sans-serif',
          dropShadow: true,
          dropShadowColor: '#000',
          dropShadowBlur: 4,
          dropShadowAlpha: 0.4,
          letterSpacing: 1.2,
          padding: 4,
        }),
      );
      ohlcText.x = margin.left + 10;
      ohlcText.y = margin.top - 10;
      app.stage.addChild(ohlcText);
    }
  }
}
