# BSM Greek Sensitivity Lab + Graph Atlas

Interactive Black-Scholes-Merton European options laboratory for pricing, Greeks, input sensitivity, and **full cross-plot analysis** by moneyness regime.

**Original live demo:** [https://dashbsmcomp.vercel.app](https://dashbsmcomp.vercel.app)

This project includes the original Sensitivity Lab and Chain Workbook, plus a Graph Atlas that plots every driver against every Greek, overall and by ITM / ATM / OTM / deep regimes.

## Pages

- [`index.html`](index.html) — Sensitivity Lab + Relationship Matrix + Validation
- [`chain.html`](chain.html) — Excel-style option chain workbook (upload Excel, live edits, bulk column Greek ops)
- [`atlas.html`](atlas.html) — **Graph Atlas**: customizable cross-plots, full compilation gallery, regime lab, Greek×Greek paths, heatmaps/surfaces, call vs put families, direction matrix

## Graph Atlas

Every chart is generated from the analytical BSM engine (same formulas as the lab). Nothing is hardcoded as a “shape”.

### Drivers (X) and metrics (Y)

| Drivers | Metrics |
| --- | --- |
| Spot S, Strike K | Price, Delta, Gamma, Vega, Theta, Rho |
| Moneyness ln(F/K), S/K, F/K | Lambda, Charm, Vanna, Vomma, Speed, Color, Ultima |
| Volatility σ, Time T, Rate r, Dividend q | Intrinsic, time value, d1, d2 |

### Tabs

1. **Custom Builder** — pick any X, overlay any Y set, set range/points, normalize or log|Y|. Regime modes:
   - Overall sweep
   - Color points by regime
   - Overlay each regime (representative K, then sweep X)
   - Filter to checked bands (ATM, ITM, OTM, Deep ITM, Deep OTM, Deep Deep)
   - CSV / PNG export and engine-written analysis (min/max, zeros, monotonicity, ATM neighbourhood)
2. **Full Compilation** — 13 Greeks × 7 drivers (S, K, moneyness, σ, T, r, q). Click a tile to open it in the builder.
3. **Regime Lab** — overall + seven moneyness facets with a comparison table.
4. **Greek × Greek** — parametric paths (a driver traces a curve in (Greek A, Greek B) space), coloured by regime. Primary-pair gallery included.
5. **Heatmap & Surface** — any input vs any input, colour/Z = any Greek; optional regime window.
6. **Call vs Put / Families** — overlay call & put; family curves in T, σ, r, q, or K.
7. **Direction Matrix** — local ∂Greek/∂input arrows per regime from finite differences, with Universal / Typical / Conditional confidence.

Moneyness uses **signed forward log-moneyness** ln(F/K) with F = S e^{(r−q)T}. Puts flip the sign so ITM/OTM match option value, not the call convention.

## Original features

- BSM pricing with continuous dividend yield
- Primary & higher-order Greeks (Delta through Ultima)
- Live sensitivity charts, heatmaps, and 3D surface
- Engine-generated relationship matrices by moneyness regime
- Chain workbook: Call|Strike|Put layout, inverse Greek solver, whole-column set/+/- ops
- Analytical vs finite-difference validation suite
- Call / Put toggle, presets, CSV/JSON/Excel export

## Run locally

No build step. Open `index.html`, `chain.html`, or `atlas.html` in a browser.

If a browser blocks Chart.js from `file://`, serve the folder, for example:

```bash
npx --yes serve .
```

Shared engine: [`js/bsm-engine.js`](js/bsm-engine.js). Atlas UI: [`js/atlas.js`](js/atlas.js).

## Model notes

Theoretical BSM laboratory — not a market pricing engine. Assumptions: European exercise, constant volatility and rates, continuous compounding and dividend yield, no smile or early exercise.

Higher-order Greek relationships can change sign across parameter space. Atlas analysis labels those cases as non-monotone / conditional rather than inventing a single “always true” arrow.
