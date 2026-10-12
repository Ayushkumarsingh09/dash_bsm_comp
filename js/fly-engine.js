/**
 * SPX volatility-fly research engine.
 *
 * Units
 *   Volatility is decimal unless a name ends in Pts / Pct.
 *   IV fly is decimal volatility: (IV_L + IV_U) / 2 − IV_C.
 *   Vol points = 100 × decimal. A fly of 0.005 is 0.50 vol points.
 *   BSM vega is per 1.00 decimal vol. Vega per vol point = vega / 100.
 *   Theta from BSM is calendar ∂V/∂t per year. Per day = theta / dayCount.
 *   k = ln(K / F), F = S exp((r−q)T), T = days / dayCount.
 *
 * Sign
 *   Positive IV-fly residual vs a reference means the fly is EXPENSIVE
 *   (wings richer than the body). Negative means CHEAP.
 *   Cheap is not a buy signal and is not a forecast of P&L.
 *
 * Smile (quadratic local generator)
 *   σ(k) = atm
 *        + putSkew · max(−k, 0)
 *        + callSkew · max(k, 0)
 *        + ½ curvature · k²
 *        + asymmetry · k³
 *        + wingSteepness · |k|³
 *        + bump · exp(−½((k−bumpK)/bumpWidth)²)
 *   putSkew > 0 raises downside IV. This is a local approximation:
 *   it can violate butterfly arbitrage and is not a global surface.
 *
 * Historical sample
 *   Exactly 252 business-day valuation sessions, target maturity 60 calendar
 *   days (T = 60/365). Each session is total-variance interpolation of a
 *   45-DTE and a 75-DTE slice. A 40-day warm-up exists only so realized
 *   volatility and drawdown exist on day one; it is not part of the sample.
 *   Synthetic throughout. Never mixed with imported prints without a label.
 */
