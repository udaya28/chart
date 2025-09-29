// Simple UI controls for switching underlying, timeframe, and drawing tools
import { setState, getState, subscribe } from './store';
import { loadCandlestickData } from './candlestickData';

export function initUI(container: HTMLElement) {
  container.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;">
      <select id="underlying">
        <option value="NIFTY">NIFTY</option>
        <option value="BANKNIFTY">BANKNIFTY</option>
      </select>
      <select id="timeframe">
        <option value="1m">1 min</option>
        <option value="5m">5 min</option>
        <option value="1h">1 hour</option>
        <option value="1d">Daily</option>
      </select>
      <select id="tool">
        <option value="none">Select Tool</option>
        <option value="trendline">Trendline</option>
        <option value="hline">Horizontal Line</option>
      </select>
      <button id="reload">Reload</button>
      <span id="status"></span>
    </div>
  `;
  const underlying = container.querySelector(
    '#underlying',
  ) as HTMLSelectElement;
  const timeframe = container.querySelector('#timeframe') as HTMLSelectElement;
  const tool = container.querySelector('#tool') as HTMLSelectElement;
  const reload = container.querySelector('#reload') as HTMLButtonElement;
  const status = container.querySelector('#status') as HTMLSpanElement;

  // Restore form state from localStorage if available
  const savedForm = localStorage.getItem('chartFormState');
  if (savedForm) {
    try {
      const { underlying: u, timeframe: tf, tool: t } = JSON.parse(savedForm);
      if (u) underlying.value = u;
      if (tf) timeframe.value = tf;
      if (t) tool.value = t;
      setState({
        underlying: underlying.value as 'NIFTY' | 'BANKNIFTY',
        timeframe: timeframe.value as '1m' | '5m' | '1h' | '1d',
        tool: tool.value as 'none' | 'trendline' | 'hline',
      });
    } catch {}
  } else {
    underlying.value = getState().underlying;
    timeframe.value = getState().timeframe;
    tool.value = getState().tool;
  }

  function saveFormState() {
    localStorage.setItem(
      'chartFormState',
      JSON.stringify({
        underlying: underlying.value,
        timeframe: timeframe.value,
        tool: tool.value,
      }),
    );
  }
  underlying.onchange = () => {
    setState({ underlying: underlying.value as 'NIFTY' | 'BANKNIFTY' });
    saveFormState();
    loadCandlestickData();
  };
  timeframe.onchange = () => {
    setState({ timeframe: timeframe.value as '1m' | '5m' | '1h' | '1d' });
    saveFormState();
    loadCandlestickData();
  };
  tool.onchange = () => {
    setState({ tool: tool.value as 'none' | 'trendline' | 'hline' });
    saveFormState();
  };
  reload.onclick = () => loadCandlestickData();

  subscribe(state => {
    if (state.loading) status.textContent = 'Loading...';
    else if (state.error) status.textContent = 'Error: ' + state.error;
    else if (!state.data || state.data.length === 0)
      status.textContent = 'No data';
    else status.textContent = '';
  });
}
