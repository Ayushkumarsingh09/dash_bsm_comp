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

## SPX volatility fly lab

[`fly.html`](fly.html) is a separate research terminal for implied-volatility flies, option-price butterflies, and tradable butterfly packages. It is not a payoff toy: every curve is computed from the shared BSM engine plus an explicit smile.

Open [`fly.html`](fly.html). Engine tests: [`fly-tests.html`](fly-tests.html), or `node tests/run-fly.js`.

The book opens on a **synthetic** one-year sample (exactly 252 business days ending 2026-10-09, seed `20261012`). Each session is a 60-calendar-day smile built by interpolating total variance between 45 and 75 DTE. A 40-session warm-up is used only for realized volatility and drawdown and is excluded from every score. A labeled slice is in [`data/synthetic-spx-60d-sample.csv`](data/synthetic-spx-60d-sample.csv). Importing a chain replaces the live smile only; it is never mixed into that history. Files spanning more than a year are rejected.

Positive residual means the fly is **expensive** versus that method's reference. Cheap is not a buy signal.

IV fly and package P&L are different objects. The raw fly is `(IV_lower + IV_upper) / 2 − IV_center` in decimal volatility (×100 = vol points). The normalized price fly is `0.5 P(K1) + 0.5 P(K3) − P(K2)`.

## Run locally

No build step. Open `index.html`, `chain.html`, `atlas.html`, or `fly.html` in a browser.

If a browser blocks Chart.js from `file://`, serve the folder, for example:

```bash
npx --yes serve .
```

Shared pricing engine: [`js/bsm-engine.js`](js/bsm-engine.js). Atlas UI: [`js/atlas.js`](js/atlas.js). Fly engine: [`js/fly-engine.js`](js/fly-engine.js).

## Model notes

Theoretical BSM laboratory — not a market pricing engine. Assumptions: European exercise, constant volatility and rates, continuous compounding and dividend yield, no smile or early exercise.

Higher-order Greek relationships can change sign across parameter space. Atlas analysis labels those cases as non-monotone / conditional rather than inventing a single “always true” arrow.
