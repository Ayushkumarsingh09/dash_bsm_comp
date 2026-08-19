# BSM Greek Sensitivity Lab

Interactive Black-Scholes-Merton European options dashboard for pricing, Greeks, and input sensitivity analysis.

**Live demo:** [https://dashbsmcomp.vercel.app](https://dashbsmcomp.vercel.app)

## Pages

- `index.html` — Sensitivity Lab + Relationship Matrix + Validation
- `chain.html` — Excel-style option chain workbook (upload Excel, live edits, bulk column Greek ops)

## Features

- BSM pricing with continuous dividend yield
- Primary & higher-order Greeks (Delta through Ultima)
- Live sensitivity charts, heatmaps, and 3D surface
- Engine-generated relationship matrices by moneyness regime (editable representative params)
- Chain workbook: Call|Strike|Put layout, inverse Greek solver, whole-column set/+/- ops
- Analytical vs finite-difference validation suite
- Call / Put toggle, presets, CSV/JSON/Excel export

## Run locally

Open `index.html` or `chain.html` in a browser (no build step).

## Model notes

Theoretical BSM laboratory — not a market pricing engine. Assumptions: European exercise, constant volatility and rates, continuous compounding and dividend yield, no smile or early exercise.