(function (global) {
  const VERSION = 'fly-1.0.0';
  const SAMPLE_END = '2026-10-09';
  const VALUATION_DAYS = 252;
  const WARMUP_DAYS = 40;
  const SEED = 20261012;
  const K_MIN = -0.30;
  const K_MAX = 0.22;

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function isNum(x) { return typeof x === 'number' && Number.isFinite(x); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function hypot(xs) { let s = 0; for (const x of xs) s += x * x; return Math.sqrt(s); }
  function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function linspace(a, b, n) {
    const out = [];
    if (n <= 1) return [a];
    for (let i = 0; i < n; i++) out.push(a + (b - a) * i / (n - 1));
    return out;
  }
  function round(x, d) {
    const p = Math.pow(10, d);
    return Math.round(x * p) / p;
  }
  function median(arr) {
    const s = arr.filter(isNum).slice().sort((a, b) => a - b);
    if (!s.length) return NaN;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
  }
  function mad(arr, med) {
    const m = isNum(med) ? med : median(arr);
    return median(arr.filter(isNum).map((x) => Math.abs(x - m)));
  }
  function mean(arr) {
    const s = arr.filter(isNum);
    if (!s.length) return NaN;
    return s.reduce((a, b) => a + b, 0) / s.length;
  }
  function pearson(a, b) {
    const xs = [], ys = [];
    for (let i = 0; i < a.length; i++) if (isNum(a[i]) && isNum(b[i])) { xs.push(a[i]); ys.push(b[i]); }
    if (xs.length < 5) return NaN;
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < xs.length; i++) {
      const vx = xs[i] - mx, vy = ys[i] - my;
      num += vx * vy; dx += vx * vx; dy += vy * vy;
    }
    if (dx <= 0 || dy <= 0) return NaN;
    return num / Math.sqrt(dx * dy);
  }
  function percentileRank(sample, value) {
    const s = sample.filter(isNum);
    if (!s.length || !isNum(value)) return NaN;
    let le = 0;
    for (const x of s) if (x <= value) le++;
    return le / s.length;
  }
  function classifyZ(z) {
    if (!isNum(z)) return 'insufficient';
    if (z >= 1) return 'expensive';
    if (z <= -1) return 'cheap';
    return 'fair';
  }
  function normInv(p) {
    if (!(p > 0 && p < 1)) return NaN;
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const plow = 0.02425;
    let q;
    if (p < plow) {
      q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 1 - plow) {
      q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(rng) {
    let u = rng();
    if (u < 1e-12) u = 1e-12;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }
  function iso(d) { return d.toISOString().slice(0, 10); }
  function parseISO(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function isBiz(d) { const day = d.getUTCDay(); return day !== 0 && day !== 6; }
  function businessDaysEnding(endISO, n) {
    const out = [];
    let d = parseISO(endISO);
    while (out.length < n) {
      if (isBiz(d)) out.push(iso(d));
      d = new Date(d.getTime() - 86400000);
    }
    return out.reverse();
  }
  function solve3(A, b) {
    const M = A.map((row, i) => row.concat([b[i]]));
    for (let c = 0; c < 3; c++) {
      let p = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-14) return null;
      if (p !== c) { const tmp = M[c]; M[c] = M[p]; M[p] = tmp; }
      const piv = M[c][c];
      for (let j = c; j < 4; j++) M[c][j] /= piv;
      for (let r = 0; r < 3; r++) if (r !== c) {
        const f = M[r][c];
        for (let j = c; j < 4; j++) M[r][j] -= f * M[c][j];
      }
    }
    return [M[0][3], M[1][3], M[2][3]];
  }
  function ols(X, y) {
    const n = y.length, p = X[0].length;
    const XtX = Array.from({ length: p }, () => Array(p).fill(0));
    const Xty = Array(p).fill(0);
    for (let i = 0; i < n; i++) {
      if (!isNum(y[i])) continue;
      for (let a = 0; a < p; a++) {
        Xty[a] += X[i][a] * y[i];
        for (let b = 0; b < p; b++) XtX[a][b] += X[i][a] * X[i][b];
      }
    }
    const M = XtX.map((row, i) => row.concat([Xty[i]]));
    for (let c = 0; c < p; c++) {
      let piv = c;
      for (let r = c + 1; r < p; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-14) return null;
      if (piv !== c) { const t = M[c]; M[c] = M[piv]; M[piv] = t; }
      const d = M[c][c];
      for (let j = c; j <= p; j++) M[c][j] /= d;
      for (let r = 0; r < p; r++) if (r !== c) {
        const f = M[r][c];
        for (let j = c; j <= p; j++) M[r][j] -= f * M[c][j];
      }
    }
    return M.map((row) => row[p]);
  }

  function zeroShocks() {
    return {
      dS: 0, dAtm: 0, dPut: 0, dCall: 0, dCurv: 0, dAsym: 0, dWing: 0,
      dDays: 0, dr: 0, dq: 0, dWingStrike: 0, dWingLog: 0, dWingDelta: 0,
      dCenterDelta: 0, dCost: 0
    };
  }

  function defaultState() {
    return {
      version: VERSION,
      source: 'synthetic',
      linkedToFinal: true,
      asOf: SAMPLE_END,
      S: 5800,
      r: 0.045,
      q: 0.013,
      days: 60,
      dayCount: 365,
      atm: 0.16,
      putSkew: 0.65,
      callSkew: 0.12,
      curvature: 2.8,
      asymmetry: -2,
      wingSteepness: 4,
      bump: 0,
      bumpK: 0,
      bumpWidth: 0.03,
      termSlope: -0.04,
      centerMode: 'strike',
      centerK: 5800,
      centerDelta: 0.50,
      centerSide: 'call',
      wingMode: 'log',
      wingStrike: 100,
      wingAsym: 0,
      wingLog: 0.04,
      wingAsymLog: 0,
      wingDelta: 0.25,
      deltaConv: 'forward',
      flyQuote: 'raw',
      quoteDelta: 0.25,
      priceConvention: 'normalized',
      wLo: 0.5,
      wMid: -1,
      wHi: 0.5,
      strategy: 'long_call',
      customLegs: null,
      tradeQty: 1,
      multiplier: 100,
      spreadFrac: 0.01,
      spreadWing: 0.15,
      slippagePts: 0.05,
      feePerContract: 0.65,
      entryPremium: null,
      sticky: 'moneyness',
      kMax: 0.30,
      dropStale: true,
      shocks: zeroShocks(),
      quoteGrid: null,
      heatmap: { x: 'S', y: 'atm', metric: 'ivFly', n: 13 }
    };
  }

  const units = {
    putFromPts: (pts) => (pts / 100) / 0.10,
    ptsFromPut: (v) => v * 0.10 * 100,
    curvFromPts: (pts) => (pts / 100) / (0.5 * 0.01),
    ptsFromCurv: (c) => c * 0.5 * 0.01 * 100,
    asymFromPts: (pts) => (pts / 100) / 0.001,
    ptsFromAsym: (a) => a * 0.001 * 100,
    wingFromPts: (pts) => (pts / 100) / 0.001,
    ptsFromWing: (w) => w * 0.001 * 100
  };

  function yearFrac(days, dayCount) {
    const dc = dayCount === 252 ? 252 : 365;
    return Math.max(days, 1) / dc;
  }
  function forward(s) {
    return s.S * Math.exp((s.r - s.q) * s.T);
  }
  function ensureT(s) {
    s.T = yearFrac(s.days, s.dayCount);
    return s;
  }

  function shapeIV(k, shape) {
    const put = k < 0 ? -shape.putSkew * k : 0;
    const call = k > 0 ? shape.callSkew * k : 0;
    const curv = 0.5 * shape.curvature * k * k;
    const asym = shape.asymmetry * k * k * k;
    const wing = shape.wingSteepness * Math.abs(k * k * k);
    let bump = 0;
    if (shape.bump) {
      const bw = shape.bumpWidth || 0.03;
      const dk = (k - (shape.bumpK || 0)) / bw;
      bump = shape.bump * Math.exp(-0.5 * dk * dk);
    }
    return Math.max(0.01, shape.atm + put + call + curv + asym + wing + bump);
  }

  function smoothShape(s) {
    return {
      atm: s.atm, putSkew: s.putSkew, callSkew: s.callSkew, curvature: s.curvature,
      asymmetry: s.asymmetry, wingSteepness: s.wingSteepness, bump: 0, bumpK: 0, bumpWidth: s.bumpWidth
    };
  }

  function applyShockValues(base, shocks) {
    const s = clone(base);
    const z = Object.assign(zeroShocks(), shocks || {});
    s.shocks = zeroShocks();
    s.S = Math.max(1, base.S * (1 + z.dS));
    s.atm = Math.max(0.01, base.atm + z.dAtm);
    s.putSkew = base.putSkew + z.dPut;
    s.callSkew = base.callSkew + z.dCall;
    s.curvature = base.curvature + z.dCurv;
    s.asymmetry = base.asymmetry + z.dAsym;
    s.wingSteepness = base.wingSteepness + z.dWing;
    s.days = Math.max(1, base.days + z.dDays);
    s.r = base.r + z.dr;
    s.q = base.q + z.dq;
    s.wingStrike = base.wingStrike + z.dWingStrike;
    s.wingLog = Math.max(0.005, base.wingLog + z.dWingLog);
    s.wingDelta = clamp(base.wingDelta + z.dWingDelta, 0.02, 0.49);
    s.centerDelta = clamp(base.centerDelta + z.dCenterDelta, 0.02, 0.98);
    s.slippagePts = Math.max(0, base.slippagePts + z.dCost);
    delete s._pin;
    ensureT(s);
    const smileMoved = z.dAtm || z.dPut || z.dCall || z.dCurv || z.dAsym || z.dWing || z.dDays;
    if (smileMoved) s.quoteGrid = null;
    s._shock = z;
    s._baseS = base.S;
    s._baseDays = base.days;
    s._baseR = base.r;
    s._baseQ = base.q;
    return s;
  }

  function buildPin(base, shocks) {
    const pinned = applyShockValues(base, Object.assign({}, shocks, { dS: 0 }));
    const F = forward(pinned);
    const ks = linspace(-0.35, 0.25, 81);
    return ks.map((k) => ({
      K: F * Math.exp(k),
      iv: quoteOrFormula(pinned, k)
    }));
  }

  function quoteOrFormula(s, k) {
    if (s.quoteGrid && s.quoteGrid.length) {
      const g = interpKGrid(s.quoteGrid, k, s.T);
      if (isNum(g.iv)) return g.iv;
    }
    return shapeIV(k, s);
  }

  function interpKGrid(grid, k, T) {
    if (!grid || !grid.length) return { iv: NaN, extrapolated: true, stale: false };
    if (k < grid[0].k - 1e-8 || k > grid[grid.length - 1].k + 1e-8) {
      return { iv: NaN, extrapolated: true, stale: false };
    }
    let i = 1;
    while (i < grid.length && grid[i].k < k) i++;
    if (i >= grid.length) i = grid.length - 1;
    const a = grid[Math.max(0, i - 1)];
    const b = grid[i];
    if (Math.abs(b.k - a.k) < 1e-12) return { iv: a.iv, extrapolated: false, stale: !!a.stale };
    const t = T > 0 ? T : (grid.T || 60 / 365);
    const wa = a.iv * a.iv * t;
    const wb = b.iv * b.iv * t;
    const w = wa + (k - a.k) / (b.k - a.k) * (wb - wa);
    if (!(w > 0)) return { iv: NaN, extrapolated: false, stale: true };
    return { iv: Math.sqrt(w / t), extrapolated: false, stale: !!(a.stale || b.stale) };
  }

  function interpPin(pin, K) {
    if (K < pin[0].K || K > pin[pin.length - 1].K) return { iv: NaN, extrapolated: true };
    let lo = 0, hi = pin.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (pin[m].K < K) lo = m; else hi = m;
    }
    const a = pin[lo], b = pin[hi];
    const ka = Math.log(a.K), kb = Math.log(b.K), kk = Math.log(K);
    const w = (kk - ka) / (kb - ka || 1e-12);
    const iv = a.iv + w * (b.iv - a.iv);
    return { iv, extrapolated: false };
  }

  function materialize(base, shockOverride) {
    const shocks = shockOverride || base.shocks || zeroShocks();
    const s = applyShockValues(base, shocks);
    if (s.sticky === 'strike') s._pin = buildPin(base, shocks);
    return s;
  }

  function ivAt(s, K) {
    if (!(K > 0) || !(s.S > 0) || !(s.T > 0)) return { iv: NaN, k: NaN, extrapolated: true, stale: false };
    if (s._pin) {
      const hit = interpPin(s._pin, K);
      const F = forward(s);
      return { iv: hit.iv, k: Math.log(K / F), F, extrapolated: !!hit.extrapolated, stale: false, source: 'pinned-strike' };
    }
    const F = forward(s);
    const k = Math.log(K / F);
    const far = Math.abs(k) > (s.kMax || 0.30);
    if (s.quoteGrid && s.quoteGrid.length) {
      const g = interpKGrid(s.quoteGrid, k, s.T);
      return { iv: g.iv, k, F, extrapolated: far || !!g.extrapolated, stale: !!g.stale, source: 'quote-grid' };
    }
    return { iv: shapeIV(k, s), k, F, extrapolated: far, stale: false, source: 'parametric' };
  }

  function bsm(s, K, type, sigma) {
    const iv = isNum(sigma) ? sigma : ivAt(s, K).iv;
    return global.BSM.calculateBSM({
      S: s.S, K, sigma: Math.max(iv, 1e-4), T: s.T, r: s.r, q: s.q, type: type === 'put' ? 'put' : 'call'
    });
  }

  function deltaAbs(s, K, type) {
    const g = bsm(s, K, type);
    if (s.deltaConv === 'forward') return Math.abs(g.delta * Math.exp(s.q * s.T));
    if (s.deltaConv === 'premium') return Math.abs(g.delta - g.price / s.S);
    return Math.abs(g.delta);
  }

  function signedDelta(s, K, type) {
    const g = bsm(s, K, type);
    if (s.deltaConv === 'forward') return g.delta * Math.exp(s.q * s.T);
    if (s.deltaConv === 'premium') return g.delta - g.price / s.S;
    return g.delta;
  }

  function strikeForDelta(s, target, type) {
    const tgt = clamp(target, 0.02, 0.98);
    let lo = Math.max(1, s.S * 0.35);
    let hi = s.S * 2.2;
    for (let i = 0; i < 56; i++) {
      const mid = 0.5 * (lo + hi);
      const d = deltaAbs(s, mid, type);
      if (!isNum(d)) return NaN;
      if (type === 'put') {
        // |put delta| rises with strike: OTM puts (K below F) carry the smaller deltas.
        if (d > tgt) hi = mid; else lo = mid;
      } else if (d > tgt) lo = mid; else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  function resolveWings(s) {
    const notes = [];
    const F = forward(s);
    let Kc;
    if (s.centerMode === 'delta') {
      const side = s.centerSide === 'put' ? 'put' : 'call';
      Kc = strikeForDelta(s, s.centerDelta, side);
    } else {
      Kc = s.centerK;
    }
    let Kl, Ku;
    const ivC0 = ivAt(s, Kc);
    const kC = ivC0.k;
    if (s.wingMode === 'strike') {
      const dL = s.wingStrike - s.wingAsym;
      const dU = s.wingStrike + s.wingAsym;
      if (!(dL > 0 && dU > 0)) notes.push('Strike wing distances must stay positive.');
      Kl = Kc - dL;
      Ku = Kc + dU;
    } else if (s.wingMode === 'delta') {
      Kl = strikeForDelta(s, s.wingDelta, 'put');
      Ku = strikeForDelta(s, s.wingDelta, 'call');
    } else {
      const dL = s.wingLog - (s.wingAsymLog || 0);
      const dU = s.wingLog + (s.wingAsymLog || 0);
      if (!(dL > 0 && dU > 0)) notes.push('Log-moneyness wing distances must stay positive.');
      Kl = F * Math.exp(kC - dL);
      Ku = F * Math.exp(kC + dU);
    }
    const a = ivAt(s, Kl), c = ivAt(s, Kc), b = ivAt(s, Ku);
    const ordered = isNum(Kl) && isNum(Kc) && isNum(Ku) && Kl < Kc && Kc < Ku;
    if (!ordered) notes.push('Wings are not ordered around the center. This point is unsupported.');
    const extrapolated = !!(a.extrapolated || c.extrapolated || b.extrapolated);
    if (extrapolated) notes.push('At least one leg is outside the quoted log-moneyness grid (|k| > ' + (s.kMax || 0.30) + ').');
    return {
      F, Kl, Kc, Ku,
      kL: a.k, kC: c.k, kU: b.k,
      ivL: a.iv, ivC: c.iv, ivU: b.iv,
      stale: a.stale || c.stale || b.stale,
      extrapolated, ordered, notes,
      sources: [a.source, c.source, b.source]
    };
  }

  function ivFlyOf(w) {
    if (!w || !w.ordered || !isNum(w.ivL) || !isNum(w.ivC) || !isNum(w.ivU)) return NaN;
    return 0.5 * (w.ivL + w.ivU) - w.ivC;
  }

  function withPatches(s, patch) {
    const n = clone(s);
    Object.assign(n, patch);
    if (n._pin) delete n._pin;
    ensureT(n);
    return n;
  }

  function quoteFly(s, delta) {
    const atm = withPatches(s, { centerMode: 'strike', centerK: forward(s), wingMode: 'delta', wingDelta: delta, quoteGrid: s.quoteGrid });
    if (s._pin) atm._pin = s._pin;
    const w = resolveWings(atm);
    return { fly: ivFlyOf(w), wings: w };
  }

  function priceOf(s, K, type) {
    const info = ivAt(s, K);
    const g = bsm(s, K, type, info.iv);
    const rel = s.spreadFrac + s.spreadWing * (info.k || 0) * (info.k || 0);
    const half = Math.max(0.02, Math.abs(g.price) * rel) + (s.slippagePts || 0);
    return {
      mid: g.price,
      bid: Math.max(0, g.price - half),
      ask: g.price + half,
      half, iv: info.iv, k: info.k, g, extrapolated: info.extrapolated, stale: info.stale
    };
  }

  function weightsFor(s) {
    if (s.priceConvention === 'unnormalized') return { lo: 1, mid: -2, hi: 1 };
    if (s.priceConvention === 'custom') return { lo: s.wLo, mid: s.wMid, hi: s.wHi };
    return { lo: 0.5, mid: -1, hi: 0.5 };
  }

  function priceFly(s, wings) {
    const w = wings || resolveWings(s);
    if (!w.ordered) return { normalized: NaN, unnormalized: NaN, custom: NaN, weights: weightsFor(s) };
    const type = (s.strategy || '').indexOf('put') >= 0 ? 'put' : 'call';
    const pL = priceOf(s, w.Kl, type).mid;
    const pC = priceOf(s, w.Kc, type).mid;
    const pU = priceOf(s, w.Ku, type).mid;
    const wt = weightsFor(s);
    return {
      normalized: 0.5 * pL + 0.5 * pU - pC,
      unnormalized: pL - 2 * pC + pU,
      custom: wt.lo * pL + wt.mid * pC + wt.hi * pU,
      pL, pC, pU, type, weights: wt
    };
  }

  function unitLegs(s, wings) {
    const w = wings || resolveWings(s);
    const strat = s.strategy || 'long_call';
    if (strat === 'custom' && s.customLegs && s.customLegs.length) {
      return s.customLegs.map((leg) => ({ type: leg.type === 'put' ? 'put' : 'call', K: +leg.K, qty: +leg.qty }));
    }
    let Kl = w.Kl, Kc = w.Kc, Ku = w.Ku;
    if (strat === 'broken_call' || strat === 'broken_put') {
      const width = s.wingMode === 'strike' ? s.wingStrike : Math.max(10, s.S * s.wingLog);
      Kl = Kc - width * 1.6;
      Ku = Kc + width * 0.7;
    }
    const opt = strat.indexOf('put') >= 0 ? 'put' : 'call';
    let sign = strat.indexOf('short') === 0 ? -1 : 1;
    let legs = [
      { type: opt, K: Kl, qty: sign * 1 },
      { type: opt, K: Kc, qty: sign * -2 },
      { type: opt, K: Ku, qty: sign * 1 }
    ];
    if (strat === 'dn_call' || strat === 'dn_put') {
      const gs = legs.map((leg) => bsm(s, leg.K, leg.type));
      const body = gs[1].delta;
      if (Math.abs(body) > 1e-6) {
        legs[1].qty = -(legs[0].qty * gs[0].delta + legs[2].qty * gs[2].delta) / body;
      }
    }
    return legs;
  }

  function legQuote(s, leg, mode) {
    const q = priceOf(s, leg.K, leg.type);
    let px = q.mid;
    if (mode === 'bid') px = q.bid;
    else if (mode === 'ask') px = q.ask;
    else if (mode === 'executable') px = leg.qty >= 0 ? q.ask : q.bid;
    return { px, q };
  }

  function packagePoints(s, legs, mode) {
    let v = 0;
    const rows = [];
    for (const leg of legs) {
      const { px, q } = legQuote(s, leg, mode || 'mid');
      v += leg.qty * px;
      rows.push({ leg, px, q });
    }
    return { points: v, rows };
  }

  function feePoints(s, legs) {
    const contracts = legs.reduce((sum, leg) => sum + Math.abs(leg.qty), 0) * Math.abs(s.tradeQty || 1);
    const dollars = contracts * (s.feePerContract || 0);
    return dollars / (s.multiplier || 100);
  }

  function intrinsic(type, S, K) {
    return type === 'put' ? Math.max(K - S, 0) : Math.max(S - K, 0);
  }
  function payoff(legs, S) {
    let v = 0;
    for (const leg of legs) v += leg.qty * intrinsic(leg.type, S, leg.K);
    return v;
  }
  function payoffLimits(legs) {
    let callQty = 0, putQty = 0, callK = 0, putK = 0;
    for (const leg of legs) {
      if (leg.type === 'put') { putQty += leg.qty; putK += leg.qty * leg.K; }
      else { callQty += leg.qty; callK += leg.qty * leg.K; }
    }
    const downside = Math.abs(putQty) < 1e-8 ? putK : (putQty > 0 ? Infinity : -Infinity);
    const upside = Math.abs(callQty) < 1e-8 ? -callK : (callQty > 0 ? Infinity : -Infinity);
    return { downside, upside, callQty, putQty };
  }
  function breakevens(legs, debit) {
    const ks = legs.map((l) => l.K).filter((k) => k > 0).sort((a, b) => a - b);
    if (!ks.length) return [];
    const lo = Math.max(0, ks[0] * 0.5);
    const hi = ks[ks.length - 1] * 1.5;
    const grid = linspace(lo, hi, 240);
    const f = (S) => payoff(legs, S) - debit;
    const roots = [];
    let prev = f(grid[0]);
    for (let i = 1; i < grid.length; i++) {
      const cur = f(grid[i]);
      if (isNum(prev) && isNum(cur) && prev === 0) roots.push(grid[i - 1]);
      else if (isNum(prev) && isNum(cur) && prev * cur < 0) {
        let a = grid[i - 1], b = grid[i], fa = prev;
        for (let it = 0; it < 40; it++) {
          const m = 0.5 * (a + b);
          const fm = f(m);
          if (fa * fm <= 0) { b = m; } else { a = m; fa = fm; }
        }
        roots.push(0.5 * (a + b));
      }
      prev = cur;
    }
    return roots;
  }
  function extrema(legs, debit) {
    const lim = payoffLimits(legs);
    const ks = [0].concat(legs.map((l) => l.K)).sort((a, b) => a - b);
    if (isNum(lim.upside)) ks.push(ks[ks.length - 1] + 1);
    const vals = [];
    for (const S of ks) {
      const pnl = payoff(legs, S) - debit;
      vals.push(pnl);
    }
    if (lim.upside === Infinity) vals.push(Infinity);
    if (lim.upside === -Infinity) vals.push(-Infinity);
    if (lim.downside === Infinity) vals.push(Infinity);
    if (lim.downside === -Infinity) vals.push(-Infinity);
    let maxP = -Infinity, maxL = Infinity;
    for (const v of vals) {
      if (v > maxP) maxP = v;
      if (v < maxL) maxL = v;
    }
    return { maxProfit: maxP, maxLoss: maxL, limits: lim };
  }

  function impliedVol(target, S, K, T, r, q, type) {
    const discR = Math.exp(-r * T), discQ = Math.exp(-q * T);
    const lower = type === 'put' ? Math.max(0, K * discR - S * discQ) : Math.max(0, S * discQ - K * discR);
    const upper = type === 'put' ? K * discR : S * discQ;
    if (target < lower - 1e-6) return { iv: NaN, status: 'below-intrinsic' };
    if (target > upper + 1e-4) return { iv: NaN, status: 'above-bound' };
    let sig = 0.2;
    for (let i = 0; i < 30; i++) {
      const g = global.BSM.calculateBSM({ S, K, sigma: sig, T, r, q, type });
      const diff = g.price - target;
      if (Math.abs(diff) < 1e-8) return { iv: sig, status: 'ok', iterations: i };
      if (!(g.vega > 1e-8)) break;
      sig = Math.max(1e-4, Math.min(5, sig - diff / g.vega));
    }
    let lo = 1e-4, hi = 5;
    for (let i = 0; i < 70; i++) {
      const mid = 0.5 * (lo + hi);
      const px = global.BSM.calculateBSM({ S, K, sigma: mid, T, r, q, type }).price;
      if (px > target) hi = mid; else lo = mid;
    }
    return { iv: 0.5 * (lo + hi), status: 'ok', iterations: 70 };
  }

  function greeksOf(s, legs) {
    const names = ['delta', 'gamma', 'vega', 'theta', 'rho', 'vanna', 'vomma', 'charm', 'color', 'speed'];
    const pack = { perLeg: [], sum: {} };
    for (const n of names) pack.sum[n] = 0;
    for (const leg of legs) {
      const info = ivAt(s, leg.K);
      const g = bsm(s, leg.K, leg.type, info.iv);
      const row = { type: leg.type, K: leg.K, qty: leg.qty, iv: info.iv, price: g.price };
      for (const n of names) {
        row[n] = leg.qty * g[n];
        pack.sum[n] += row[n];
      }
      pack.perLeg.push(row);
    }
    const qty = s.tradeQty || 1;
    const mult = s.multiplier || 100;
    pack.position = {};
    for (const n of names) pack.position[n] = pack.sum[n] * qty;
    pack.dollar = {};
    for (const n of names) pack.dollar[n] = pack.position[n] * mult;
    pack.vegaPerPoint = pack.sum.vega / 100;
    pack.thetaPerDay = pack.sum.theta / (s.dayCount || 365);
    pack.gamma1pct = 0.5 * pack.sum.gamma * Math.pow(0.01 * s.S, 2);
    pack.units = {
      delta: 'index points per 1 spot point, IV held fixed (sticky strike)',
      vega: 'index points per 1.00 decimal vol; divide by 100 for one vol point',
      theta: 'index points per year; per day uses the selected day-count',
      gamma1pct: 'second-order price change for a 1% spot move at frozen IV'
    };
    const h = Math.max(s.S * 1e-4, 0.05);
    const frozen = legs.map((leg, i) => ({ leg, iv: pack.perLeg[i].iv }));
    const priceFrozen = (S) => {
      let v = 0;
      const t = withPatches(s, { S, quoteGrid: null });
      delete t._pin;
      for (const row of frozen) v += row.leg.qty * bsm(t, row.leg.K, row.leg.type, row.iv).price;
      return v;
    };
    pack.fdDelta = (priceFrozen(s.S + h) - priceFrozen(s.S - h)) / (2 * h);
    pack.fdGap = pack.fdDelta - pack.sum.delta;
    const smileUp = withPatches(s, { S: s.S + h });
    const smileDn = withPatches(s, { S: s.S - h });
    if (s._pin) { smileUp._pin = s._pin; smileDn._pin = s._pin; }
    const pUp = packagePoints(smileUp, legs, 'mid').points;
    const pDn = packagePoints(smileDn, legs, 'mid').points;
    pack.smileDelta = (pUp - pDn) / (2 * h);
    return pack;
  }

  function sviSlice(k, p) {
    const dk = k - p.m;
    return p.a + p.b * (p.rho * dk + Math.sqrt(dk * dk + p.sig * p.sig));
  }
  function fitSVI(ks, ivs, T, stale) {
    const w = [];
    const kk = [];
    for (let i = 0; i < ks.length; i++) {
      if (stale && stale[i]) continue;
      if (!isNum(ivs[i]) || ivs[i] <= 0) continue;
      kk.push(ks[i]);
      w.push(ivs[i] * ivs[i] * T);
    }
    if (kk.length < 6) return { ok: false, reason: 'too few quotes' };
    let best = null;
    const rhos = [-0.85, -0.6, -0.35, -0.15, 0, 0.25, 0.5];
    const sigs = [0.05, 0.1, 0.18, 0.3];
    const ms = [-0.12, -0.04, 0, 0.06];
    for (const rho of rhos) for (const sig of sigs) for (const m of ms) {
      let sz = 0, sw = 0, szz = 0, szw = 0, n = 0;
      const zs = [];
      for (let i = 0; i < kk.length; i++) {
        const dk = kk[i] - m;
        const z = rho * dk + Math.sqrt(dk * dk + sig * sig);
        zs.push(z);
        sz += z; sw += w[i]; szz += z * z; szw += z * w[i]; n++;
      }
      const den = n * szz - sz * sz;
      if (Math.abs(den) < 1e-12) continue;
      const b = (n * szw - sz * sw) / den;
      const a = (sw - b * sz) / n;
      if (!(b >= 0)) continue;
      const floor = a + b * sig * Math.sqrt(Math.max(0, 1 - rho * rho));
      if (floor < -1e-6) continue;
      let sse = 0;
      for (let i = 0; i < n; i++) {
        const diff = a + b * zs[i] - w[i];
        sse += diff * diff;
      }
      if (!best || sse < best.sse) best = { a, b, rho, m, sig, sse, n };
    }
    if (!best) return { ok: false, reason: 'no arbitrage-feasible SVI fit' };
    best.ok = true;
    best.rmseVolPts = Math.sqrt(best.sse / best.n) / T * 100;
    best.iv = (k) => {
      const ww = sviSlice(k, best);
      if (!(ww > 0)) return NaN;
      return Math.sqrt(ww / T);
    };
    best.minVariance = best.a + best.b * best.sig * Math.sqrt(Math.max(0, 1 - best.rho * best.rho));
    return best;
  }

  function fitSSVI(ks, ivs, T, atmHint) {
    const theta = Math.max(1e-6, (atmHint > 0 ? atmHint : ivs[Math.floor(ivs.length / 2)]) ** 2 * T);
    let best = null;
    for (let ir = 0; ir <= 16; ir++) {
      const rho = -0.9 + ir * (1.4 / 16);
      for (let ip = 1; ip <= 18; ip++) {
        const phi = ip * 0.35;
        if (theta * phi * (1 + Math.abs(rho)) >= 4) continue;
        let sse = 0, n = 0;
        for (let i = 0; i < ks.length; i++) {
          if (!isNum(ivs[i])) continue;
          const t = phi * ks[i] + rho;
          const w = 0.5 * theta * (1 + rho * phi * ks[i] + Math.sqrt(t * t + (1 - rho * rho)));
          const iv = Math.sqrt(Math.max(w, 0) / T);
          const d = iv - ivs[i];
          sse += d * d; n++;
        }
        if (!best || sse < best.sse) best = { theta, rho, phi, sse, n };
      }
    }
    if (!best) return { ok: false, reason: 'no SSVI parameters inside the no-arbitrage wedge' };
    best.ok = true;
    best.rmseVolPts = Math.sqrt(best.sse / best.n) * 100;
    best.iv = (k) => {
      const t = best.phi * k + best.rho;
      const w = 0.5 * best.theta * (1 + best.rho * best.phi * k + Math.sqrt(t * t + (1 - best.rho * best.rho)));
      return Math.sqrt(Math.max(w, 0) / T);
    };
    return best;
  }

  function varianceInterp(k, shape, dayCount) {
    const dc = dayCount || 365;
    const T60 = 60 / dc, T1 = 45 / dc, T2 = 75 / dc;
    const atm1 = Math.max(0.03, shape.atm + shape.termSlope * (T1 - T60));
    const atm2 = Math.max(0.03, shape.atm + shape.termSlope * (T2 - T60));
    const s1 = shapeIV(k, Object.assign({}, shape, { atm: atm1 }));
    const s2 = shapeIV(k, Object.assign({}, shape, { atm: atm2 }));
    const w1 = s1 * s1 * T1;
    const w2 = s2 * s2 * T2;
    const alpha = (T60 - T1) / (T2 - T1);
    const w = w1 + alpha * (w2 - w1);
    return {
      iv: Math.sqrt(Math.max(w, 1e-12) / T60),
      w, w1, w2, alpha, T60, T1, T2,
      direct: shapeIV(k, shape),
      calendarOk: w2 + 1e-8 >= w1
    };
  }

  function kGrid() {
    const ks = [];
    for (let k = K_MIN; k <= K_MAX + 1e-9; k += 0.02) ks.push(round(k, 4));
    return ks;
  }

  let _history = null;
  function resetHistory() { _history = null; }

  function buildHistory() {
    const rng = mulberry32(SEED);
    const allDates = businessDaysEnding(SAMPLE_END, VALUATION_DAYS + WARMUP_DAYS);
    const ks = kGrid();
    const T = 60 / 365;
    let S = 5450;
    let atm = 0.175;
    let putSkew = 0.70;
    let callSkew = 0.14;
    let curvature = 2.6;
    let asymmetry = -1.5;
    let wingSteepness = 3.5;
    let bump = 0;
    let bumpK = 0;
    const termSlope = -0.04;
    const r = 0.045, q = 0.013;
    let peak = S;
    const rets = [];
    const warmup = [];
    const days = [];
    for (let i = 0; i < allDates.length; i++) {
      const z1 = gauss(rng), z2 = gauss(rng), z3 = gauss(rng), z4 = gauss(rng);
      const ret = (0.04 - 0.5 * atm * atm) / 252 + atm * Math.sqrt(1 / 252) * z1;
      S = Math.max(1000, S * Math.exp(ret));
      rets.push(ret);
      atm = clamp(atm + 0.04 * (0.17 - atm) + 0.012 * z2, 0.08, 0.55);
      const stress = Math.max(0, -ret);
      putSkew = clamp(putSkew + 0.03 * (0.68 - putSkew) + 0.04 * z3 + 6 * stress, 0.05, 2.2);
      callSkew = clamp(callSkew + 0.03 * (0.12 - callSkew) + 0.02 * z4, -0.2, 0.8);
      curvature = clamp(curvature + 0.04 * (2.7 - curvature) + 0.15 * z3, -1, 8);
      asymmetry = clamp(asymmetry + 0.05 * (-1.6 - asymmetry) + 0.2 * z4, -8, 8);
      wingSteepness = clamp(wingSteepness + 0.04 * (3.6 - wingSteepness) + 0.15 * z2, 0, 12);
      bump = clamp(0.65 * bump + 0.004 * z4, -0.012, 0.012);
      bumpK = clamp(0.8 * bumpK + 0.015 * z3, -0.12, 0.12);
      peak = Math.max(peak, S);
      const drawdown = S / peak - 1;
      const window = rets.slice(Math.max(0, rets.length - 21));
      const rv = Math.sqrt(mean(window.map((x) => x * x)) * 252);
      const downs = window.filter((x) => x < 0);
      const downsideRv = downs.length ? Math.sqrt(mean(downs.map((x) => x * x)) * 252) : 0;
      const shape = { atm, putSkew, callSkew, curvature, asymmetry, wingSteepness, bump, bumpK, bumpWidth: 0.03, termSlope };
      const iv = [];
      const stale = [];
      let calendarBreaks = 0;
      for (let j = 0; j < ks.length; j++) {
        const sl = varianceInterp(ks[j], shape, 365);
        iv.push(sl.iv);
        if (!sl.calendarOk) calendarBreaks++;
        stale.push(Math.abs(ks[j]) > 0.20 && rng() < 0.06);
      }
      const tail = ivAtKStored(ks, iv, -0.08) - ivAtKStored(ks, iv, 0);
      const row = {
        date: allDates[i], S, r, q, T, days: 60, dayCount: 365,
        shape, iv, stale, ks, rv, downsideRv, drawdown, ret, tail, calendarBreaks,
        inValuation: i >= WARMUP_DAYS
      };
      if (i < WARMUP_DAYS) warmup.push(row); else days.push(row);
    }
    const history = {
      version: VERSION,
      synthetic: true,
      seed: SEED,
      end: SAMPLE_END,
      valuationDays: days.length,
      warmupDays: warmup.length,
      warmup,
      days,
      kGrid: ks,
      targetDTE: 60,
      dayCount: 365,
      label: 'SYNTHETIC demonstration. Not SPX market data. Valuation sample is exactly 252 business days.',
      ratesNote: 'r and q are constant assumptions, not estimated from futures.',
      interpolation: 'Linear total variance between 45 and 75 calendar DTE, then σ = sqrt(w/T) at 60 DTE.'
    };
    for (const day of days) {
      const st = stateFromDay(day);
      const q25 = quoteFly(st, 0.25);
      day.fly25 = q25.fly;
      day.k25L = q25.wings.kL;
      day.k25U = q25.wings.kU;
      const fit = fitSVI(day.ks, day.iv, day.T, day.stale);
      day.sviOk = !!fit.ok;
      day.sviIv = day.ks.map((k) => (fit.ok ? fit.iv(k) : NaN));
      day.sviRmse = fit.ok ? fit.rmseVolPts : NaN;
    }
    return history;
  }

  function ivAtKStored(ks, iv, k) {
    return interpKGrid(ks.map((kk, i) => ({ k: kk, iv: iv[i] })), k, 60 / 365).iv;
  }

  function stateFromDay(day) {
    const s = defaultState();
    Object.assign(s, {
      source: 'synthetic',
      linkedToFinal: false,
      asOf: day.date,
      S: day.S, r: day.r, q: day.q, days: 60, dayCount: 365,
      atm: day.shape.atm,
      putSkew: day.shape.putSkew,
      callSkew: day.shape.callSkew,
      curvature: day.shape.curvature,
      asymmetry: day.shape.asymmetry,
      wingSteepness: day.shape.wingSteepness,
      bump: day.shape.bump,
      bumpK: day.shape.bumpK,
      termSlope: day.shape.termSlope,
      quoteGrid: day.ks.map((k, i) => ({ k, iv: day.iv[i], stale: !!day.stale[i] })),
      centerMode: 'strike',
      centerK: day.S * Math.exp((day.r - day.q) * day.T),
      shocks: zeroShocks()
    });
    s.quoteGrid.T = day.T;
    ensureT(s);
    return s;
  }

  function getHistory() {
    if (!_history) _history = buildHistory();
    return _history;
  }

  function linkToFinal(state, history) {
    const h = history || getHistory();
    const day = h.days[h.days.length - 1];
    const linked = stateFromDay(day);
    linked.linkedToFinal = true;
    linked.centerMode = state.centerMode;
    linked.centerK = state.centerMode === 'strike' ? forward(linked) : state.centerK;
    linked.centerDelta = state.centerDelta;
    linked.centerSide = state.centerSide;
    linked.wingMode = state.wingMode;
    linked.wingStrike = state.wingStrike;
    linked.wingAsym = state.wingAsym;
    linked.wingLog = state.wingLog;
    linked.wingAsymLog = state.wingAsymLog;
    linked.wingDelta = state.wingDelta;
    linked.deltaConv = state.deltaConv;
    linked.strategy = state.strategy;
    linked.tradeQty = state.tradeQty;
    linked.priceConvention = state.priceConvention;
    linked.flyQuote = state.flyQuote;
    linked.sticky = state.sticky;
    linked.entryPremium = null;
    linked.shocks = zeroShocks();
    linked.asOf = day.date;
    return linked;
  }

  function flyOnDay(day, kL, kC, kU) {
    const ivL = ivAtKStored(day.ks, day.iv, kL);
    const ivC = ivAtKStored(day.ks, day.iv, kC);
    const ivU = ivAtKStored(day.ks, day.iv, kU);
    if (![ivL, ivC, ivU].every(isNum)) return NaN;
    return 0.5 * (ivL + ivU) - ivC;
  }
  function modelFlyOnDay(day, kL, kC, kU, field) {
    const src = field === 'svi' ? day.sviIv : day.iv;
    if (!src) return NaN;
    const ivL = ivAtKStored(day.ks, src, kL);
    const ivC = ivAtKStored(day.ks, src, kC);
    const ivU = ivAtKStored(day.ks, src, kU);
    if (![ivL, ivC, ivU].every(isNum)) return NaN;
    return 0.5 * (ivL + ivU) - ivC;
  }

  function polyIV(ks, ivs, k, excludeCenter) {
    const rows = [], ys = [];
    for (let i = 0; i < ks.length; i++) {
      if (!isNum(ivs[i])) continue;
      if (isNum(excludeCenter) && Math.abs(ks[i] - excludeCenter) < 0.025) continue;
      rows.push([1, ks[i], ks[i] * ks[i]]);
      ys.push(ivs[i]);
    }
    if (rows.length < 6) return NaN;
    const beta = ols(rows, ys);
    if (!beta) return NaN;
    return beta[0] + beta[1] * k + beta[2] * k * k;
  }

  function referenceIndex(state, history) {
    if (state.linkedToFinal) return history.days.length - 1;
    return history.days.length;
  }

  function assess(state, history) {
    const h = history || getHistory();
    const work = materialize(state);
    const w = resolveWings(work);
    const yNow = ivFlyOf(w);
    const refEnd = referenceIndex(state, h);
    const refDays = h.days.slice(0, refEnd);
    const method = (partial) => Object.assign({
      score: NaN, percentile: NaN, fair: NaN, residual: NaN, z: NaN,
      classification: 'insufficient', n: 0, uncertainty: NaN, failure: null,
      units: 'decimal IV fly; ×100 = vol points'
    }, partial);

    if (!w.ordered || !isNum(yNow)) {
      return {
        ok: false,
        reason: w.notes.join(' ') || 'Fly is undefined.',
        methods: [],
        composite: method({ failure: 'undefined fly', name: 'Composite' }),
        yNow: NaN, wings: w, refN: refDays.length
      };
    }
    const kL = w.kL, kC = w.kC, kU = w.kU;
    const y = h.days.map((d) => flyOnDay(d, kL, kC, kU));
    const yRef = y.slice(0, refEnd).filter(isNum);
    const n = yRef.length;
    const med = median(yRef);
    const disp = mad(yRef, med);
    const scale = 1.4826 * disp;
    const zOf = (value, m, sc) => (isNum(value) && sc > 1e-8) ? (value - m) / sc : NaN;
    const low = n < 60;

    const m1 = method({
      id: 'percentile',
      name: '1. Historical percentile of raw fly',
      score: yNow,
      percentile: percentileRank(yRef, yNow),
      fair: med,
      residual: yNow - med,
      z: zOf(yNow, med, scale),
      n,
      uncertainty: scale / Math.sqrt(Math.max(n, 1)),
      failure: low ? 'low statistical power' : null,
      methodology: 'Rank of the live k-matched fly inside the causal 60-DTE sample. Positive z = expensive.'
    });
    m1.classification = m1.failure && n < 30 ? 'insufficient' : classifyZ(m1.z);

    const m2 = method({
      id: 'mad',
      name: '2. Robust median / MAD z-score',
      score: zOf(yNow, med, scale),
      fair: med,
      residual: yNow - med,
      z: zOf(yNow, med, scale),
      percentile: m1.percentile,
      n,
      uncertainty: disp,
      failure: !(scale > 1e-8) ? 'zero dispersion' : (low ? 'low statistical power' : null),
      methodology: 'z = (fly − median) / (1.4826 × MAD). Bands: |z|<1 fair, z≥1 expensive, z≤−1 cheap.'
    });
    m2.classification = m2.failure === 'zero dispersion' ? 'insufficient' : classifyZ(m2.z);

    const roll = yRef.slice(Math.max(0, yRef.length - 63));
    const rMed = median(roll), rScale = 1.4826 * mad(roll, rMed);
    const m3 = method({
      id: 'rolling',
      name: '3. Rolling 63-session z-score',
      score: zOf(yNow, rMed, rScale),
      fair: rMed,
      residual: yNow - rMed,
      z: zOf(yNow, rMed, rScale),
      percentile: percentileRank(roll, yNow),
      n: roll.length,
      uncertainty: rScale / Math.sqrt(Math.max(roll.length, 1)),
      failure: roll.length < 40 ? 'low statistical power' : null,
      methodology: 'Same robust z on the last 63 causal sessions only. Window cannot exceed the one-year sample.'
    });
    m3.classification = m3.failure ? 'insufficient' : classifyZ(m3.z);

    const yAtm = h.days.map((d) => flyOnDay(d, kC + (kL - kC), 0, kC + (kU - kC)));
    const yAtmRef = yAtm.slice(0, refEnd).filter(isNum);
    const liveAtm = quoteFly(work, sWingDelta(work));
    const kAtmL = -Math.abs(w.kC - w.kL);
    const kAtmU = Math.abs(w.kU - w.kC);
    const yAtmNowSeries = h.days.map((d) => flyOnDay(d, kAtmL, 0, kAtmU));
    const atmNow = flyOnDay({ ks: h.kGrid, iv: sampleIV(work, h.kGrid) }, kAtmL, 0, kAtmU);
    const aRef = yAtmNowSeries.slice(0, refEnd).filter(isNum);
    const aMed = median(aRef), aScale = 1.4826 * mad(aRef, aMed);
    const m4 = method({
      id: 'atm',
      name: '4. ATM-relative fly distribution',
      score: atmNow,
      fair: aMed,
      residual: atmNow - aMed,
      z: zOf(atmNow, aMed, aScale),
      percentile: percentileRank(aRef, atmNow),
      n: aRef.length,
      uncertainty: aScale / Math.sqrt(Math.max(aRef.length, 1)),
      failure: null,
      methodology: 'Center forced to k=0. Wing distances copied from the live fly. This is not the tradable package P&L. Live 25Δ quote is separate.'
    });
    m4.classification = classifyZ(m4.z);
    void liveAtm; void yAtm;

    const sviNow = fitLive(work);
    const sviFly = sviNow.ok ? ivFlyFromFn(sviNow.iv, w) : NaN;
    const m5 = method({
      id: 'svi',
      name: '5. Residual versus fitted SVI',
      score: yNow - sviFly,
      fair: sviFly,
      residual: yNow - sviFly,
      z: null,
      n: sviNow.ok ? sviNow.n : 0,
      uncertainty: sviNow.ok ? sviNow.rmseVolPts / 100 : NaN,
      failure: sviNow.ok ? null : sviNow.reason,
      methodology: 'SVI is fit to the live smile with stale quotes removed. Residual = market fly − SVI fly. A fitted curve is not a print.'
    });
    const sviResids = h.days.slice(0, refEnd).map((d) => {
      const mf = flyOnDay(d, kL, kC, kU);
      const sf = modelFlyOnDay(d, kL, kC, kU, 'svi');
      return isNum(mf) && isNum(sf) ? mf - sf : NaN;
    }).filter(isNum);
    const sMed = median(sviResids), sScale = 1.4826 * mad(sviResids, sMed);
    m5.z = zOf(m5.residual, sMed, sScale);
    m5.percentile = percentileRank(sviResids, m5.residual);
    m5.classification = m5.failure ? 'insufficient' : classifyZ(m5.z);

    const looFly = ivFlyFromFn((k) => polyIV(h.kGrid, sampleIV(work, h.kGrid), k, kC), w);
    const looSeries = h.days.slice(0, refEnd).map((d) => {
      const fn = (k) => polyIV(d.ks, d.iv, k, kC);
      const mf = flyOnDay(d, kL, kC, kU);
      const lf = ivFlyFromFn(fn, { kL, kC, kU, ordered: true, ivL: fn(kL), ivC: fn(kC), ivU: fn(kU) });
      return isNum(mf) && isNum(lf) ? mf - lf : NaN;
    });
    const looNow = yNow - looFly;
    const lMed = median(looSeries), lScale = 1.4826 * mad(looSeries, lMed);
    const m6 = method({
      id: 'loo',
      name: '6. Leave-one-out smile residual',
      score: looNow,
      fair: looFly,
      residual: looNow,
      z: zOf(looNow, lMed, lScale),
      percentile: percentileRank(looSeries.filter(isNum), looNow),
      n: looSeries.filter(isNum).length,
      uncertainty: lScale / Math.sqrt(Math.max(looSeries.length, 1)),
      failure: isNum(looFly) ? null : 'LOO fit failed',
      methodology: 'Quadratic in k refit with a ±0.025 neighborhood of the center removed, then the fly is recomputed. Isolates a local dislocation from the smooth smile.'
    });
    m6.classification = m6.failure ? 'insufficient' : classifyZ(m6.z);

    const pca = pcaBasis(h, refEnd);
    const liveVec = sampleIV(work, pca.ks);
    const recon = pca.reconstruct(liveVec);
    const pcaFly = flyFromSamples(pca.ks, recon, kL, kC, kU);
    const pcaResidNow = yNow - pcaFly;
    const pcaSeries = [];
    for (let i = 0; i < refEnd; i++) {
      const rec = pca.reconstruct(projectDay(h.days[i], pca.ks));
      const mf = flyOnDay(h.days[i], kL, kC, kU);
      const pf = flyFromSamples(pca.ks, rec, kL, kC, kU);
      if (isNum(mf) && isNum(pf)) pcaSeries.push(mf - pf);
    }
    const pMed = median(pcaSeries), pScale = 1.4826 * mad(pcaSeries, pMed);
    const m7 = method({
      id: 'pca',
      name: '7. PCA smile residual',
      score: pcaResidNow,
      fair: pcaFly,
      residual: pcaResidNow,
      z: zOf(pcaResidNow, pMed, pScale),
      percentile: percentileRank(pcaSeries, pcaResidNow),
      n: pca.n,
      uncertainty: pScale / Math.sqrt(Math.max(pcaSeries.length, 1)),
      failure: pca.n < 40 ? 'low statistical power' : null,
      methodology: 'Three principal components of the causal k-grid. When controls still match the final session, that session is left out of the basis. The historical residual path uses this same basis, so it is a descriptive in-sample path; the live residual does not use a future basis. Reconstruction error is not a trade.'
    });
    m7.classification = m7.failure ? 'insufficient' : classifyZ(m7.z);

    const reg = regressFly(h, y, refEnd, work, kL, kC, kU);
    const m8 = method({
      id: 'regression',
      name: '8. Conditional regression residual',
      score: reg.residual,
      fair: reg.yhat,
      residual: reg.residual,
      z: reg.z,
      percentile: reg.percentile,
      n: reg.n,
      uncertainty: reg.sigma,
      failure: reg.failure,
      methodology: 'fly ~ 1 + ATM + put skew + 21-day realized vol. Coefficients use only causal sessions. Contemporaneous controls, not a forecast. Positive residual = expensive after those controls.'
    });
    m8.classification = m8.failure ? 'insufficient' : classifyZ(m8.z);

    const m9 = bucketMethod(h, refEnd, work, y, yNow, (d) => Math.abs(d.shape.putSkew - work.putSkew) < 0.12, '9. Downside-skew-conditioned valuation', 'Sessions whose put-skew coefficient is within 0.12 of the live smile.');
    const m10 = bucketMethod(h, refEnd, work, y, yNow, (d) => Math.abs(d.rv - rvOf(work, h)) < 0.025, '10. Realized-vol-conditioned valuation', 'Sessions with 21-day realized vol within 2.5 vol points of the live trailing RV.');
    const m11 = bucketMethod(h, refEnd, work, y, yNow, (d) => Math.abs(d.downsideRv - downsideOf(work, h)) < 0.03, '11. Downside-realized-vol-conditioned valuation', 'Conditioned on downside realized volatility (negative sessions only).');
    const liveTail = tailOf(work);
    const m12 = bucketMethod(h, refEnd, work, y, yNow, (d) => Math.abs(d.tail - liveTail) < 0.008, '12. Risk-neutral tail-conditioned valuation', 'Tail proxy is σ(k=−0.08) − σ(0) on the 60-DTE smile.');
    const atmMed = median(refDays.map((d) => d.shape.atm));
    const hi = work.atm >= atmMed;
    const m13 = bucketMethod(h, refEnd, work, y, yNow, (d) => (d.shape.atm >= atmMed) === hi, '13. Regime-conditioned valuation', hi ? 'High-ATM regime versus the causal median ATM.' : 'Low-ATM regime versus the causal median ATM.');

    const neighNow = 0.5 * (
      (flyOnDay({ ks: h.kGrid, iv: sampleIV(work, h.kGrid) }, kL + 0.02, kC + 0.02, kU + 0.02)) +
      (flyOnDay({ ks: h.kGrid, iv: sampleIV(work, h.kGrid) }, kL - 0.02, kC - 0.02, kU - 0.02))
    );
    const gapNow = yNow - neighNow;
    const gaps = h.days.slice(0, refEnd).map((d) => {
      const c0 = flyOnDay(d, kL, kC, kU);
      const up = flyOnDay(d, kL + 0.02, kC + 0.02, kU + 0.02);
      const dn = flyOnDay(d, kL - 0.02, kC - 0.02, kU - 0.02);
      return isNum(c0) && isNum(up) && isNum(dn) ? c0 - 0.5 * (up + dn) : NaN;
    }).filter(isNum);
    const gMed = median(gaps), gScale = 1.4826 * mad(gaps, gMed);
    const m14 = method({
      id: 'neighbor',
      name: '14. Neighboring-strike consistency',
      score: gapNow,
      fair: neighNow,
      residual: gapNow - gMed,
      z: zOf(gapNow, gMed, gScale),
      percentile: percentileRank(gaps, gapNow),
      n: gaps.length,
      uncertainty: gScale,
      failure: gaps.length < 30 ? 'low statistical power' : null,
      methodology: 'Live fly minus the average fly at centers shifted by ±0.02 in k. A large positive gap is a local rich print versus nearby strikes, not versus history of the level.'
    });
    m14.classification = m14.failure ? 'insufficient' : classifyZ(m14.z);

    const fairs = [m2.fair, m5.fair, m6.fair, m7.fair, m8.fair].filter(isNum);
    const ensembleFair = median(fairs);
    const ensDev = yNow - ensembleFair;
    const ensZs = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13].map((m) => m.z).filter(isNum);
    const m15 = method({
      id: 'ensemble',
      name: '15. Model-ensemble fair-value deviation',
      score: ensDev,
      fair: ensembleFair,
      residual: ensDev,
      z: mean(ensZs),
      percentile: m1.percentile,
      n: fairs.length,
      uncertainty: ensZs.length ? Math.sqrt(mean(ensZs.map((z) => (z - mean(ensZs)) ** 2))) : NaN,
      failure: fairs.length < 3 ? 'not enough model fairs' : null,
      methodology: 'Fair value is the median of the median, SVI, LOO, PCA, and regression fairs. Composite z is the mean of available method z-scores. Methods share data; this is not fifteen independent tests.'
    });
    m15.classification = m15.failure ? 'insufficient' : classifyZ(m15.z);

    const methods = [m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11, m12, m13, m14, m15];
    const zs = methods.slice(0, 13).map((m) => m.z).filter(isNum);
    const compositeZ = mean(zs);
    const corrPairs = [];
    const seriesBundle = {
      level: y.slice(0, refEnd),
      svi: h.days.slice(0, refEnd).map((d) => {
        const mf = flyOnDay(d, kL, kC, kU);
        const sf = modelFlyOnDay(d, kL, kC, kU, 'svi');
        return isNum(mf) && isNum(sf) ? mf - sf : NaN;
      }),
      loo: looSeries
    };
    const corr = pearson(seriesBundle.level, seriesBundle.svi);
    const corr2 = pearson(seriesBundle.svi, seriesBundle.loo);
    let correlationWarning = null;
    if ((isNum(corr) && Math.abs(corr) > 0.8) || (isNum(corr2) && Math.abs(corr2) > 0.8)) {
      correlationWarning = 'Several scores move together (level/SVI corr ' + fmt(corr, 2) + ', SVI/LOO corr ' + fmt(corr2, 2) + '). The composite is not independent confirmation.';
    }
    corrPairs.push(corr, corr2);
    const composite = method({
      id: 'composite',
      name: 'Composite',
      score: compositeZ,
      fair: ensembleFair,
      residual: yNow - ensembleFair,
      z: compositeZ,
      percentile: m1.percentile,
      n: zs.length,
      uncertainty: m15.uncertainty,
      failure: zs.length < 4 ? 'too few successful methods' : null,
      classification: zs.length < 4 ? 'insufficient' : classifyZ(compositeZ),
      methodology: 'Equal-weight mean of available z-scores after the correlation check. Thresholds are research bands, not hypothesis tests.'
    });

    return {
      ok: true,
      yNow, yNowPts: yNow * 100,
      wings: w,
      refN: n,
      sampleN: h.days.length,
      warmupExcluded: h.warmup.length,
      linkedToFinal: !!state.linkedToFinal,
      sign: 'Positive residual = expensive. Negative = cheap. Not a P&L forecast.',
      methods, composite, correlationWarning, correlations: corrPairs,
      svi: sviNow,
      atmFly25: quoteFly(work, 0.25).fly,
      atmFlyUser: atmNow
    };
  }

  function sWingDelta(s) { return s.wingDelta || 0.25; }

  function sampleIV(s, ks) {
    return ks.map((k) => {
      const K = forward(s) * Math.exp(k);
      const info = ivAt(s, K);
      if (s.dropStale && info.stale) return NaN;
      return info.iv;
    });
  }
  function ivFlyFromFn(fn, w) {
    const a = fn(w.kL), b = fn(w.kC), c = fn(w.kU);
    if (![a, b, c].every(isNum)) return NaN;
    return 0.5 * (a + c) - b;
  }
  function flyFromSamples(ks, ivs, kL, kC, kU) {
    const grid = ks.map((k, i) => ({ k, iv: ivs[i] }));
    const a = interpKGrid(grid, kL, 60 / 365).iv;
    const b = interpKGrid(grid, kC, 60 / 365).iv;
    const c = interpKGrid(grid, kU, 60 / 365).iv;
    if (![a, b, c].every(isNum)) return NaN;
    return 0.5 * (a + c) - b;
  }
  function projectDay(day, ks) {
    return ks.map((k) => ivAtKStored(day.ks, day.iv, k));
  }
  function fitLive(s) {
    const ks = kGrid();
    const ivs = sampleIV(s, ks);
    const stale = ks.map((_, i) => !isNum(ivs[i]));
    return fitSVI(ks, ivs, s.T, stale);
  }

  const _pcaCache = new Map();
  function pcaBasis(history, end) {
    const key = end + ':' + history.seed;
    if (_pcaCache.has(key)) return _pcaCache.get(key);
    const ks = [];
    for (let k = -0.20; k <= 0.12 + 1e-9; k += 0.04) ks.push(round(k, 4));
    const rows = [];
    for (let i = 0; i < end; i++) rows.push(projectDay(history.days[i], ks));
    const n = rows.length;
    const p = ks.length;
    const mu = Array(p).fill(0);
    if (n < 10) {
      const empty = { ks, n, minObs: 30, mean: mu, reconstruct: (v) => v.slice() };
      _pcaCache.set(key, empty);
      return empty;
    }
    for (const row of rows) for (let j = 0; j < p; j++) mu[j] += row[j] / n;
    const cov = Array.from({ length: p }, () => Array(p).fill(0));
    for (const row of rows) {
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) {
        cov[a][b] += (row[a] - mu[a]) * (row[b] - mu[b]) / (n - 1);
      }
    }
    const comps = [];
    const work = cov.map((row) => row.slice());
    for (let c = 0; c < 3; c++) {
      let v = Array(p).fill(0);
      v[c] = 1;
      for (let it = 0; it < 30; it++) {
        const w = work.map((row) => dot(row, v));
        const norm = hypot(w) || 1;
        v = w.map((x) => x / norm);
      }
      const Av = work.map((row) => dot(row, v));
      const lambda = dot(v, Av);
      comps.push({ v, lambda });
      for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) work[a][b] -= lambda * v[a] * v[b];
    }
    const basis = {
      ks, n, minObs: 30, mean: mu, comps,
      reconstruct(vec) {
        const x = vec.map((val, j) => (isNum(val) ? val : mu[j]));
        const out = mu.slice();
        for (const comp of comps) {
          let score = 0;
          for (let j = 0; j < p; j++) score += (x[j] - mu[j]) * comp.v[j];
          for (let j = 0; j < p; j++) out[j] += score * comp.v[j];
        }
        return out;
      }
    };
    _pcaCache.set(key, basis);
    return basis;
  }

  function rvOf(state, history) {
    const h = history || getHistory();
    if (state.linkedToFinal) return h.days[h.days.length - 1].rv;
    return h.days[h.days.length - 1].rv;
  }
  function downsideOf(state, history) {
    const h = history || getHistory();
    return h.days[h.days.length - 1].downsideRv;
  }
  function tailOf(state) {
    const F = forward(ensureT(clone(state)));
    const s = materialize(state);
    const a = ivAt(s, F * Math.exp(-0.08)).iv;
    const b = ivAt(s, F).iv;
    return a - b;
  }

  function regressFly(history, y, refEnd, work, kL, kC, kU) {
    const X = [], yy = [];
    for (let i = 0; i < refEnd; i++) {
      if (!isNum(y[i])) continue;
      const d = history.days[i];
      X.push([1, d.shape.atm, d.shape.putSkew, d.rv]);
      yy.push(y[i]);
    }
    if (yy.length < 30) return { residual: NaN, yhat: NaN, z: NaN, percentile: NaN, n: yy.length, sigma: NaN, failure: 'low statistical power' };
    const beta = ols(X, yy);
    if (!beta) return { residual: NaN, yhat: NaN, z: NaN, percentile: NaN, n: yy.length, sigma: NaN, failure: 'regression failed' };
    const fitted = [];
    for (let i = 0; i < yy.length; i++) {
      fitted.push(yy[i] - dot(beta, X[i]));
    }
    const sigma = Math.sqrt(mean(fitted.map((e) => e * e)));
    const xNow = [1, work.atm, work.putSkew, rvOf(work, history)];
    const yhat = dot(beta, xNow);
    const residual = y[Math.min(y.length - 1, refEnd)] !== undefined && work.linkedToFinal ? (yNowFrom(work, kL, kC, kU) - yhat) : (yNowFrom(work, kL, kC, kU) - yhat);
    const residNow = yNowFrom(work, kL, kC, kU) - yhat;
    const z = sigma > 1e-8 ? residNow / sigma : NaN;
    return {
      residual: residNow, yhat, z, percentile: percentileRank(fitted, residNow),
      n: yy.length, sigma, failure: null, beta
    };
  }
  function yNowFrom(work, kL, kC, kU) {
    const ivs = [kL, kC, kU].map((k) => ivAt(work, forward(work) * Math.exp(k)).iv);
    if (!ivs.every(isNum)) return NaN;
    return 0.5 * (ivs[0] + ivs[2]) - ivs[1];
  }

  function bucketMethod(history, refEnd, work, y, yNow, pred, name, methodology) {
    const sample = [];
    for (let i = 0; i < refEnd; i++) if (pred(history.days[i]) && isNum(y[i])) sample.push(y[i]);
    const med = median(sample);
    const scale = 1.4826 * mad(sample, med);
    const z = isNum(yNow) && scale > 1e-8 ? (yNow - med) / scale : NaN;
    const failure = sample.length < 30 ? 'low statistical power' : (!(scale > 1e-8) ? 'zero dispersion' : null);
    return {
      id: name.slice(0, 2),
      name,
      score: yNow,
      percentile: percentileRank(sample, yNow),
      fair: med,
      residual: yNow - med,
      z,
      classification: failure ? 'insufficient' : classifyZ(z),
      n: sample.length,
      uncertainty: scale / Math.sqrt(Math.max(sample.length, 1)),
      failure,
      units: 'decimal IV fly; ×100 = vol points',
      methodology
    };
  }

  function decompose(state, history) {
    const h = history || getHistory();
    const work = materialize(state);
    const refEnd = referenceIndex(state, h);
    const ref = h.days.slice(0, refEnd);
    const medShape = {
      atm: median(ref.map((d) => d.shape.atm)),
      putSkew: median(ref.map((d) => d.shape.putSkew)),
      callSkew: median(ref.map((d) => d.shape.callSkew)),
      curvature: median(ref.map((d) => d.shape.curvature)),
      asymmetry: median(ref.map((d) => d.shape.asymmetry)),
      wingSteepness: median(ref.map((d) => d.shape.wingSteepness)),
      bump: 0
    };
    const w = resolveWings(work);
    const factors = ['atm', 'putSkew', 'callSkew', 'curvature', 'asymmetry', 'wingSteepness', 'bump'];
    function flyWith(shape) {
      const s = withPatches(work, shape);
      s.quoteGrid = null;
      delete s._pin;
      s.bump = shape.bump != null ? shape.bump : 0;
      const ww = resolveWings(s);
      return ivFlyOf(ww);
    }
    const currentShape = {
      atm: work.atm, putSkew: work.putSkew, callSkew: work.callSkew, curvature: work.curvature,
      asymmetry: work.asymmetry, wingSteepness: work.wingSteepness, bump: work.bump || 0
    };
    const baseFly = flyWith(medShape);
    const fullFly = flyWith(currentShape);
    const n = factors.length;
    const N = 1 << n;
    const values = new Array(N);
    for (let mask = 0; mask < N; mask++) {
      const shape = Object.assign({}, medShape);
      for (let i = 0; i < n; i++) if (mask & (1 << i)) shape[factors[i]] = currentShape[factors[i]];
      values[mask] = flyWith(shape);
    }
    const fact = (k) => {
      let v = 1;
      for (let i = 2; i <= k; i++) v *= i;
      return v;
    };
    const phi = [];
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let mask = 0; mask < N; mask++) {
        if (mask & (1 << i)) continue;
        const s = popcount(mask);
        const weight = fact(s) * fact(n - s - 1);
        sum += weight * (values[mask | (1 << i)] - values[mask]);
      }
      phi.push(sum / fact(n));
    }
    const waterfall = [];
    let running = baseFly;
    const order = factors.slice();
    let cursor = Object.assign({}, medShape);
    for (const name of order) {
      cursor[name] = currentShape[name];
      const next = flyWith(cursor);
      waterfall.push({ factor: name, from: running, to: next, delta: next - running });
      running = next;
    }
    const labels = {
      atm: 'A. Overall volatility level',
      putSkew: 'B. Downside skew',
      callSkew: 'C. Upside skew',
      curvature: 'D. Smile curvature',
      asymmetry: 'E. Wing asymmetry (cubic)',
      wingSteepness: 'F. Wing steepness',
      bump: 'G. Local dislocation bump'
    };
    const notes = {
      atm: 'For fixed log-moneyness wings a parallel ATM shift cancels in the raw IV fly. A nonzero ATM Shapley value means wings are in strike or delta space, so the level moves the strikes.',
      putSkew: 'Isolated by moving only the put-side slope from the causal median to the live value.',
      callSkew: 'Isolated call-side slope.',
      curvature: 'Second-order k² term, separated from the slope.',
      asymmetry: 'k³ term. Also see the put-versus-call wing IV gap below.',
      wingSteepness: '|k|³ term. Distinct from quadratic curvature.',
      bump: 'Gaussian IV bump. Raising the center IV lowers the fly (cheaper curvature).'
    };
    const components = factors.map((name, i) => ({
      id: name,
      name: labels[name],
      observed: currentShape[name],
      reference: medShape[name],
      contribution: phi[i],
      contributionPts: phi[i] * 100,
      residualAfter: fullFly - phi[i],
      uncertainty: null,
      methodology: notes[name] + ' Shapley attribution versus the causal median shape. Order-independent. The waterfall is a different, order-dependent view.'
    }));
    const wingGap = isNum(w.ivL) && isNum(w.ivU) ? (w.ivL - w.ivU) : NaN;
    components.push({
      id: 'wing-gap',
      name: 'E2. Put wing IV minus call wing IV',
      observed: wingGap,
      reference: 0,
      contribution: wingGap / 2,
      contributionPts: wingGap * 50,
      residualAfter: null,
      uncertainty: null,
      methodology: 'Descriptive asymmetry of the two wing IVs. Not additive with the Shapley cubic term; shown so the two wings are not collapsed into one number.'
    });
    const micro = microstructure(work, w);
    components.push(micro.component);
    const interp = interpolationEffect(work);
    components.push(interp);
    const regime = assess(state, h);
    components.push({
      id: 'regime',
      name: 'H. Historical regime / tail',
      observed: regime.yNow,
      reference: regime.composite.fair,
      contribution: regime.yNow - regime.composite.fair,
      contributionPts: (regime.yNow - regime.composite.fair) * 100,
      residualAfter: 0,
      uncertainty: regime.composite.uncertainty,
      methodology: 'Live fly minus the ensemble fair from the one-year 60-DTE sample. Drawdown, downside RV, and the 10-delta-style tail proxy are inside methods 11–13. This is association, not a causal crash premium.'
    });
    const sumPhi = phi.reduce((a, b) => a + b, 0);
    return {
      baseFly, fullFly, reconGap: (fullFly - baseFly) - sumPhi,
      shapley: phi, factors, waterfall, components,
      orderNote: 'Waterfall order is ATM → put skew → call skew → curvature → asymmetry → wing → bump. A different order moves the steps. Shapley values do not.',
      sign: 'Positive contribution means that factor increases the IV fly (richer / more expensive curvature).'
    };
  }
  function popcount(mask) {
    let c = 0;
    while (mask) { mask &= mask - 1; c++; }
    return c;
  }
  function microstructure(s, w) {
    const type = (s.strategy || '').indexOf('put') >= 0 ? 'put' : 'call';
    const legs = [
      { type, K: w.Kl, qty: 0.5 },
      { type, K: w.Kc, qty: -1 },
      { type, K: w.Ku, qty: 0.5 }
    ];
    const mid = packagePoints(s, legs, 'mid').points;
    const exe = packagePoints(s, legs, 'executable').points;
    const gap = exe - mid;
    return {
      component: {
        id: 'micro',
        name: 'J. Market microstructure',
        observed: exe,
        reference: mid,
        contribution: gap,
        contributionPts: null,
        residualAfter: gap,
        uncertainty: Math.abs(gap),
        methodology: 'Executable normalized fly buys the wings at the ask and sells the body at the bid, plus slippage. If the historical IV-fly edge is smaller than this price gap, the signal is inside the spread. Synthetic spreads are a model, not a quote.'
      },
      mid, exe, gap
    };
  }
  function interpolationEffect(s) {
    const shape = smoothShape(s);
    shape.bump = s.bump; shape.bumpK = s.bumpK; shape.termSlope = s.termSlope;
    const k = 0;
    const sl = varianceInterp(k, shape, 365);
    const direct = shapeIV(k, Object.assign({}, shape, { atm: s.atm }));
    return {
      id: 'tenor',
      name: 'I. Time-to-expiry / interpolation',
      observed: sl.iv,
      reference: direct,
      contribution: sl.iv - direct,
      contributionPts: (sl.iv - direct) * 100,
      residualAfter: sl.iv - direct,
      uncertainty: null,
      methodology: 'At k=0, 60-DTE total-variance interpolation of the 45/75 slices minus the direct 60-day parametric IV. The research sample uses the interpolated smile. A nonzero gap is the maturity-interpolation effect, not a trade.'
    };
  }

  function metricOn(s, name) {
    const w = resolveWings(s);
    if (name === 'ivFly') return ivFlyOf(w);
    if (name === 'priceFly') {
      const p = priceFly(s, w);
      if (s.priceConvention === 'unnormalized') return p.unnormalized;
      if (s.priceConvention === 'custom') return p.custom;
      return p.normalized;
    }
    const legs = unitLegs(s, w);
    if (name === 'premium') return packagePoints(s, legs, 'mid').points;
    if (name === 'pnl') {
      const debit = isNum(s.entryPremium) ? s.entryPremium : packagePoints(materialize(Object.assign(clone(s), { shocks: zeroShocks() })), unitLegs(materialize(Object.assign(clone(s), { shocks: zeroShocks() }))), 'mid').points;
      return packagePoints(s, legs, 'mid').points - debit;
    }
    const g = greeksOf(s, legs);
    if (name === 'delta') return g.sum.delta;
    if (name === 'gamma') return g.sum.gamma;
    if (name === 'vega') return g.sum.vega;
    if (name === 'histZ') return NaN;
    return ivFlyOf(w);
  }

  function attributeScenario(base, metricName) {
    const metric = metricName || 'ivFly';
    const shocks = Object.assign(zeroShocks(), base.shocks || {});
    const keys = ['dS', 'dAtm', 'dPut', 'dCall', 'dCurv', 'dWing', 'dDays', 'dWingLog', 'dWingStrike', 'dWingDelta'];
    const active = keys.filter((k) => Math.abs(shocks[k] || 0) > 1e-12);
    const f = (partial) => {
      const sh = zeroShocks();
      for (const k of Object.keys(partial)) sh[k] = partial[k];
      return metricOn(materialize(base, sh), metric);
    };
    const baseVal = f({});
    const full = f(shocks);
    const ofat = active.map((k) => {
      const only = {};
      only[k] = shocks[k];
      const v = f(only);
      return { factor: k, shocked: v, baseline: baseVal, delta: v - baseVal, pct: baseVal !== 0 && isNum(baseVal) ? (v - baseVal) / Math.abs(baseVal) : NaN };
    });
    const pairs = [];
    for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      const fab = f({ [a]: shocks[a], [b]: shocks[b] });
      const fa = f({ [a]: shocks[a] });
      const fb = f({ [b]: shocks[b] });
      pairs.push({ a, b, interaction: fab - fa - fb + baseVal });
    }
    let shapley = [];
    let shapleyGap = NaN;
    const use = active.slice(0, 8);
    if (use.length) {
      const N = 1 << use.length;
      const values = new Array(N);
      for (let mask = 0; mask < N; mask++) {
        const partial = {};
        for (let i = 0; i < use.length; i++) if (mask & (1 << i)) partial[use[i]] = shocks[use[i]];
        values[mask] = f(partial);
      }
      const fact = (k) => { let v = 1; for (let i = 2; i <= k; i++) v *= i; return v; };
      shapley = use.map((name, i) => {
        let sum = 0;
        for (let mask = 0; mask < N; mask++) {
          if (mask & (1 << i)) continue;
          const s = popcount(mask);
          const weight = fact(s) * fact(use.length - s - 1);
          sum += weight * (values[mask | (1 << i)] - values[mask]);
        }
        return { factor: name, value: sum / fact(use.length) };
      });
      const total = shapley.reduce((a, b) => a + b.value, 0);
      shapleyGap = (values[N - 1] - values[0]) - total;
    }
    const ofatSum = ofat.reduce((a, b) => a + b.delta, 0);
    return {
      metric, baseline: baseVal, full, change: full - baseVal,
      ofat, pairs, shapley, shapleyGap,
      ofatGap: (full - baseVal) - ofatSum,
      note: use.length < active.length ? 'Shapley used the first 8 active shocks.' : 'Shapley is order-independent and should sum to the total change.'
    };
  }

  function arbitrageReport(state) {
    const s = materialize(state);
    const F = forward(s);
    const ks = linspace(-0.2, 0.15, 15);
    const issues = [];
    let minFly = Infinity;
    let calendarBad = 0;
    for (const k of ks) {
      const iv = ivAt(s, F * Math.exp(k));
      if (!(iv.iv > 0)) issues.push('Non-positive IV at k=' + k.toFixed(2));
      const sl = varianceInterp(k, s, 365);
      if (!sl.calendarOk) calendarBad++;
      const K = F * Math.exp(k);
      const width = Math.max(5, s.S * 0.01);
      const type = 'call';
      if (K - width > 0) {
        const pL = priceOf(s, K - width, type).mid;
        const pC = priceOf(s, K, type).mid;
        const pU = priceOf(s, K + width, type).mid;
        const fly = pL - 2 * pC + pU;
        if (fly < minFly) minFly = fly;
      }
    }
    if (minFly < -1e-4) issues.push('Call butterfly arbitrage: unnormalized price fly ' + minFly.toExponential(2) + ' < 0.');
    if (calendarBad) issues.push(calendarBad + ' log-moneyness nodes fail calendar total-variance order on the 45/75 synthetic tenors.');
    const fit = fitLive(s);
    if (fit.ok && fit.minVariance < 0) issues.push('SVI minimum total variance is negative.');
    return {
      ok: issues.length === 0,
      issues,
      minCallFly: minFly,
      svi: fit.ok ? { rmseVolPts: fit.rmseVolPts, minVariance: fit.minVariance, rho: fit.rho, b: fit.b } : { error: fit.reason },
      positiveVariance: true
    };
  }

  function smileSeries(state, history) {
    const h = history || getHistory();
    const base = materialize(state, zeroShocks());
    const scen = materialize(state);
    const F = forward(scen);
    const ks = linspace(-0.28, 0.18, 70);
    const rows = ks.map((k) => {
      const K = F * Math.exp(k);
      const market = ivAt(scen, K);
      const baseInfo = ivAt(base, base.forward ? base.S : K);
      const Kb = forward(base) * Math.exp(k);
      const bInfo = ivAt(base, Kb);
      return { k, K, market: market.iv, baseline: bInfo.iv, extrapolated: market.extrapolated, stale: market.stale };
    });
    const ivs = rows.map((r) => r.market);
    const svi = fitSVI(rows.map((r) => r.k), ivs, scen.T, rows.map((r) => r.stale));
    const ssvi = fitSSVI(rows.map((r) => r.k), ivs, scen.T, scen.atm);
    const pca = pcaBasis(h, referenceIndex(state, h));
    const liveVec = pca.ks.map((k) => ivAt(scen, F * Math.exp(k)).iv);
    const recon = pca.reconstruct(liveVec);
    const histMean = pca.mean;
    return {
      rows, svi, ssvi,
      quadratic: ks.map((k) => shapeIV(k, smoothShape(scen))),
      pcaK: pca.ks, pca: recon, histMean,
      markers: markerSet(scen)
    };
  }
  function markerSet(s) {
    const w = resolveWings(s);
    const F = forward(s);
    const deltas = [0.10, 0.25, 0.35, 0.50];
    const pts = [];
    for (const d of deltas) {
      const Kc = strikeForDelta(s, d, 'call');
      const Kp = strikeForDelta(s, d, 'put');
      pts.push({ name: d * 100 + 'Δ call', K: Kc, k: Math.log(Kc / F), delta: d });
      pts.push({ name: d * 100 + 'Δ put', K: Kp, k: Math.log(Kp / F), delta: -d });
    }
    return { wings: w, deltas: pts, atmK: F };
  }

  function deltaSmile(state) {
    const s = materialize(state);
    const ks = linspace(-0.28, 0.18, 60);
    const F = forward(s);
    return ks.map((k) => {
      const K = F * Math.exp(k);
      const type = k < 0 ? 'put' : 'call';
      return {
        k, K,
        iv: ivAt(s, K).iv,
        delta: signedDelta(s, K, type),
        deltaCall: signedDelta(s, K, 'call'),
        deltaPut: signedDelta(s, K, 'put')
      };
    }).filter((p) => isNum(p.delta) && isNum(p.iv));
  }

  function flySweepStrike(state, history) {
    const h = history || getHistory();
    const s0 = materialize(state);
    const F = forward(s0);
    const centers = linspace(F * 0.86, F * 1.12, 36);
    return centers.map((Kc) => {
      const s = withPatches(s0, { centerMode: 'strike', centerK: Kc });
      if (s0._pin) s._pin = s0._pin;
      if (s0.quoteGrid) s.quoteGrid = s0.quoteGrid;
      const w = resolveWings(s);
      const y = ivFlyOf(w);
      const refEnd = referenceIndex(state, h);
      const sample = [];
      for (let i = 0; i < refEnd; i++) {
        const fy = flyOnDay(h.days[i], w.kL, w.kC, w.kU);
        if (isNum(fy)) sample.push(fy);
      }
      const med = median(sample);
      const sc = 1.4826 * mad(sample, med);
      const svi = fitLive(s);
      return {
        K: Kc, k: Math.log(Kc / F), fly: y, ordered: w.ordered,
        fair: med, z: sc > 1e-8 ? (y - med) / sc : NaN,
        svi: svi.ok ? ivFlyFromFn(svi.iv, w) : NaN,
        price: w.ordered ? priceFly(s, w).normalized : NaN
      };
    });
  }

  function flySweepDelta(state, history) {
    const s0 = materialize(state);
    const h = history || getHistory();
    const deltas = linspace(0.08, 0.50, 18);
    const out = [];
    for (const side of ['put', 'call']) {
      for (const d of deltas) {
        const s = withPatches(s0, { centerMode: 'delta', centerSide: side, centerDelta: d });
        if (s0._pin) s._pin = s0._pin;
        if (s0.quoteGrid) s.quoteGrid = s0.quoteGrid;
        const w = resolveWings(s);
        const y = ivFlyOf(w);
        out.push({ side, delta: side === 'put' ? -d : d, fly: y, ordered: w.ordered, K: w.Kc });
      }
    }
    void h;
    return out;
  }

  function flySweepWidth(state) {
    const s0 = materialize(state);
    const widths = s0.wingMode === 'strike' ? linspace(20, 400, 28) : s0.wingMode === 'delta' ? linspace(0.05, 0.45, 20) : linspace(0.01, 0.18, 28);
    return widths.map((width) => {
      const patch = {};
      if (s0.wingMode === 'strike') patch.wingStrike = width;
      else if (s0.wingMode === 'delta') patch.wingDelta = width;
      else patch.wingLog = width;
      const s = withPatches(s0, patch);
      if (s0._pin) s._pin = s0._pin;
      if (s0.quoteGrid) s.quoteGrid = s0.quoteGrid;
      const w = resolveWings(s);
      const y = ivFlyOf(w);
      const dk = isNum(w.kU) && isNum(w.kL) ? (w.kU - w.kL) : NaN;
      const pf = w.ordered ? priceFly(s, w) : { normalized: NaN };
      const smooth = withPatches(s, { bump: 0, quoteGrid: null });
      delete smooth._pin;
      return {
        width, fly: y, flyPerK: isNum(dk) && dk !== 0 ? y / dk : NaN,
        price: pf.normalized, model: ivFlyOf(resolveWings(smooth)), ordered: w.ordered
      };
    });
  }

  function priceFlySweep(state) {
    const s0 = materialize(state);
    const F = forward(s0);
    const spots = linspace(s0.S * 0.85, s0.S * 1.15, 40);
    const modes = ['fixed', 'shift', 'log', 'delta'];
    const anchor = resolveWings(materialize(state, zeroShocks()));
    const series = {};
    for (const mode of modes) {
      series[mode] = spots.map((S) => {
        const s = withPatches(s0, { S });
        delete s._pin;
        if (mode === 'fixed') {
          s.centerMode = 'strike';
          s.centerK = anchor.Kc;
          s.wingMode = 'strike';
          s.wingStrike = 0.5 * ((anchor.Kc - anchor.Kl) + (anchor.Ku - anchor.Kc));
          s.wingAsym = 0.5 * ((anchor.Ku - anchor.Kc) - (anchor.Kc - anchor.Kl));
          if (s0.quoteGrid && s0.sticky === 'moneyness') s.quoteGrid = s0.quoteGrid;
          if (s0.sticky === 'strike' && s0._pin) s._pin = s0._pin;
        } else if (mode === 'shift') {
          const dS = S - s0.S;
          s.centerMode = 'strike';
          s.centerK = anchor.Kc + dS;
          s.wingMode = 'strike';
          s.wingStrike = 0.5 * ((anchor.Kc - anchor.Kl) + (anchor.Ku - anchor.Kc));
          s.wingAsym = 0.5 * ((anchor.Ku - anchor.Kc) - (anchor.Kc - anchor.Kl));
          s.quoteGrid = null;
        } else if (mode === 'log') {
          s.centerMode = 'strike';
          s.quoteGrid = s0.quoteGrid;
          const kC = Math.log(anchor.Kc / F);
          s.centerK = forward(s) * Math.exp(kC);
          s.wingMode = 'log';
          s.wingLog = 0.5 * ((anchor.kC - anchor.kL) + (anchor.kU - anchor.kC));
          s.wingAsymLog = 0.5 * ((anchor.kU - anchor.kC) - (anchor.kC - anchor.kL));
        } else {
          s.centerMode = 'delta';
          s.centerDelta = s0.centerMode === 'delta' ? s0.centerDelta : 0.5;
          s.centerSide = s0.centerSide || 'call';
          s.wingMode = 'delta';
          s.quoteGrid = null;
        }
        const w = resolveWings(s);
        const p = w.ordered ? priceFly(s, w) : { normalized: NaN };
        return { S, price: p.normalized, iv: ivFlyOf(w), Kc: w.Kc };
      });
    }
    const centers = linspace(F * 0.86, F * 1.12, 36).map((Kc) => {
      const s = withPatches(s0, { centerMode: 'strike', centerK: Kc });
      if (s0._pin) s._pin = s0._pin;
      if (s0.quoteGrid) s.quoteGrid = s0.quoteGrid;
      const w = resolveWings(s);
      return { K: Kc, price: w.ordered ? priceFly(s, w).normalized : NaN };
    });
    return { bySpot: series, byCenter: centers, note: 'Fixed strikes, spot-shifted strikes, constant log-moneyness, and constant delta are separate experiments.' };
  }

  function payoffSeries(state) {
    const s = materialize(state);
    const base = materialize(state, zeroShocks());
    const w = resolveWings(s);
    const legs = unitLegs(s, w);
    const baseLegs = unitLegs(base, resolveWings(base));
    const debit = isNum(state.entryPremium) ? state.entryPremium : packagePoints(base, baseLegs, 'mid').points;
    const fees = feePoints(s, legs);
    const lim = extrema(legs, debit);
    const bes = breakevens(legs, debit);
    const spots = linspace(Math.max(1, s.S * 0.7), s.S * 1.3, 80);
    const mtm = spots.map((S) => {
      const moved = withPatches(s, { S });
      if (s._pin) moved._pin = s._pin;
      if (s.quoteGrid && s.sticky !== 'strike') moved.quoteGrid = s.quoteGrid;
      const legsM = unitLegs(moved, resolveWings(moved));
      const use = s.sticky === 'strike' || state.centerMode === 'strike' ? legs : legsM;
      return {
        S,
        expiry: (payoff(legs, S) - debit) * (s.tradeQty || 1),
        mtm: (packagePoints(moved, use, 'mid').points - debit) * (s.tradeQty || 1)
      };
    });
    const exe = packagePoints(s, legs, 'executable').points;
    return {
      legs, debit, fees, breakevens: bes, extrema: lim, spots: mtm,
      mid: packagePoints(s, legs, 'mid').points,
      executable: exe,
      theoreticalPnL: (packagePoints(s, legs, 'mid').points - debit) * (s.tradeQty || 1),
      executablePnL: (exe - debit - fees) * (s.tradeQty || 1),
      dollarsPerPoint: s.multiplier || 100
    };
  }

  function greekSeries(state) {
    const s = materialize(state);
    const legs = unitLegs(s, resolveWings(s));
    const g = greeksOf(s, legs);
    const spots = linspace(s.S * 0.85, s.S * 1.15, 36);
    const vsSpot = spots.map((S) => {
      const moved = withPatches(s, { S });
      if (s.quoteGrid && !s._pin) moved.quoteGrid = s.quoteGrid;
      if (s._pin) moved._pin = s._pin;
      const gl = greeksOf(moved, legs);
      return { S, sum: gl.sum, legs: gl.perLeg };
    });
    const F = forward(s);
    const ks = linspace(-0.25, 0.15, 40);
    const vsStrike = ks.map((k) => {
      const K = F * Math.exp(k);
      const call = bsm(s, K, 'call');
      const put = bsm(s, K, 'put');
      return { k, K, call, put, deltaCall: signedDelta(s, K, 'call'), deltaPut: signedDelta(s, K, 'put') };
    });
    return { now: g, vsSpot, vsStrike, legs };
  }

  const GREEK_TERMS = [
    ['delta', 'spot', 'Δ · dS'],
    ['gamma', 'spot²', '½ Γ · dS²'],
    ['speed', 'spot³', '⅙ speed · dS³'],
    ['vega', 'vol', 'vega · dσ'],
    ['vomma', 'vol²', '½ vomma · dσ²'],
    ['vanna', 'spot × vol', 'vanna · dS · dσ'],
    ['theta', 'time', '−θ · dT'],
    ['charm', 'spot × time', '−charm · dS · dT'],
    ['color', 'spot² × time', '−½ color · dS² · dT'],
    ['rho', 'rate', 'ρ · dr']
  ];

  function greekMove(fromState, toState) {
    const from = materialize(fromState);
    const to = materialize(toState);
    const wings = resolveWings(from);
    if (!wings.ordered) return { ok: false, reason: 'Starting wings are not ordered.' };
    const legs = unitLegs(from, wings);
    const toWings = resolveWings(to);
    const toLegs = toWings.ordered ? unitLegs(to, toWings) : [];
    const dS = to.S - from.S;
    const dT = to.T - from.T;
    const dr = to.r - from.r;
    const dq = to.q - from.q;
    const names = GREEK_TERMS.map((t) => t[0]);
    const pack = {};
    for (const n of names) pack[n] = 0;
    const legRows = [];
    let pinPx = 0;
    let samePx = 0;
    for (const leg of legs) {
      const iv0 = ivAt(from, leg.K).iv;
      const iv1 = ivAt(to, leg.K).iv;
      const dIV = iv1 - iv0;
      const g = bsm(from, leg.K, leg.type, iv0);
      const px0 = leg.qty * g.price;
      const px1 = leg.qty * bsm(to, leg.K, leg.type, iv1).price;
      pinPx += px0;
      samePx += px1;
      const q = leg.qty;
      const terms = {
        delta: q * g.delta * dS,
        gamma: q * 0.5 * g.gamma * dS * dS,
        speed: q * (1 / 6) * g.speed * dS * dS * dS,
        vega: q * g.vega * dIV,
        vomma: q * 0.5 * g.vomma * dIV * dIV,
        vanna: q * g.vanna * dS * dIV,
        theta: q * (-g.theta) * dT,
        charm: q * (-g.charm) * dS * dT,
        color: q * (-0.5 * g.color) * dS * dS * dT,
        rho: q * g.rho * dr
      };
      let explained = 0;
      for (const n of names) {
        explained += terms[n];
        pack[n] += terms[n];
      }
      legRows.push({
        type: leg.type, K: leg.K, qty: leg.qty, iv0, iv1, dIV,
        price0: px0, price1: px1, actual: px1 - px0, explained, terms
      });
    }
    let explained = 0;
    for (const n of names) explained += pack[n];
    const actualSameStrikes = samePx - pinPx;
    let livePackage = NaN;
    let structure = 0;
    if (toLegs.length) {
      livePackage = 0;
      for (const leg of toLegs) {
        const iv = ivAt(to, leg.K).iv;
        livePackage += leg.qty * bsm(to, leg.K, leg.type, iv).price;
      }
      structure = livePackage - samePx;
    }
    return {
      ok: true,
      dS, dT, dr, dq,
      terms: GREEK_TERMS.map((row) => ({ key: row[0], combo: row[1], formula: row[2], value: pack[row[0]] })),
      legs: legRows,
      explained,
      actualSameStrikes,
      residual: actualSameStrikes - explained,
      pinPackage: pinPx,
      sameStrikePackage: samePx,
      livePackage,
      structure,
      note: 'Taylor expansion at the pinned smile. Strikes and quantities stay at the pin. Theta is calendar decay, so a longer maturity is −θ·dT. Vanna, charm, and color are the cross terms. Residual is what this order does not explain. The new-strike gap is the package after the wings move, and it is not a Greek.'
    };
  }

  const GREEK_DIALS = [
    { key: 'delta', label: 'Delta', min: -0.2, max: 0.2, step: 0.005, scale: 0.02, get: (g) => g.sum.delta },
    { key: 'gamma', label: 'Gamma × 10⁴', min: -8, max: 8, step: 0.05, scale: 1, get: (g) => g.sum.gamma * 1e4 },
    { key: 'vega', label: 'Vega / vol pt', min: -8, max: 8, step: 0.05, scale: 0.4, get: (g) => g.sum.vega / 100 },
    { key: 'vanna', label: 'Vanna', min: -3, max: 3, step: 0.02, scale: 0.25, get: (g) => g.sum.vanna },
    { key: 'volga', label: 'Volga', min: -2, max: 2, step: 0.02, scale: 0.2, get: (g) => g.sum.vomma / 10000 },
    { key: 'theta', label: 'Theta / day', min: -1.5, max: 1.5, step: 0.01, scale: 0.08, get: (g) => g.sum.theta / 365 },
    { key: 'rho', label: 'Rho', min: -200, max: 200, step: 1, scale: 25, get: (g) => g.sum.rho },
    { key: 'charm', label: 'Charm', min: -0.5, max: 0.5, step: 0.005, scale: 0.05, get: (g) => g.sum.charm },
    { key: 'color', label: 'Color × 10³', min: -8, max: 8, step: 0.05, scale: 0.6, get: (g) => g.sum.color * 1e3 },
    { key: 'speed', label: 'Speed × 10⁶', min: -4, max: 4, step: 0.05, scale: 0.4, get: (g) => g.sum.speed * 1e6 }
  ];
  const DIAL_DRIVERS = [
    ['dS', 0.002, 0.12],
    ['dAtm', 0.001, 0.06],
    ['dPut', 0.02, 0.4],
    ['dCall', 0.02, 0.4],
    ['dCurv', 0.08, 1.6],
    ['dDays', 0.5, 30],
    ['dr', 0.0001, 0.01],
    ['dWing', 0.02, 0.3]
  ];

  function zeroGreekDials() {
    const o = {};
    for (const d of GREEK_DIALS) o[d.key] = 0;
    return o;
  }
  function dialVector(m) {
    const w = resolveWings(m);
    if (!w.ordered) return null;
    const g = greeksOf(m, unitLegs(m, w));
    const v = {};
    for (const d of GREEK_DIALS) v[d.key] = d.get(g);
    return v;
  }
  function solveSquare(A, b) {
    const n = b.length;
    const M = A.map((row, i) => row.concat(b[i]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-14) return null;
      const hold = M[c];
      M[c] = M[piv];
      M[piv] = hold;
      const div = M[c][c];
      for (let k = c; k <= n; k++) M[c][k] /= div;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row) => row[n]);
  }
  function dialStep(base, residual, activeIdx) {
    const nX = DIAL_DRIVERS.length;
    const nR = activeIdx.length;
    const origin = dialVector(base);
    const J = activeIdx.map(() => new Array(nX).fill(0));
    for (let k = 0; k < nX; k++) {
      const h = DIAL_DRIVERS[k][1];
      const bump = zeroShocks();
      bump[DIAL_DRIVERS[k][0]] = h;
      const moved = dialVector(applyShockValues(base, bump));
      for (let r = 0; r < nR; r++) {
        const key = GREEK_DIALS[activeIdx[r]].key;
        J[r][k] = moved && origin ? (moved[key] - origin[key]) / h : 0;
      }
    }
    if (nR === 1) {
      let best = -1;
      let bestAbs = 0;
      for (let k = 0; k < nX; k++) {
        if (Math.abs(J[0][k]) > bestAbs) { bestAbs = Math.abs(J[0][k]); best = k; }
      }
      const x = new Array(nX).fill(0);
      if (best >= 0 && bestAbs > 1e-12) x[best] = residual[GREEK_DIALS[activeIdx[0]].key] / J[0][best];
      return x;
    }
    const AtA = Array.from({ length: nX }, () => new Array(nX).fill(0));
    const Atb = new Array(nX).fill(0);
    for (let r = 0; r < nR; r++) {
      const w = 1 / (GREEK_DIALS[activeIdx[r]].scale * GREEK_DIALS[activeIdx[r]].scale);
      const rhs = residual[GREEK_DIALS[activeIdx[r]].key];
      for (let a = 0; a < nX; a++) {
        Atb[a] += w * J[r][a] * rhs;
        for (let b = 0; b < nX; b++) AtA[a][b] += w * J[r][a] * J[r][b];
      }
    }
    for (let a = 0; a < nX; a++) AtA[a][a] += 1e-6 * (Math.abs(AtA[a][a]) + 1);
    return solveSquare(AtA, Atb);
  }
  function solveGreekDials(state, rawTargets) {
    const targets = zeroGreekDials();
    for (const d of GREEK_DIALS) {
      const v = rawTargets && rawTargets[d.key];
      if (isNum(v)) targets[d.key] = v;
    }
    const active = GREEK_DIALS.some((d) => Math.abs(targets[d.key]) > 1e-12);
    const base = materialize(state);
    if (!active) return { ok: true, active: false, state: state, targets: targets };
    const v0 = dialVector(base);
    if (!v0) return { ok: false, active: true, state: state, reason: 'Wings are not ordered.' };
    const extra = zeroShocks();
    let cursor = base;
    let v = v0;
    const activeIdx = [];
    for (let i = 0; i < GREEK_DIALS.length; i++) if (Math.abs(targets[GREEK_DIALS[i].key]) > 1e-12) activeIdx.push(i);
    for (let pass = 0; pass < 2; pass++) {
      const residual = {};
      for (const d of GREEK_DIALS) residual[d.key] = targets[d.key] - (v[d.key] - v0[d.key]);
      const step = dialStep(cursor, residual, activeIdx);
      if (!step) break;
      for (let k = 0; k < DIAL_DRIVERS.length; k++) {
        const name = DIAL_DRIVERS[k][0];
        const cap = DIAL_DRIVERS[k][2];
        extra[name] = clamp((extra[name] || 0) + 0.85 * step[k], -cap, cap);
      }
      cursor = applyShockValues(base, extra);
      v = dialVector(cursor) || v;
    }
    const out = clone(state);
    out.S = cursor.S;
    out.atm = cursor.atm;
    out.putSkew = cursor.putSkew;
    out.callSkew = cursor.callSkew;
    out.curvature = cursor.curvature;
    out.asymmetry = cursor.asymmetry;
    out.wingSteepness = cursor.wingSteepness;
    out.days = cursor.days;
    out.r = cursor.r;
    out.q = cursor.q;
    out.shocks = zeroShocks();
    out.quoteGrid = cursor.quoteGrid;
    delete out._pin;
    ensureT(out);
    const achieved = {};
    for (const d of GREEK_DIALS) achieved[d.key] = v[d.key] - v0[d.key];
    const drivers = [];
    if (Math.abs(extra.dS) > 1e-6) drivers.push('spot ' + (extra.dS * 100).toFixed(2) + '%');
    if (Math.abs(extra.dAtm) > 1e-6) drivers.push('ATM ' + (extra.dAtm * 100).toFixed(2) + ' vol pts');
    if (Math.abs(extra.dPut) > 1e-6) drivers.push('put skew ' + units.ptsFromPut(extra.dPut).toFixed(2) + ' pts');
    if (Math.abs(extra.dCall) > 1e-6) drivers.push('call skew ' + units.ptsFromPut(extra.dCall).toFixed(2) + ' pts');
    if (Math.abs(extra.dCurv) > 1e-6) drivers.push('curvature ' + units.ptsFromCurv(extra.dCurv).toFixed(2) + ' pts');
    if (Math.abs(extra.dDays) > 1e-4) drivers.push('time ' + extra.dDays.toFixed(2) + ' d');
    if (Math.abs(extra.dr) > 1e-7) drivers.push('rate ' + (extra.dr * 10000).toFixed(1) + ' bp');
    if (Math.abs(extra.dWing) > 1e-6) drivers.push('wing ' + units.ptsFromWing(extra.dWing).toFixed(2) + ' pts');
    return {
      ok: true,
      active: true,
      state: out,
      targets: targets,
      achieved: achieved,
      level0: v0,
      level1: v,
      drivers: drivers,
      note: 'Dials request a change in each package Greek. One dial is that Greek on its own. Several dials are the closest combination of spot, ATM, skew, curvature, wing, time, and rate. A gap means the smile cannot hit every request at once.'
    };
  }

  function heatmap(state, xKey, yKey, metric, n) {
    const s0 = materialize(state, zeroShocks());
    s0.quoteGrid = null;
    delete s0._pin;
    const N = clamp(n || 11, 5, 21);
    const axes = {
      S: { label: 'Spot', values: linspace(s0.S * 0.9, s0.S * 1.1, N), apply: (s, v) => { s.S = v; } },
      atm: { label: 'ATM IV', values: linspace(Math.max(0.06, s0.atm - 0.08), s0.atm + 0.1, N), apply: (s, v) => { s.atm = v; } },
      putSkew: { label: 'Put skew', values: linspace(s0.putSkew - 0.35, s0.putSkew + 0.35, N), apply: (s, v) => { s.putSkew = v; } },
      curvature: { label: 'Curvature', values: linspace(s0.curvature - 1.5, s0.curvature + 1.5, N), apply: (s, v) => { s.curvature = v; } },
      width: { label: 'Log wing', values: linspace(0.015, 0.12, N), apply: (s, v) => { s.wingMode = 'log'; s.wingLog = v; } },
      days: { label: 'DTE', values: linspace(10, 180, N), apply: (s, v) => { s.days = v; ensureT(s); } },
      centerDelta: { label: 'Center |Δ|', values: linspace(0.15, 0.5, N), apply: (s, v) => { s.centerMode = 'delta'; s.centerDelta = v; } }
    };
    const X = axes[xKey] || axes.S;
    const Y = axes[yKey] || axes.atm;
    const z = Y.values.map((yv) => X.values.map((xv) => {
      const s = clone(s0);
      delete s._pin;
      s.quoteGrid = null;
      X.apply(s, xv);
      Y.apply(s, yv);
      ensureT(s);
      return metricOn(s, metric || 'ivFly');
    }));
    const hist = metric === 'histZ' ? null : null;
    void hist;
    return {
      x: X.values, y: Y.values, z, xLabel: X.label, yLabel: Y.label, metric: metric || 'ivFly',
      note: 'Heatmap suspends the quote grid and uses the parametric smile so each axis is identifiable. Reference strikes follow the live wing mode unless the axis itself sets width or delta.'
    };
  }

  function historyChart(state, history) {
    const h = history || getHistory();
    const work = materialize(state);
    const w = resolveWings(work);
    const y = h.days.map((d) => flyOnDay(d, w.kL, w.kC, w.kU));
    const med = median(y);
    const scale = 1.4826 * mad(y, med);
    const roll = y.map((_, i) => median(y.slice(Math.max(0, i - 62), i + 1)));
    const outcomes = h.days.map((d, i) => {
      if (i + 5 >= h.days.length) return NaN;
      return h.days[i + 5].S / d.S - 1;
    });
    return {
      dates: h.days.map((d) => d.date),
      fly: y,
      median: med,
      roll,
      z: y.map((v) => (scale > 0 ? (v - med) / scale : NaN)),
      bandLo: roll.map((m) => m - scale),
      bandHi: roll.map((m) => m + scale),
      outcome5d: outcomes,
      note: 'Subsequent 5-session spot returns are outcomes. They are not used to score cheap or expensive.'
    };
  }

  function presets(history) {
    const list = [
      { id: 'A', name: 'A. Spot-only −5%', shocks: Object.assign(zeroShocks(), { dS: -0.05 }) },
      { id: 'B', name: 'B. Parallel IV +3 vol pts', shocks: Object.assign(zeroShocks(), { dAtm: 0.03 }) },
      { id: 'C', name: 'C. Put-skew only', shocks: Object.assign(zeroShocks(), { dPut: units.putFromPts(2) }) },
      { id: 'D', name: 'D. Curvature only', shocks: Object.assign(zeroShocks(), { dCurv: units.curvFromPts(1) }) },
      { id: 'E', name: 'E. Wing-steepness only', shocks: Object.assign(zeroShocks(), { dWing: units.wingFromPts(0.8) }) },
      { id: 'F', name: 'F. Time decay −7 days', shocks: Object.assign(zeroShocks(), { dDays: -7 }) },
      { id: 'G', name: 'G. Spot −5% and IV +3 pts', shocks: Object.assign(zeroShocks(), { dS: -0.05, dAtm: 0.03 }) },
      { id: 'H', name: 'H. Spot −5% and put skew', shocks: Object.assign(zeroShocks(), { dS: -0.05, dPut: units.putFromPts(2) }) },
      { id: 'I', name: 'I. IV +2 pts and curvature', shocks: Object.assign(zeroShocks(), { dAtm: 0.02, dCurv: units.curvFromPts(1) }) },
      { id: 'J', name: 'J. Spot, IV, and skew', shocks: Object.assign(zeroShocks(), { dS: -0.03, dAtm: 0.02, dPut: units.putFromPts(1.5) }) }
    ];
    const h = history || getHistory();
    let worst = h.days[1];
    for (const d of h.days) if (d.ret < worst.ret) worst = d;
    const idx = h.days.indexOf(worst);
    const prev = h.days[Math.max(0, idx - 1)];
    list.push({
      id: 'K',
      name: 'K. Historical stress ' + worst.date,
      shocks: Object.assign(zeroShocks(), {
        dS: worst.ret,
        dAtm: worst.shape.atm - prev.shape.atm,
        dPut: worst.shape.putSkew - prev.shape.putSkew
      }),
      note: 'Shock sizes are that session’s realized move, applied to today’s baseline. Dependencies are historical, not a model of causality.'
    });
    list.push({ id: 'L', name: 'L. Custom (current shocks)', shocks: null });
    return list;
  }

  function fmt(x, d) {
    if (!isNum(x)) return '—';
    if (Math.abs(x) >= 1e5 || (Math.abs(x) > 0 && Math.abs(x) < 1e-4)) return x.toExponential(2);
    return x.toFixed(d == null ? 4 : d);
  }

  function chainCSV(history, dayIndex) {
    const h = history || getHistory();
    const day = h.days[dayIndex == null ? h.days.length - 1 : dayIndex];
    const header = ['source', 'date', 'spot', 'forward', 'expiry_dte', 'time_years', 'strike', 'type', 'bid', 'ask', 'mid', 'iv', 'delta', 'oi', 'volume', 'rate', 'div_yield', 'stale'];
    const lines = [header.join(',')];
    const s = stateFromDay(day);
    const F = forward(s);
    for (let i = 0; i < day.ks.length; i += 2) {
      const k = day.ks[i];
      const iv = day.iv[i];
      if (!isNum(iv)) continue;
      const K = F * Math.exp(k);
      for (const type of ['call', 'put']) {
        const g = bsm(s, K, type, iv);
        const rel = s.spreadFrac + s.spreadWing * k * k;
        const half = Math.max(0.02, Math.abs(g.price) * rel) + (s.slippagePts || 0);
        const bid = Math.max(0, g.price - half);
        const ask = g.price + half;
        const oi = Math.round(800 * Math.exp(-0.5 * (k / 0.12) * (k / 0.12)));
        const dlt = s.deltaConv === 'forward' ? g.delta * Math.exp(s.q * s.T) : g.delta;
        lines.push([
          'SYNTHETIC', day.date, round(day.S, 2), round(F, 2), 60, day.T.toFixed(6), round(K, 2), type,
          bid.toFixed(4), ask.toFixed(4), g.price.toFixed(4), iv.toFixed(6),
          dlt.toFixed(4), oi, Math.round(oi * 0.08), day.r, day.q, day.stale[i] ? 1 : 0
        ].join(','));
      }
    }
    return lines.join('\n');
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter((ln) => ln.trim() && !ln.trim().startsWith('#'));
    if (!lines.length) return { ok: false, error: 'Empty file.' };
    const header = lines[0].split(',').map((x) => x.trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i].split(',');
      const get = (name) => {
        const j = idx(name);
        return j >= 0 ? cells[j] : '';
      };
      const strike = parseFloat(get('strike'));
      if (!(strike > 0)) continue;
      rows.push({
        source: get('source') || 'imported',
        date: get('date') || '',
        spot: parseFloat(get('spot')),
        forward: parseFloat(get('forward')),
        dte: parseFloat(get('expiry_dte') || get('dte')),
        T: parseFloat(get('time_years')),
        strike,
        type: (get('type') || 'call').toLowerCase(),
        bid: parseFloat(get('bid')),
        ask: parseFloat(get('ask')),
        mid: parseFloat(get('mid')),
        iv: parseFloat(get('iv')),
        delta: parseFloat(get('delta')),
        oi: parseFloat(get('oi')),
        volume: parseFloat(get('volume')),
        rate: parseFloat(get('rate')),
        q: parseFloat(get('div_yield') || get('q')),
        stale: get('stale') === '1' || get('stale') === 'true'
      });
    }
    if (!rows.length) return { ok: false, error: 'No strike rows. Required column: strike, plus iv or mid.' };
    const dates = Array.from(new Set(rows.map((r) => r.date).filter(Boolean))).sort();
    return { ok: true, rows, dates, header };
  }

  function applyImport(state, parsed) {
    if (!parsed.ok) return { ok: false, error: parsed.error, state };
    const dates = parsed.dates;
    if (dates.length > 1) {
      const span = (parseISO(dates[dates.length - 1]) - parseISO(dates[0])) / 86400000;
      if (span > 380) {
        return { ok: false, error: 'Import spans more than one year (' + Math.round(span) + ' calendar days). The valuation sample cannot be extended.', state };
      }
    }
    const date = dates[dates.length - 1] || state.asOf;
    const slice = parsed.rows.filter((r) => !r.date || r.date === date);
    const dtes = slice.map((r) => r.dte).filter(isNum);
    const near = dtes.length ? dtes.some((d) => d >= 50 && d <= 70) : true;
    if (dtes.length && !near && dates.length > 1) {
      return { ok: false, error: 'Historical import has no 50–70 DTE slice to treat as 60-DTE. Refusing to mix maturities.', state };
    }
    const spot = slice.find((r) => isNum(r.spot));
    const next = clone(state);
    next.source = 'imported';
    next.linkedToFinal = false;
    next.asOf = date || next.asOf;
    if (spot) next.S = spot.spot;
    const rate = slice.find((r) => isNum(r.rate));
    const div = slice.find((r) => isNum(r.q));
    if (rate) next.r = rate.rate;
    if (div) next.q = div.q;
    const dte = slice.find((r) => isNum(r.dte));
    if (dte) next.days = dte.dte;
    ensureT(next);
    const F = isNum(slice[0] && slice[0].forward) ? slice.find((r) => isNum(r.forward)).forward : forward(next);
    const grid = [];
    for (const row of slice) {
      if (row.type && row.type !== 'call' && row.type !== 'otm') continue;
      let iv = row.iv;
      if (!isNum(iv) && isNum(row.mid)) {
        const solved = impliedVol(row.mid, next.S, row.strike, next.T, next.r, next.q, row.type === 'put' ? 'put' : 'call');
        iv = solved.iv;
      }
      if (!isNum(iv)) continue;
      grid.push({ k: Math.log(row.strike / F), iv, stale: !!row.stale, strike: row.strike });
    }
    grid.sort((a, b) => a.k - b.k);
    if (grid.length < 5) return { ok: false, error: 'Need at least 5 priced strikes to replace the smile.', state };
    next.quoteGrid = grid;
    next.quoteGrid.T = next.T;
    next.importLabel = 'IMPORTED quotes — not mixed into the synthetic history. Historical scores stay on the synthetic one-year sample until a full history replaces it.';
    if (dates.length > 1) {
      next.importLabel = 'IMPORTED chain has ' + dates.length + ' dates. Only the last date replaced the live smile. The one-year synthetic 60-DTE study is unchanged and is not mixed with these rows.';
    }
    return { ok: true, state: next, strikes: grid.length };
  }

  function quickCheck() {
    const issues = [];
    const s = defaultState();
    s.linkedToFinal = false;
    s.quoteGrid = null;
    s.atm = 0.2; s.putSkew = 0; s.callSkew = 0; s.curvature = 0; s.asymmetry = 0; s.wingSteepness = 0; s.bump = 0;
    s.S = 100; s.centerK = 100; s.r = 0; s.q = 0; s.days = 60; s.wingMode = 'log'; s.wingLog = 0.05;
    ensureT(s);
    const call = bsm(s, 100, 'call', 0.2);
    const put = bsm(s, 100, 'put', 0.2);
    const parity = call.price - put.price - (s.S * Math.exp(-s.q * s.T) - 100 * Math.exp(-s.r * s.T));
    if (Math.abs(parity) > 1e-8) issues.push('put-call parity');
    const inv = impliedVol(call.price, s.S, 100, s.T, s.r, s.q, 'call');
    if (Math.abs(inv.iv - 0.2) > 1e-4) issues.push('iv inversion');
    if (Math.abs(ivFlyOf(resolveWings(s))) > 1e-10) issues.push('flat fly');
    const h = getHistory();
    if (h.days.length !== 252) issues.push('sample length');
    if (h.warmup.length !== 40) issues.push('warmup');
    return { ok: issues.length === 0, issues, version: VERSION };
  }

  function view(state, history) {
    const h = history || getHistory();
    const work = materialize(state);
    const base = materialize(state, zeroShocks());
    const wings = resolveWings(work);
    const baseWings = resolveWings(base);
    const pf = priceFly(work, wings);
    const legs = unitLegs(work, wings);
    const g = wings.ordered ? greeksOf(work, legs) : null;
    const pos = wings.ordered ? payoffSeries(state) : null;
    const quotes = {
      raw: ivFlyOf(wings),
      atm: quoteFly(work, work.wingDelta || 0.25).fly,
      d25: quoteFly(work, 0.25).fly,
      d10: quoteFly(work, 0.10).fly,
      dn: quoteFly(Object.assign(clone(work), { deltaConv: 'forward' }), work.quoteDelta || 0.25).fly
    };
    const scores = assess(state, h);
    const decomp = wings.ordered ? decompose(state, h) : null;
    const attr = attributeScenario(state, 'ivFly');
    const arb = arbitrageReport(state);
    return {
      version: VERSION,
      work, base, wings, baseWings, priceFly: pf, quotes, legs, greeks: g, position: pos,
      scores, decomp, attribution: attr, arbitrage: arb,
      forward: forward(work),
      baselineForward: forward(base),
      label: state.source === 'imported' ? (state.importLabel || 'IMPORTED') : h.label,
      syntheticHistory: !(state.historyOverride && state.historyOverride.synthetic === false)
    };
  }

  const api = {
    VERSION, SAMPLE_END, VALUATION_DAYS, WARMUP_DAYS, SEED,
    units, zeroShocks, defaultState, clone, linspace, median, mad, mean,
    yearFrac, forward, ensureT, shapeIV, materialize, ivAt, bsm, impliedVol,
    strikeForDelta, signedDelta, deltaAbs, resolveWings, ivFlyOf, priceFly, priceOf,
    unitLegs, packagePoints, payoff, payoffLimits, breakevens, extrema, greeksOf,
    fitSVI, fitSSVI, varianceInterp, getHistory, resetHistory, linkToFinal, stateFromDay,
    assess, decompose, attributeScenario, arbitrageReport, metricOn,
    smileSeries, deltaSmile, flySweepStrike, flySweepDelta, flySweepWidth, priceFlySweep,
    payoffSeries, greekSeries, greekMove, GREEK_DIALS, zeroGreekDials, solveGreekDials,
    heatmap, historyChart, presets, chainCSV, parseCSV, applyImport,
    quickCheck, view, fmt, businessDaysEnding, isBiz, kGrid
  };
  global.FLY = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
