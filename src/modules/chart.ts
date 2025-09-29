// Chart rendering logic using PixiJS and D3
import { Application } from '@pixi/app';
import { Graphics } from '@pixi/graphics';
import { Text, TextStyle } from '@pixi/text';
import { Texture } from 'pixi.js';
import { DropShadowFilter } from '@pixi/filter-drop-shadow';
import * as d3 from 'd3';
import { subscribe, getState, setState } from './store';
import { prependOlderCandles, fetchInProgress } from './candlestickData';

// Crosshair state (module scope)
let crosshair = {
  x: null as number | null,
  y: null as number | null,
  candleIdx: null as number | null,
};

// Shared chart dimensions and margin (module scope)
let width = window.innerWidth;
let height = window.innerHeight;
const margin = { left: 20, right: 70, top: 20, bottom: 50 };

// Exported function to initialize the chart
export function initChart(container: HTMLElement) {
  // For zoom out speed/duration tracking
  let lastZoomTime = Date.now();
  let lastWindowSize = 50;
  let app: Application | null = null;
  let drawing = false;
  let startPoint: [number, number] | null = null;

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
  let centered = false;
  let isPanning = false;
  let panStartX = 0;
  let panStartWindow = 0;

  function triggerRender() {
    const state = getState();
    const data = state.data || [];
    if (!centered && windowSize > 0 && data.length > windowSize) {
      windowStart = Math.max(0, (data.length - windowSize) / 2);
      centered = true;
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
    const mouseX = e.clientX - rect.left;
    const mouseFrac =
      (mouseX - margin.left) / (rect.width - margin.left - margin.right);
    const oldSize = windowSize;
    const minSize = Math.min(10, data.length);
    const maxSize = data.length;
    windowSize = Math.max(
      minSize,
      Math.min(maxSize, windowSize * (e.deltaY > 0 ? 1.1 : 0.9)),
    );
    // Track the candle index under the mouse before zoom
    const candleIdxUnderMouse = windowStart + mouseFrac * oldSize;
    windowStart += (oldSize - windowSize) * mouseFrac;
    // Only fetch if the leftmost visible candle is missing and not already at the earliest candle
    let missingLeft = windowStart < 0 ? Math.abs(Math.floor(windowStart)) : 0;
    const stateData = getState().data;
    const earliestCandle = stateData[0];
    const earliestYear = earliestCandle
      ? new Date(earliestCandle.ts).getFullYear()
      : null;
    const atEarliest = earliestYear !== null && earliestYear <= 2018;
    // Calculate zoom out speed and duration
    let now = Date.now();
    let zoomSpeed = 1;
    if (windowSize > lastWindowSize) {
      // Only consider zooming out
      const sizeDelta = windowSize - lastWindowSize;
      const timeDelta = Math.max(1, now - lastZoomTime);
      zoomSpeed = sizeDelta / timeDelta; // candles per ms
    }
    lastZoomTime = now;
    lastWindowSize = windowSize;
    // Use a multiplier based on zoomSpeed (slow = 1.5, fast = up to 10)
    let multiplier = Math.min(10, 1.5 + zoomSpeed * 2000); // tune factor as needed
    if (missingLeft > 0 && !atEarliest && !fetchInProgress && windowStart < 0) {
      const moveRatio = windowSize > 0 ? missingLeft / windowSize : 1;
      const fetchCount = Math.max(1, Math.floor(moveRatio * windowSize));
      const cappedFetch = Math.min(fetchCount, missingLeft);
      prependOlderCandles(cappedFetch, multiplier).then(() => {
        // After data is prepended, adjust windowStart so the same candle stays under the cursor
        const newData = getState().data;
        const added = newData.length - data.length;
        // The candle that was under the mouse is now at index candleIdxUnderMouse + added
        windowStart = candleIdxUnderMouse + added - mouseFrac * windowSize;
        // Do NOT clamp windowStart; allow negative for infinite canvas
        triggerRender();
      });
    } else {
      // Do NOT clamp windowStart; allow negative for infinite canvas
      triggerRender();
    }
  });

  // Mouse drag for pan
  (app.view as HTMLCanvasElement).addEventListener('mousedown', event => {
    if (
      (event as MouseEvent).button === 1 ||
      ((event as MouseEvent).button === 0 && getState().tool === 'none')
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
      const chartWidth =
        (app.view as HTMLCanvasElement).width - margin.left - margin.right;
      const domainLen = data.length;
      const pxPerCandle = chartWidth / windowSize;
      let newWindowStart = panStartWindow - dx / pxPerCandle;
      // Only allow infinite pan left while data is still being fetched and not at earliest candle
      let missingLeft =
        newWindowStart < 0 ? Math.abs(Math.floor(newWindowStart)) : 0;
      // Find earliest candle timestamp (assume sorted ascending)
      const earliestCandle = data[0];
      const earliestYear = earliestCandle
        ? new Date(earliestCandle.ts).getFullYear()
        : null;
      const atEarliest = earliestYear !== null && earliestYear <= 2018;
      // Always allow infinite pan left/right, even if data is missing
      windowStart = newWindowStart;
      if (
        missingLeft > 0 &&
        !fetchInProgress &&
        !atEarliest &&
        newWindowStart < 0
      ) {
        // Fetch proportional to how much user moved left relative to visible range
        const moveRatio = windowSize > 0 ? missingLeft / windowSize : 1;
        // Fetch at least 1 day, at most missingLeft
        const fetchCount = Math.max(1, Math.floor(moveRatio * windowSize));
        const cappedFetch = Math.min(fetchCount, missingLeft);
        prependOlderCandles(cappedFetch).then(() => {
          // Do NOT clamp windowStart; allow negative for infinite canvas
          triggerRender();
        });
      } else {
        // Do NOT clamp windowStart; allow negative for infinite canvas
        triggerRender();
      }
    }
  });
  window.addEventListener('mouseup', () => {
    isPanning = false;
    (app.view as HTMLCanvasElement).style.cursor = '';
  });

  // Mouse event handlers for drawing tools
  (app.view as HTMLCanvasElement).addEventListener('mousedown', event => {
    const e = event as MouseEvent;
    const state = getState();
    if (state.tool === 'trendline' || state.tool === 'hline') {
      const rect = (app.view as HTMLCanvasElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (state.tool === 'trendline') {
        if (!drawing) {
          startPoint = [x, y];
          drawing = true;
          setState({ drawing: { type: 'trendline', points: [[x, y]] } });
        } else {
          // Finish trendline
          setState({
            shapes: [
              ...state.shapes,
              {
                type: 'trendline',
                points: [startPoint as [number, number], [x, y]],
              },
            ],
            drawing: null,
          });
          drawing = false;
          startPoint = null;
        }
      } else if (state.tool === 'hline') {
        setState({
          shapes: [...state.shapes, { type: 'hline', y }],
        });
      }
    }
  });

  (app.view as HTMLCanvasElement).addEventListener('mousemove', event => {
    // Crosshair logic
    const rect = (app.view as HTMLCanvasElement).getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    // use shared margin
    // Find the nearest candle index (center of band)
    const state = getState();
    const data = state.data || [];
    if (data.length > 0) {
      const windowSizeLocal = windowSize;
      const windowStartLocal = windowStart;
      const chartWidth =
        (app.view as HTMLCanvasElement).width - margin.left - margin.right;
      const xBand = chartWidth / windowSizeLocal;
      let idx = Math.round((mouseX - margin.left) / xBand + windowStartLocal);
      // Clamp idx to visible range
      if (idx < 0) idx = 0;
      if (idx >= data.length) idx = data.length - 1;
      // Find x pixel for center of this candle
      const xCandle = margin.left + (idx - windowStartLocal + 0.5) * xBand;
      crosshair = { x: xCandle, y: mouseY, candleIdx: idx };
      triggerRender();
    }
    // Hide crosshair on mouse up outside chart
    // crosshair.x = crosshair.y = crosshair.candleIdx = null;
    const e = event as MouseEvent;
    if (state.tool === 'trendline' && drawing && startPoint) {
      const x = mouseX;
      const y = mouseY;
      setState({
        drawing: { type: 'trendline', points: [startPoint, [x, y]] },
      });
    }
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
  // ...existing chart drawing code...

  // ...existing chart drawing code...

  // Draw crosshair (dotted lines) and OHLC if crosshair is active (must be after all chart variables are defined)
  if (
    typeof crosshair.x === 'number' &&
    typeof crosshair.y === 'number' &&
    typeof crosshair.candleIdx === 'number'
  ) {
    // Dotted vertical line (x, center of candle)
    const vLine = new Graphics();
    vLine.lineStyle({ width: 1, color: 0x888888, alpha: 0.7 });
    for (let yPos = margin.top; yPos < height - margin.bottom; yPos += 6) {
      vLine.moveTo(crosshair.x, yPos);
      vLine.lineTo(crosshair.x, yPos + 3);
    }
    app.stage.addChild(vLine);
    // Dotted horizontal line (y)
    const hLine = new Graphics();
    hLine.lineStyle({ width: 1, color: 0x888888, alpha: 0.7 });
    for (let xPos = margin.left; xPos < width - margin.right; xPos += 6) {
      hLine.moveTo(xPos, crosshair.y);
      hLine.lineTo(xPos + 3, crosshair.y);
    }
    app.stage.addChild(hLine);
    // Draw OHLC box at top (like TradingView)
    const d = state.data && state.data[crosshair.candleIdx];
    if (d) {
      const ohlcStr = `O ${d.open}  H ${d.high}  L ${d.low}  C ${d.close}`;
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

  if (
    typeof crosshair.x === 'number' &&
    typeof crosshair.y === 'number' &&
    typeof crosshair.candleIdx === 'number'
  ) {
    // Dotted vertical line (x, center of candle)
    const vLine = new Graphics();
    vLine.lineStyle({ width: 1, color: 0x888888, alpha: 0.7 });
    for (let yPos = margin.top; yPos < height - margin.bottom; yPos += 6) {
      vLine.moveTo(crosshair.x, yPos);
      vLine.lineTo(crosshair.x, yPos + 3);
    }
    app.stage.addChild(vLine);
    // Dotted horizontal line (y)
    const hLine = new Graphics();
    hLine.lineStyle({ width: 1, color: 0x888888, alpha: 0.7 });
    for (let xPos = margin.left; xPos < width - margin.right; xPos += 6) {
      hLine.moveTo(xPos, crosshair.y);
      hLine.lineTo(xPos + 3, crosshair.y);
    }
    app.stage.addChild(hLine);
    // Draw OHLC box at top (like TradingView)
    const d = state.data && state.data[crosshair.candleIdx];
    if (d) {
      const ohlcStr = `O ${d.open}  H ${d.high}  L ${d.low}  C ${d.close}`;
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
  if (!app) return;
  app.stage.removeChildren();
  // width, height, and margin declared here only

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
  const domain = data.map(d => d.ts);
  // Allow windowStart to be negative (scroll beyond data)
  windowSize = Math.max(5, windowSize);
  // If windowStart < 0, show empty space for missing candles
  const startIdx = Math.floor(windowStart);
  const endIdx = Math.ceil(windowStart + windowSize);
  // Build visibleDomain: pad with nulls for missing candles
  const visibleDomain: (number | null)[] = [];
  const visibleData: typeof data = [];
  for (let i = startIdx; i < endIdx; ++i) {
    if (i < 0 || i >= domain.length) {
      visibleDomain.push(null); // empty slot
      visibleData.push(null);
    } else {
      visibleDomain.push(domain[i]);
      visibleData.push(data[i]);
    }
  }
  // Helper: check if visibleDomain covers multiple days
  function visibleCoversMultipleDays(): boolean {
    if (visibleDomain.length < 2) return false;
    const first = new Date(visibleDomain[0]);
    const last = new Date(visibleDomain[visibleDomain.length - 1]);
    return (
      first.getFullYear() !== last.getFullYear() ||
      first.getMonth() !== last.getMonth() ||
      first.getDate() !== last.getDate()
    );
  }
  const x = d3
    .scaleBand()
    .domain(visibleDomain.map((d, i) => i.toString()))
    .range([margin.left, width - margin.right])
    .padding(0.3);
  // Y scale: price
  // Only use visible candles for y scale
  const visibleCandles = visibleData.filter(
    (d): d is { low: number; high: number } => !!d,
  );
  const y = d3
    .scaleLinear()
    .domain([
      visibleCandles.length > 0 ? d3.min(visibleCandles, d => d.low) ?? 0 : 0,
      visibleCandles.length > 0 ? d3.max(visibleCandles, d => d.high) ?? 1 : 1,
    ])
    .nice()
    .range([height - margin.bottom, margin.top]);

  // Draw Y axis bar (right)
  const yAxisBar = new Graphics();
  yAxisBar.beginFill(0x23272f);
  yAxisBar.drawRect(
    width - margin.right,
    margin.top,
    margin.right,
    height - margin.top - margin.bottom,
  );
  yAxisBar.endFill();
  app.stage.addChild(yAxisBar);
  // Draw Y axis bar (right) with rounded corners and gradient
  const yCanvas = document.createElement('canvas');
  yCanvas.width = 1;
  yCanvas.height = 100;
  const yCtx = yCanvas.getContext('2d');
  if (yCtx) {
    const grad = yCtx.createLinearGradient(0, 0, 0, 100);
    grad.addColorStop(0, '#23272f');
    grad.addColorStop(1, '#181a20');
    yCtx.fillStyle = grad;
    yCtx.fillRect(0, 0, 1, 100);
    yAxisBar.beginTextureFill({
      texture: Texture.from(yCanvas) as any,
    });
    yAxisBar.drawRoundedRect(
      width - margin.right,
      margin.top,
      margin.right,
      height - margin.top - margin.bottom,
      12,
    );
    yAxisBar.endFill();
    yAxisBar.alpha = 0.98;
    yAxisBar.filters = [
      new DropShadowFilter({
        color: 0x000000,
        alpha: 0.3,
        blur: 6,
        distance: 2,
        rotation: 90,
      }),
    ];
    app.stage.addChild(yAxisBar);
  }
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
  xAxisBar.beginFill(0x23272f);
  xAxisBar.drawRect(
    margin.left,
    height - margin.bottom,
    width - margin.left - margin.right,
    margin.bottom,
  );
  xAxisBar.endFill();
  app.stage.addChild(xAxisBar);
  // Draw X axis bar (bottom) with rounded corners and gradient
  const xCanvas = document.createElement('canvas');
  xCanvas.width = 200;
  xCanvas.height = 1;
  const xCtx = xCanvas.getContext('2d');
  if (xCtx) {
    const grad = xCtx.createLinearGradient(0, 0, 200, 0);
    grad.addColorStop(0, '#23272f');
    grad.addColorStop(1, '#181a20');
    xCtx.fillStyle = grad;
    xCtx.fillRect(0, 0, 200, 1);
    xAxisBar.beginTextureFill({
      texture: Texture.from(xCanvas) as any,
    });
    xAxisBar.drawRoundedRect(
      margin.left,
      height - margin.bottom,
      width - margin.left - margin.right,
      margin.bottom,
      12,
    );
    xAxisBar.endFill();
    xAxisBar.alpha = 0.98;
    xAxisBar.filters = [
      new DropShadowFilter({
        color: 0x000000,
        alpha: 0.3,
        blur: 6,
        distance: 2,
        rotation: 270,
      }),
    ];
    app.stage.addChild(xAxisBar);
  }
  // Draw X axis (date) labels
  // Calculate number of X ticks based on available space (min 80px per label)
  const xTickCount = Math.max(
    4,
    Math.floor((width - margin.left - margin.right) / 300),
  );
  // Only use valid (non-null) visibleDomain values for ticks
  const validTicks = visibleDomain
    .map((ts, i) => (ts ? { ts, i } : null))
    .filter(Boolean) as { ts: number; i: number }[];
  const xTickStep = Math.max(1, Math.floor(validTicks.length / xTickCount));
  for (let t = 0; t < validTicks.length; t += xTickStep) {
    const { ts, i } = validTicks[t];
    const xPos = x(i.toString());
    if (xPos === undefined) continue;
    // Draw grid line
    const grid = new Graphics();
    grid
      .lineStyle({ width: 1, color: 0x22262c, alpha: 0.7 })
      .moveTo(xPos + x.bandwidth() / 2, margin.top)
      .lineTo(xPos + x.bandwidth() / 2, height - margin.bottom);
    app.stage.addChild(grid);
    // Draw label
    const date = new Date(ts);
    let labelStr = '';
    if (data.length > 0) {
      const tf = (state.timeframe || '').toLowerCase();
      const isIntraday = tf.includes('min') || tf.includes('hour');
      const multiDay = visibleCoversMultipleDays();
      if (multiDay) {
        labelStr =
          date.toLocaleDateString([], {
            day: '2-digit',
            month: '2-digit',
            year: '2-digit',
          }) +
          ' ' +
          date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          });
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
    label.anchor = { x: 0.5, y: 0 } as any;
    label.x = xPos + x.bandwidth() / 2;
    label.y = height - margin.bottom + 12;
    app.stage.addChild(label);
  }

  // Draw candlesticks (only for visibleDomain slots with data)
  visibleDomain.forEach((ts, i) => {
    const d = visibleData[i];
    if (!ts || !d) return; // empty slot, no candle
    const xPos = x(i.toString());
    if (xPos === undefined) return;
    const candleWidth = x.bandwidth();
    const color = d.close >= d.open ? 0x4caf50 : 0xf44336;

    // Calculate visible price range for current window (only valid data)
    const visiblePrices = visibleData
      .filter((datum): datum is { low: number; high: number } => !!datum)
      .map(datum => [datum.low, datum.high])
      .flat();
    const minVisible = Math.min(...visiblePrices);
    const maxVisible = Math.max(...visiblePrices);
    const visibleRange = Math.abs(y(minVisible) - y(maxVisible));
    // Set a minimum candle height as a fraction of visible range
    const minCandleFrac = 0.04; // 4% of visible range
    const minCandleHeight = Math.max(2, visibleRange * minCandleFrac);

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
  });
  // Draw user shapes (trendlines, hlines)
  [...(state.shapes || []), ...(state.drawing ? [state.drawing] : [])].forEach(
    shape => {
      if (shape.type === 'trendline' && shape.points.length === 2) {
        const [p1, p2] = shape.points;
        const g = new Graphics();
        g.lineStyle({ width: 2, color: 0xffd600 });
        g.moveTo(p1[0], p1[1]);
        g.lineTo(p2[0], p2[1]);
        app.stage.addChild(g);
      } else if (shape.type === 'hline') {
        const g = new Graphics();
        g.lineStyle({ width: 2, color: 0x00bcd4 });
        g.moveTo(0, shape.y);
        g.lineTo(width, shape.y);
        app.stage.addChild(g);
      }
    },
  );
}
