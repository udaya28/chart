import './style.css';
import { initChart } from './modules/chart';
import { initUI } from './modules/ui';
import { loadCandlestickData } from './modules/candlestickData';

window.onload = () => {
  const appDiv = document.getElementById('app');
  if (!appDiv) return;

  const uiContainer = document.createElement('div');
  appDiv.appendChild(uiContainer);
  initUI(uiContainer);

  const chartContainer = document.createElement('div');
  chartContainer.style.width = '100%';
  chartContainer.style.height = '400px';
  appDiv.appendChild(chartContainer);
  initChart(chartContainer);

  loadCandlestickData();
};
