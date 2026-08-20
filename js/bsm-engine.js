/**
 * Shared Black-Scholes-Merton engine — single source of truth.
 * European options with continuous dividend yield.
 * Vega = ∂V/∂σ (per unit vol). Theta/Charm/Color use calendar ∂/∂t = −∂/∂T.
 */
(function (global) {
  const CONFIG = {
    EPS_T: 1e-6,
    EPS_SIGMA: 1e-8,
    FLAT_REL: 1e-4,
    FLAT_ABS: 1e-6,
    FD_TOL_ABS: 1e-3,
    FD_TOL_REL: 0.05,
    DEFAULT: { S: 100, K: 100, sigma: 0.20, T: 30 / 365, r: 0.05, q: 0, type: 'call' },
    THRESHOLDS: { deepDeep: 0.20, deep: 0.10, atm: 0.02 },
    GREEKS: ['price', 'delta', 'gamma', 'vega', 'theta', 'rho', 'lambda', 'charm', 'vanna', 'vomma', 'speed', 'color', 'ultima'],
    PRIMARY: ['delta', 'gamma', 'vega', 'theta', 'rho'],
    INPUTS: ['S', 'K', 'sigma', 'T', 'r', 'q'],
    REGIMES: [
      { id: 'deep_deep_itm', label: 'Deep Deep ITM', short: 'DD ITM' },
      { id: 'deep_itm', label: 'Deep ITM', short: 'D ITM' },
      { id: 'itm', label: 'ITM', short: 'ITM' },
      { id: 'atm', label: 'ATM', short: 'ATM' },
      { id: 'otm', label: 'OTM', short: 'OTM' },
      { id: 'deep_otm', label: 'Deep OTM', short: 'D OTM' },
      { id: 'deep_deep_otm', label: 'Deep Deep OTM', short: 'DD OTM' }
    ],
    REGIME_LF: {
      deep_deep_itm: 0.28, deep_itm: 0.15, itm: 0.05, atm: 0,
      otm: -0.05, deep_otm: -0.15, deep_deep_otm: -0.28
    }
  };

  const TOOLTIPS = {
    price: { def: 'European BSM option value', formula: 'C = S e^{-qT} N(d1) − K e^{-rT} N(d2)', units: 'currency', interp: 'Theoretical fair value under BSM assumptions.' },
    delta: { def: '∂V/∂S', formula: 'Δ_call = e^{-qT} N(d1); Δ_put = e^{-qT}(N(d1)−1)', units: 'per $1 spot', interp: 'Expected change in option price for a $1 spot move.' },
    gamma: { def: '∂²V/∂S² = ∂Δ/∂S', formula: 'Γ = e^{-qT} φ(d1) / (S σ √T)', units: 'Δ per $1 spot', interp: 'Long calls/puts have positive Gamma under BSM.' },
    vega: { def: '∂V/∂σ', formula: 'Vega = S e^{-qT} φ(d1) √T', units: 'per unit σ (or /100 per vol point)', interp: 'Sensitivity to assumed volatility.' },
    theta: { def: 'Calendar time decay ∂V/∂t = −∂V/∂T', formula: 'See BSM theta formulas', units: 'per year or per day', interp: 'Usually negative for long options; exceptions near deep ITM puts exist.' },
    rho: { def: '∂V/∂r', formula: 'ρ_call = K T e^{-rT} N(d2); ρ_put = −K T e^{-rT} N(−d2)', units: 'per unit rate', interp: 'Rate sensitivity.' },
    lambda: { def: 'Elasticity Δ·S/V', formula: 'Λ = Δ × S / V', units: 'dimensionless', interp: 'Percentage option change per percentage spot change (signed).' },
    charm: { def: '∂Δ/∂t (calendar)', formula: 'Charm = −∂Δ/∂T', units: 'Δ per year', interp: 'How delta changes as time passes.' },
    vanna: { def: '∂Δ/∂σ = ∂Vega/∂S', formula: 'Vanna = −e^{-qT} φ(d1) d2 / σ', units: 'Δ per unit σ', interp: 'Spot–vol cross sensitivity; sign can flip across moneyness.' },
    vomma: { def: '∂Vega/∂σ (Volga)', formula: 'Vomma = Vega · d1 · d2 / σ', units: 'Vega per unit σ', interp: 'Convexity of value w.r.t. volatility.' },
    speed: { def: '∂Γ/∂S', formula: 'Speed = −Γ/S · (1 + d1/(σ√T))', units: 'Γ per $1', interp: 'Not globally signed — can change around ATM.' },
    color: { def: '∂Γ/∂t (calendar)', formula: 'Color = −∂Γ/∂T', units: 'Γ per year', interp: 'How gamma evolves with time.' },
    ultima: { def: '∂Vomma/∂σ', formula: 'Ultima = −(Vega/σ²)[d1 d2(1−d1 d2)+d1²+d2²]', units: 'per unit σ³', interp: 'Third-order vol sensitivity.' },
    forward: { def: 'Forward price', formula: 'F = S e^{(r−q)T}', units: 'currency', interp: 'Risk-neutral forward.' },
    d1: { def: 'BSM d1', formula: 'd1 = [ln(S/K)+(r−q+σ²/2)T]/(σ√T)', units: '', interp: 'Standardized moneyness adjusted for carry and vol.' },
    d2: { def: 'BSM d2', formula: 'd2 = d1 − σ√T', units: '', interp: 'Risk-neutral exercise probability argument.' },
    intrinsic: { def: 'Intrinsic value', formula: 'max(S−K,0) call / max(K−S,0) put', units: 'currency', interp: 'Immediate exercise value.' },
    timeValue: { def: 'Time value', formula: 'V − intrinsic', units: 'currency', interp: 'Premium above intrinsic.' },
    moneyness: { def: 'Forward log-moneyness', formula: 'ln(F/K)', units: '', interp: 'Primary classification metric.' }
  };

  const REGIME_EXPLAIN = {
    call: {
      deep_deep_itm: 'Typical BSM behavior: Delta → ~e^{−qT}≈1, Gamma generally low, Vega lower than ATM, price dominated by discounted intrinsic.',
      deep_itm: 'Typical: high Delta, moderate-low Gamma/Vega vs ATM.',
      itm: 'Typical: Delta elevated, meaningful Gamma/Vega remaining.',
      atm: 'Typical: Gamma & Vega near peaks; Delta near e^{−qT}/2 (≈0.5 if q=0).',
      otm: 'Typical: Delta & price lower; Gamma/Vega still material.',
      deep_otm: 'Typical: low Delta, Gamma/Vega declining.',
      deep_deep_otm: 'Typical: Delta→0, Gamma/Vega small, price mostly time value near zero.'
    },
    put: {
      deep_deep_itm: 'Typical BSM behavior: Delta → ~−e^{−qT}≈−1, Gamma generally low, Vega lower than ATM.',
      deep_itm: 'Typical: Delta near −1, Gamma/Vega reduced vs ATM.',
      itm: 'Typical: Delta negative and sizable; Gamma/Vega meaningful.',
      atm: 'Typical: Gamma & Vega near peaks; Delta near −e^{−qT}/2.',
      otm: 'Typical: Delta closer to 0; premium smaller.',
      deep_otm: 'Typical: Delta→0 from below; low Gamma/Vega.',
      deep_deep_otm: 'Typical: nearly worthless; Greeks near 0.'
    }
  };

  const REGIME_COLORS = {
    deep_deep_itm: '#16a34a',
    deep_itm: '#22c55e',
    itm: '#86efac',
    atm: '#f59e0b',
    otm: '#7dd3fc',
    deep_otm: '#3b82f6',
    deep_deep_otm: '#6366f1',
    overall: '#e6edf7'
  };

  const SQRT2PI = Math.sqrt(2 * Math.PI);
  const INV_SQRT2 = 1 / Math.sqrt(2);

  function normPDF(x) {
    return Math.exp(-0.5 * x * x) / SQRT2PI;
  }

  function erfc(x) {
    const z = Math.abs(x);
    const t = 1 / (1 + 0.5 * z);
    const tau = t * Math.exp(-z * z - 1.26551223 +
      t * (1.00002368 +
      t * (0.37409196 +
      t * (0.09678418 +
      t * (-0.18628806 +
      t * (0.27886807 +
      t * (-1.13520398 +
      t * (1.48851587 +
      t * (-0.82215223 +
      t * 0.17087277)))))))));
    return x >= 0 ? tau : 2 - tau;
  }

  function normCDF(x) {
    if (!Number.isFinite(x)) return x > 0 ? 1 : 0;
    return 0.5 * erfc(-x * INV_SQRT2);
  }

  function clampPositive(x, eps) {
    return Math.max(x, eps);
  }

  function isBad(x) {
    return !Number.isFinite(x);
  }

  function safeDiv(a, b) {
    if (Math.abs(b) < 1e-15) return NaN;
    return a / b;
  }

  function fmt(x, d) {
    if (d == null) d = 4;
    if (!Number.isFinite(x)) return '—';
    if (Math.abs(x) >= 1e6 || (Math.abs(x) > 0 && Math.abs(x) < 1e-4)) return x.toExponential(3);
    return x.toFixed(d);
  }

  function fmtPct(x) {
    if (!Number.isFinite(x)) return '—';
    return (100 * x).toFixed(2) + '%';
  }

  function linspace(a, b, n) {
    const arr = [];
    if (n < 2) return [a];
    for (let i = 0; i < n; i++) arr.push(a + (b - a) * i / (n - 1));
    return arr;
  }

  function validateParams(p) {
    const issues = [];
    if (!(p.S > 0)) issues.push('S must be > 0');
    if (!(p.K > 0)) issues.push('K must be > 0');
    if (!(p.sigma > 0)) issues.push('σ must be > 0');
    if (!(p.T > 0)) issues.push('T must be > 0');
    if (!Number.isFinite(p.r)) issues.push('r invalid');
    if (!Number.isFinite(p.q)) issues.push('q invalid');
    return issues;
  }

  function sanitizeParams(p) {
    return {
      S: clampPositive(+p.S, 1e-8),
      K: clampPositive(+p.K, 1e-8),
      sigma: clampPositive(+p.sigma, CONFIG.EPS_SIGMA),
      T: clampPositive(+p.T, CONFIG.EPS_T),
      r: +p.r,
      q: +p.q,
      type: p.type === 'put' ? 'put' : 'call'
    };
  }

  function calculateBSM(raw) {
    const p = sanitizeParams(raw);
    const issues = validateParams(p);
    const out = {
      params: p,
      valid: issues.length === 0,
      issues,
      S: p.S, K: p.K, sigma: p.sigma, T: p.T, r: p.r, q: p.q, type: p.type
    };

    const { S, K, sigma, T, r, q } = p;
    const sqrtT = Math.sqrt(T);
    const sigSqrtT = sigma * sqrtT;
    const discountQ = Math.exp(-q * T);
    const discountR = Math.exp(-r * T);
    const forward = S * Math.exp((r - q) * T);
    const logSK = Math.log(S / K);
    const d1 = (logSK + (r - q + 0.5 * sigma * sigma) * T) / sigSqrtT;
    const d2 = d1 - sigSqrtT;
    const nd1 = normCDF(d1);
    const nd2 = normCDF(d2);
    const nmd1 = normCDF(-d1);
    const nmd2 = normCDF(-d2);
    const pd1 = normPDF(d1);

    const call = S * discountQ * nd1 - K * discountR * nd2;
    const put = K * discountR * nmd2 - S * discountQ * nmd1;
    const price = p.type === 'call' ? call : put;

    const deltaCall = discountQ * nd1;
    const deltaPut = discountQ * (nd1 - 1);
    const delta = p.type === 'call' ? deltaCall : deltaPut;

    const gamma = discountQ * pd1 / (S * sigSqrtT);
    const vega = S * discountQ * pd1 * sqrtT;

    const commonThetaVol = -(S * discountQ * pd1 * sigma) / (2 * sqrtT);
    const thetaCall = commonThetaVol - r * K * discountR * nd2 + q * S * discountQ * nd1;
    const thetaPut = commonThetaVol + r * K * discountR * nmd2 - q * S * discountQ * nmd1;
    const theta = p.type === 'call' ? thetaCall : thetaPut;

    const rhoCall = K * T * discountR * nd2;
    const rhoPut = -K * T * discountR * nmd2;
    const rho = p.type === 'call' ? rhoCall : rhoPut;

    const lambda = Math.abs(price) > 1e-15 ? delta * S / price : NaN;

    const charmCommon = pd1 * (2 * (r - q) * T - d2 * sigSqrtT) / (2 * T * sigSqrtT);
    const charmCall = -discountQ * (charmCommon + q * nd1);
    const charmPut = -discountQ * (charmCommon - q * nmd1);
    const charm = p.type === 'call' ? charmCall : charmPut;

    const vanna = -discountQ * pd1 * d2 / sigma;
    const vomma = vega * d1 * d2 / sigma;
    const speed = -gamma / S * (1 + d1 / sigSqrtT);
    const colorFactor = 2 * q * T + 1 + (2 * (r - q) * T - d2 * sigSqrtT) * d1 / sigSqrtT;
    const color = discountQ * pd1 / (2 * S * T * sigSqrtT) * colorFactor;
    const ultima = -(vega / (sigma * sigma)) * (d1 * d2 * (1 - d1 * d2) + d1 * d1 + d2 * d2);

    const intrinsic = p.type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    const timeValue = price - intrinsic;
    const logFwdMoneyness = Math.log(forward / K);
    const logSpotMoneyness = Math.log(S / K);
    const spotMoneyness = S / K;
    const fwdMoneyness = forward / K;

    Object.assign(out, {
      forward, d1, d2, nd1, nd2, pd1,
      call, put, price,
      delta, deltaCall, deltaPut,
      gamma, vega, theta, thetaAnnual: theta, rho,
      lambda, charm, vanna, vomma, speed, color, ultima,
      intrinsic, timeValue,
      logFwdMoneyness, logSpotMoneyness, spotMoneyness, fwdMoneyness,
      discountQ, discountR, sigSqrtT
    });

    for (const k of CONFIG.GREEKS) {
      if (isBad(out[k])) out[k] = NaN;
    }
    return out;
  }

  function getMetric(res, key, display) {
    let v = res[key];
    if (key === 'vega' || key === 'vomma' || key === 'ultima' || key === 'vanna' || key === 'rho') {
      if (display && display.unitMode === 'pct') v = v / 100;
    }
    if (key === 'theta' || key === 'charm' || key === 'color') {
      if (display && display.thetaMode === 'day') {
        const div = display.dayCount || 365;
        v = v / div;
      }
    }
    return v;
  }

  function stepSize(params, variable) {
    const p = sanitizeParams(params);
    switch (variable) {
      case 'S': return Math.max(p.S * 1e-4, 1e-6);
      case 'K': return Math.max(p.K * 1e-4, 1e-6);
      case 'sigma': return Math.max(p.sigma * 1e-4, 1e-6);
      case 'T': return Math.max(p.T * 1e-4, 1e-7);
      case 'r': return Math.max(Math.abs(p.r) * 1e-4, 1e-6);
      case 'q': return Math.max(Math.abs(p.q) * 1e-4, 1e-6);
      default: return 1e-5;
    }
  }

  function bumpParams(params, variable, h) {
    const p = { ...sanitizeParams(params) };
    p[variable] = p[variable] + h;
    if (variable === 'S' || variable === 'K' || variable === 'sigma' || variable === 'T') {
      p[variable] = clampPositive(p[variable], variable === 'T' ? CONFIG.EPS_T : (variable === 'sigma' ? CONFIG.EPS_SIGMA : 1e-8));
    }
    return p;
  }

  function greekValue(params, greek, display) {
    return getMetric(calculateBSM(params), greek, display);
  }

  function centralDiff(params, variable, outputGreek, display) {
    const h = stepSize(params, variable);
    const up = bumpParams(params, variable, h);
    const dn = bumpParams(params, variable, -h);
    const vu = greekValue(up, outputGreek, display);
    const vd = greekValue(dn, outputGreek, display);
    const actualH = (up[variable] - dn[variable]) / 2;
    if (actualH === 0) return NaN;
    return (vu - vd) / (2 * actualH);
  }

  function sensitivity(baseParams, variable, outputGreek, eps, display) {
    const base = calculateBSM(baseParams);
    const baseVal = getMetric(base, outputGreek, display);
    const h = eps != null ? eps : stepSize(baseParams, variable) * 10;
    const up = bumpParams(baseParams, variable, h);
    const valUp = getMetric(calculateBSM(up), outputGreek, display);
    return { baseVal, valUp, change: valUp - baseVal, h, paramsUp: up, base };
  }

  function classifyDirection(change, baseVal, opts) {
    opts = opts || {};
    const flatAbs = opts.flatAbs ?? CONFIG.FLAT_ABS;
    const flatRel = opts.flatRel ?? CONFIG.FLAT_REL;
    const scale = Math.max(Math.abs(baseVal), 1e-8);
    if (!Number.isFinite(change)) return { arrow: '±', cls: 'arrow-cond', label: 'conditional' };
    if (Math.abs(change) < flatAbs && Math.abs(change) / scale < flatRel) {
      return { arrow: '→', cls: 'arrow-flat', label: 'unchanged' };
    }
    if (change > 0) return { arrow: '↑', cls: 'arrow-up', label: 'increase' };
    return { arrow: '↓', cls: 'arrow-down', label: 'decrease' };
  }

  function signedLogMoneyness(res) {
    return res.type === 'put' ? -res.logFwdMoneyness : res.logFwdMoneyness;
  }

  function classifyMoneyness(res, thresholds) {
    thresholds = thresholds || CONFIG.THRESHOLDS;
    const m = signedLogMoneyness(res);
    const { deepDeep, deep, atm } = thresholds;
    let id, label;
    if (m >= deepDeep) { id = 'deep_deep_itm'; label = 'Deep Deep ITM'; }
    else if (m >= deep) { id = 'deep_itm'; label = 'Deep ITM'; }
    else if (m > atm) { id = 'itm'; label = 'ITM'; }
    else if (m >= -atm) { id = 'atm'; label = 'ATM'; }
    else if (m > -deep) { id = 'otm'; label = 'OTM'; }
    else if (m > -deepDeep) { id = 'deep_otm'; label = 'Deep OTM'; }
    else { id = 'deep_deep_otm'; label = 'Deep Deep OTM'; }
    return { id, label, signedM: m, rawLnFK: res.logFwdMoneyness };
  }

  function representativeParams(regimeId, type, base) {
    base = base || CONFIG.DEFAULT;
    const lfCall = CONFIG.REGIME_LF[regimeId];
    const lf = type === 'put' ? -lfCall : lfCall;
    const { S, sigma, T, r, q } = base;
    const F = S * Math.exp((r - q) * T);
    const K = F / Math.exp(lf);
    return { S, K, sigma, T, r, q, type: type === 'put' ? 'put' : 'call' };
  }

  function defaultAxisRange(variable, params) {
    const p = sanitizeParams(params || CONFIG.DEFAULT);
    switch (variable) {
      case 'S': return { min: p.S * 0.5, max: p.S * 1.5 };
      case 'K': return { min: p.K * 0.5, max: p.K * 1.5 };
      case 'sigma': return { min: 0.04, max: 0.80 };
      case 'T': return { min: 1 / 365, max: Math.max(2, p.T) };
      case 'r': return { min: -0.02, max: 0.15 };
      case 'q': return { min: 0, max: 0.12 };
      case 'moneyness':
      case 'logFwdMoneyness': return { min: -0.40, max: 0.40 };
      case 'spotMoneyness': return { min: 0.60, max: 1.50 };
      case 'fwdMoneyness': return { min: 0.60, max: 1.50 };
      default: return { min: 0, max: 1 };
    }
  }

  function applyXValue(base, xKey, x, moneySweep) {
    const p = { ...sanitizeParams(base) };
    moneySweep = moneySweep || 'K';
    if (xKey === 'S' || xKey === 'K') {
      p[xKey] = clampPositive(x, 1e-8);
    } else if (xKey === 'sigma') {
      p.sigma = clampPositive(x, CONFIG.EPS_SIGMA);
    } else if (xKey === 'T') {
      p.T = clampPositive(x, CONFIG.EPS_T);
    } else if (xKey === 'r' || xKey === 'q') {
      p[xKey] = x;
    } else if (xKey === 'moneyness' || xKey === 'logFwdMoneyness') {
      const F = p.S * Math.exp((p.r - p.q) * p.T);
      if (moneySweep === 'S') {
        p.S = clampPositive(p.K * Math.exp(x - (p.r - p.q) * p.T), 1e-8);
      } else {
        p.K = clampPositive(F / Math.exp(x), 1e-8);
      }
    } else if (xKey === 'spotMoneyness') {
      if (moneySweep === 'S') p.S = clampPositive(p.K * x, 1e-8);
      else p.K = clampPositive(p.S / x, 1e-8);
    } else if (xKey === 'fwdMoneyness') {
      const carry = Math.exp((p.r - p.q) * p.T);
      if (moneySweep === 'S') p.S = clampPositive(p.K * x / carry, 1e-8);
      else p.K = clampPositive(p.S * carry / x, 1e-8);
    }
    return p;
  }

  function metricFromRes(res, key, display) {
    if (key === 'moneyness' || key === 'logFwdMoneyness') return res.logFwdMoneyness;
    if (key === 'signedMoneyness') return signedLogMoneyness(res);
    if (Object.prototype.hasOwnProperty.call(res, key)) return getMetric(res, key, display);
    return NaN;
  }

  global.BSM = {
    CONFIG, TOOLTIPS, REGIME_EXPLAIN, REGIME_COLORS,
    normPDF, normCDF, clampPositive, isBad, safeDiv, fmt, fmtPct, linspace,
    validateParams, sanitizeParams, calculateBSM, getMetric,
    stepSize, bumpParams, greekValue, centralDiff, sensitivity, classifyDirection,
    signedLogMoneyness, classifyMoneyness, representativeParams,
    defaultAxisRange, applyXValue, metricFromRes
  };
})(typeof window !== 'undefined' ? window : globalThis);
