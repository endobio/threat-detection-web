# Threat Detection Web

Vite + React demo for a county-level emerging crop disease intelligence dashboard.

The app reads one compact static payload:

```txt
public/data/demo_summary.json
```

That file contains the demo disease index, county GeoJSON, county-level metrics,
trend rows, alert rows, and transparent emergence score components.

## Run

```bash
npm install
npm run dev
```

Open the local Vite URL shown in the terminal, usually `http://localhost:5173`.

## Build

```bash
npm run build
```
