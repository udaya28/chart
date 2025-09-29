### TradingView advanced charts library alternative

#### High level requirements for new charting library

- Interactive financial charts with real-time data updates
- Support for multiple chart types (candlestick, line, bar, etc.)
- Technical indicators
- Drawing tools (trend lines, Fibonacci retracements, etc.)
- Customizable timeframes (1 min, 5 min, 1 hour, daily, etc.)
- Responsive design for various screen sizes
- Automatic data fetching and updating
- Customizable appearance (colors, themes)

### MVP Product requirements

- Basic candlestick charts
- Allow switching between underlying (NIFTY, BANKNIFTY)
- Support for multiple timeframes (1 min, 5 min, 1 hour, daily)
- Zooming and panning functionality
- Automatic data fetching and updating based on selected timeframe and view
- Drawing tools (trend lines, horizontal lines)

### tech spec for MVP

- Should be in TypeScript and no rendering libraries (like React, Vue, etc.)
- Use pixijs for rendering (https://pixijs.com/)
- Use D3.js for data manipulation like scales and axes (https://d3js.org/)
- API to fetch candlestick data is present in `api/historicalQuotes.ts` and there is example usage
- Use Vite as the build tool (https://vitejs.dev/)
- Use pnpm as the package manager (https://pnpm.io/)
- For Now only use underlying 'NIFTY' and 'BANKNIFTY' for fetching data
- build it in modular way so that new features can be added easily
- create a plan and take feedback before starting implementation and during implementation
- I am new to pixijs and D3 so please keep the code simple and add comments where necessary but do not over comment
- keep data and rendering logic separate
- create a simple state management solution to manage application state
- create a simple UI
  - to switch between underlying and timeframes
  - to select drawing tools and draw on the chart
  - to zoom and pan the chart
  - to show loading state when data is being fetched
  - to show error state when data fetching fails
  - to show no data state when there is no data to display
- keep it simple and avoid over engineering
- write clean and maintainable code

- moving average indicator
- volume indicator
