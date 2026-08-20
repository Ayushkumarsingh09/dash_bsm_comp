/**
 * BSM Graph Atlas — customizable cross-plots, regime compilation, and engine analysis.
 */
(function () {
  const {
    CONFIG, TOOLTIPS, REGIME_EXPLAIN, REGIME_COLORS,
    fmt, linspace, sanitizeParams, calculateBSM, getMetric,
    classifyMoneyness, representativeParams, defaultAxisRange,
    applyXValue, metricFromRes, classifyDirection, sensitivity,
    clampPositive, bumpParams, stepSize
  } = window.BSM;

  const INPUT_AXES = [
    { id: 'S', label: 'Spot S' },
    { id: 'K', label: 'Strike K' },
    { id: 'moneyness', label: 'Moneyness ln(F/K)' },
    { id: 'spotMoneyness', label: 'Spot moneyness S/K' },
    { id: 'fwdMoneyness', label: 'Forward moneyness F/K' },
    { id: 'sigma', label: 'Volatility σ' },
    { id: 'T', label: 'Time T' },
    { id: 'r', label: 'Rate r' },
    { id: 'q', label: 'Dividend q' }
  ];

  const DRIVER_AXES = INPUT_AXES.filter(a =>
    ['S', 'K', 'moneyness', 'sigma', 'T', 'r', 'q'].includes(a.id)
  );

  const METRICS = [
    { id: 'price', label: 'Price' },
    { id: 'delta', label: 'Delta' },
    { id: 'gamma', label: 'Gamma' },
    { id: 'vega', label: 'Vega' },
    { id: 'theta', label: 'Theta' },
    { id: 'rho', label: 'Rho' },
    { id: 'lambda', label: 'Lambda' },
    { id: 'charm', label: 'Charm' },
    { id: 'vanna', label: 'Vanna' },
    { id: 'vomma', label: 'Vomma' },
    { id: 'speed', label: 'Speed' },
    { id: 'color', label: 'Color' },
    { id: 'ultima', label: 'Ultima' },
    { id: 'intrinsic', label: 'Intrinsic' },
    { id: 'timeValue', label: 'Time value' },
    { id: 'd1', label: 'd1' },
    { id: 'd2', label: 'd2' }
  ];

  const GREEK_METRICS = METRICS.filter(m => CONFIG.GREEKS.includes(m.id));
  const PRIMARY_METRICS = ['price', 'delta', 'gamma', 'vega', 'theta', 'rho'];

  const GREEK_COLORS = {
    price: '#3d9cf0', delta: '#22c55e', gamma: '#f59e0b', vega: '#a78bfa',
    theta: '#ef4444', rho: '#2dd4bf', lambda: '#f472b6', charm: '#fb923c',
    vanna: '#38bdf8', vomma: '#c084fc', speed: '#a3e635', color: '#facc15',
    ultima: '#e879f9', intrinsic: '#94a3b8', timeValue: '#67e8f9',
    d1: '#fdba74', d2: '#86efac'
  };

  const SHAPE_HINTS = {
    'delta|S|call': 'Call delta typically rises from ~0 (deep OTM) toward e^{−qT} (deep ITM).',
    'delta|S|put': 'Put delta typically rises from ~−e^{−qT} (deep ITM) toward 0 (deep OTM).',
    'delta|moneyness|call': 'Call delta increases with ln(F/K); ATM sits near e^{−qT}/2.',
    'delta|moneyness|put': 'Put delta increases (becomes less negative) as ln(F/K) rises (put goes OTM).',
    'gamma|S': 'Gamma is typically unimodal and peaks near ATM (forward, not necessarily S=K).',
    'gamma|moneyness': 'Gamma typically peaks near ln(F/K)≈0 and decays in the wings.',
    'gamma|K': 'Sweeping strike moves the ATM location; gamma peaks when K≈F.',
    'vega|S': 'Vega typically peaks near ATM, similar in shape to gamma but scaled by S√T.',
    'vega|moneyness': 'Vega typically peaks near ATM and is the same for call and put (European BSM).',
    'vega|sigma': 'Vega vs σ is not required to be monotone; vomma = ∂Vega/∂σ can change sign.',
    'theta|S': 'Calendar theta is often most negative near ATM; deep ITM puts can be an exception.',
    'theta|T': 'As T→0, ATM theta can explode in magnitude while deep OTM theta → 0.',
    'rho|S': 'Call rho is typically positive and larger ITM; put rho is typically negative.',
    'vanna|moneyness': 'Vanna typically changes sign across ATM (linked to d2).',
    'vomma|moneyness': 'Vomma (volga) is typically positive in the wings and can dip near ATM.',
    'speed|S': 'Speed (∂Γ/∂S) typically changes sign around the gamma peak.',
    'price|S|call': 'Call price is increasing and convex in S (delta>0, gamma>0).',
    'price|S|put': 'Put price is decreasing and convex in S (delta<0, gamma>0).',
    'price|sigma': 'Price increases with σ (vega>0) for both vanilla calls and puts.',
    'price|T': 'More time usually raises OTM premium; deep ITM carry/discounting can dominate.',
    'lambda|S': 'Elasticity is typically largest for cheap OTM options and unstable near V≈0.',
    'charm|moneyness': 'Charm (delta decay) often changes sign across moneyness.',
    'color|T': 'Color describes how the gamma peak concentrates as expiry approaches.'
  };

  const State = {
    params: { ...CONFIG.DEFAULT },
    dayCount: 365,
    unitMode: 'unit',
    thetaMode: 'year',
    charts: {},
    lastBuilder: null,
    lastCross: null,
    lastFamily: null,
    debounce: null
  };

  function displayOpts() {
    return { unitMode: State.unitMode, thetaMode: State.thetaMode, dayCount: State.dayCount };
  }

  function axisLabel(id) {
    const a = INPUT_AXES.find(x => x.id === id) || METRICS.find(x => x.id === id);
    return a ? a.label : id;
  }

  function fillSelect(el, items, selected) {
    el.innerHTML = items.map(it => {
      const id = it.id || it;
      const label = it.label || it;
      return `<option value="${id}"${id === selected ? ' selected' : ''}>${label}</option>`;
    }).join('');
  }

  function selectedYs() {
    return [...document.querySelectorAll('#bYPicks input:checked')].map(i => i.value);
  }

  function selectedRegimes() {
    const boxes = [...document.querySelectorAll('#bRegimeChecks input:checked')];
    if (!boxes.length) return CONFIG.REGIMES.map(r => r.id);
    return boxes.map(b => b.value);
  }

  function readParams() {
    State.params.S = +document.getElementById('inpS').value;
    State.params.K = +document.getElementById('inpK').value;
    State.params.sigma = +document.getElementById('inpSigma').value;
    State.params.T = +document.getElementById('inpT').value;
    State.params.r = +document.getElementById('inpR').value;
    State.params.q = +document.getElementById('inpQ').value;
    State.dayCount = +document.getElementById('inpDayCount').value;
    State.unitMode = document.getElementById('inpUnits').value;
    State.thetaMode = document.getElementById('inpTheta').value;
  }

  function writeParams() {
    const p = State.params;
    document.getElementById('inpS').value = p.S;
    document.getElementById('inpK').value = p.K;
    document.getElementById('inpSigma').value = p.sigma;
    document.getElementById('inpT').value = p.T;
    document.getElementById('inpR').value = p.r;
    document.getElementById('inpQ').value = p.q;
    document.querySelectorAll('#optTypeSeg button').forEach(b => {
      b.classList.toggle('active', b.dataset.type === p.type);
    });
  }

  function currentParams() {
    readParams();
    return sanitizeParams(State.params);
  }

  function issuesBox() {
    const p = currentParams();
    const issues = window.BSM.validateParams(p);
    const box = document.getElementById('warnGlobal');
    const st = document.getElementById('modelStatus');
    if (issues.length) {
      box.classList.add('show');
      box.textContent = 'Validation: ' + issues.join('; ');
      st.textContent = 'Model Status: invalid inputs';
      st.className = 'status-pill warn';
    } else {
      box.classList.remove('show');
      const res = calculateBSM(p);
      const m = classifyMoneyness(res);
      st.textContent = `OK · ${p.type.toUpperCase()} · ${m.label} · ln(F/K)=${fmt(res.logFwdMoneyness, 3)}`;
      st.className = 'status-pill ok';
    }
    return issues;
  }

  function destroyChart(key) {
    if (State.charts[key]) {
      try { State.charts[key].destroy(); } catch (e) { /* ignore */ }
      State.charts[key] = null;
    }
  }

  function chartDefaults() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { labels: { color: '#e6edf7', boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label(ctx) {
              const y = ctx.parsed.y;
              return `${ctx.dataset.label}: ${fmt(y, 6)}`;
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          ticks: { color: '#8b95a8' },
          grid: { color: '#1a2030' },
          title: { display: true, color: '#8b95a8' }
        },
        y: {
          ticks: { color: '#8b95a8' },
          grid: { color: '#1a2030' },
          title: { display: true, color: '#8b95a8' }
        }
      }
    };
  }

  function transformY(y, opts) {
    if (!Number.isFinite(y)) return null;
    if (opts.logY) {
      const a = Math.abs(y);
      if (a < 1e-15) return null;
      return Math.log10(a);
    }
    return y;
  }

  function normalizeSeries(arr) {
    const finite = arr.filter(Number.isFinite);
    if (!finite.length) return arr.map(() => null);
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    const span = hi - lo || 1e-12;
    return arr.map(v => Number.isFinite(v) ? (v - lo) / span : null);
  }

  function sweep(params, xKey, yKeys, opts) {
    opts = opts || {};
    const range = opts.range || defaultAxisRange(xKey, params);
    const n = Math.min(401, Math.max(11, opts.pts || 81));
    const xs = linspace(range.min, range.max, n);
    const d = displayOpts();
    const allow = opts.regimes || null;
    const out = { xs: [], series: {}, extras: [], range, xKey, params: { ...params } };
    yKeys.forEach(k => { out.series[k] = []; });

    for (const x of xs) {
      const p = applyXValue(params, xKey, x, opts.moneySweep);
      const res = calculateBSM(p);
      const regime = classifyMoneyness(res);
      if (allow && allow.length && !allow.includes(regime.id) && !allow.includes('overall')) {
        continue;
      }
      out.xs.push(x);
      out.extras.push({ x, res, regime, params: p });
      for (const k of yKeys) {
        out.series[k].push(metricFromRes(res, k, d));
      }
    }
    return out;
  }

  function analyzeSeries(xs, ys, xKey, yKey, params) {
    const pts = [];
    for (let i = 0; i < xs.length; i++) {
      if (Number.isFinite(xs[i]) && Number.isFinite(ys[i])) pts.push({ x: xs[i], y: ys[i], i });
    }
    if (pts.length < 3) {
      return { ok: false, bullets: ['Insufficient finite points to analyse this slice (check bounds / regime filter).'] };
    }
    let ymin = Infinity, ymax = -Infinity, xminAtMax = pts[0].x, xminAtMin = pts[0].x;
    let nUp = 0, nDn = 0, zeros = [];
    const d1 = [];
    for (let i = 0; i < pts.length; i++) {
      if (pts[i].y > ymax) { ymax = pts[i].y; xminAtMax = pts[i].x; }
      if (pts[i].y < ymin) { ymin = pts[i].y; xminAtMin = pts[i].x; }
      if (i) {
        const dy = pts[i].y - pts[i - 1].y;
        if (dy > 1e-12) nUp++;
        else if (dy < -1e-12) nDn++;
        d1.push(dy / (pts[i].x - pts[i - 1].x || 1e-12));
        const a = pts[i - 1].y, b = pts[i].y;
        if (a === 0) zeros.push(pts[i - 1].x);
        else if (a * b < 0) {
          const t = a / (a - b);
          zeros.push(pts[i - 1].x + t * (pts[i].x - pts[i - 1].x));
        }
      }
    }
    let nInflect = 0;
    for (let i = 1; i < d1.length; i++) {
      if (d1[i] * d1[i - 1] < 0) nInflect++;
    }
    const span = Math.abs(ymax - ymin) || 1e-12;
    const monotoneUp = nDn === 0 && nUp > 0;
    const monotoneDn = nUp === 0 && nDn > 0;
    const unimodal = !monotoneUp && !monotoneDn && nInflect <= 3;
    const endSlope = d1.length ? d1[d1.length - 1] : NaN;
    const startSlope = d1.length ? d1[0] : NaN;

    const res0 = calculateBSM(params);
    const yNow = metricFromRes(res0, yKey, displayOpts());
    let xNow;
    if (xKey === 'moneyness' || xKey === 'logFwdMoneyness') xNow = res0.logFwdMoneyness;
    else if (xKey === 'spotMoneyness') xNow = res0.spotMoneyness;
    else if (xKey === 'fwdMoneyness') xNow = res0.fwdMoneyness;
    else xNow = res0[xKey];

    let nearestATM = null;
    if (xKey === 'S' || xKey === 'K' || xKey === 'moneyness' || xKey === 'spotMoneyness' || xKey === 'fwdMoneyness') {
      let best = Infinity;
      for (let i = 0; i < xs.length; i++) {
        if (!Number.isFinite(ys[i])) continue;
        let dist;
        if (xKey === 'S') dist = Math.abs(xs[i] - res0.forward);
        else if (xKey === 'K') dist = Math.abs(xs[i] - res0.forward);
        else if (xKey === 'moneyness') dist = Math.abs(xs[i]);
        else dist = Math.abs(xs[i] - 1);
        if (dist < best) { best = dist; nearestATM = { x: xs[i], y: ys[i] }; }
      }
    }

    const type = params.type;
    const hint = SHAPE_HINTS[`${yKey}|${xKey}|${type}`] || SHAPE_HINTS[`${yKey}|${xKey}`] || '';
    const tip = TOOLTIPS[yKey] || {};

    const shape = monotoneUp ? 'monotone increasing' : monotoneDn ? 'monotone decreasing' : (unimodal ? 'non-monotone (typically peaked / signed)' : 'non-monotone with multiple turns');
    const peakRel = (ymax - ymin) > 0 ? (ymax - yNow) / span : 0;

    return {
      ok: true, ymin, ymax, xminAtMax, xminAtMin, zeros, nInflect, nUp, nDn,
      monotoneUp, monotoneDn, unimodal, shape, yNow, xNow, nearestATM,
      startSlope, endSlope, hint, tip, span, peakRel
    };
  }

  function analysisHTML(an, xKey, yKey, extra) {
    if (!an.ok) return `<p class="muted">${an.bullets[0]}</p>`;
    const bits = [];
    bits.push(`<p><span class="tag">${yKey}</span> vs <span class="tag">${axisLabel(xKey)}</span> · ${an.shape}.</p>`);
    bits.push('<ul>');
    bits.push(`<li><span class="tag peak">max</span> ${fmt(an.ymax, 6)} at ${axisLabel(xKey)} = ${fmt(an.xminAtMax, 4)}</li>`);
    bits.push(`<li><span class="tag">min</span> ${fmt(an.ymin, 6)} at ${axisLabel(xKey)} = ${fmt(an.xminAtMin, 4)}</li>`);
    bits.push(`<li>Value at current params: ${fmt(an.yNow, 6)} (X = ${fmt(an.xNow, 4)})</li>`);
    if (an.nearestATM) {
      bits.push(`<li>Near ATM on this sweep: ${fmt(an.nearestATM.y, 6)} at X = ${fmt(an.nearestATM.x, 4)}</li>`);
    }
    if (an.zeros.length) {
      bits.push(`<li><span class="tag zero">zeros</span> ≈ ${an.zeros.slice(0, 6).map(z => fmt(z, 4)).join(', ')}${an.zeros.length > 6 ? ' …' : ''}</li>`);
    } else {
      bits.push('<li>No sign change on this window (does not cross zero).</li>');
    }
    bits.push(`<li>Endpoint slopes: start ${fmt(an.startSlope, 4)}, end ${fmt(an.endSlope, 4)}. Inflection-ish turns in first differences: ${an.nInflect}.</li>`);
    if (an.hint) bits.push(`<li><em>${an.hint}</em></li>`);
    if (an.tip.interp) bits.push(`<li>${an.tip.def || yKey}: ${an.tip.interp}</li>`);
    if (extra) extra.forEach(t => bits.push(`<li>${t}</li>`));
    bits.push('</ul>');
    bits.push('<p class="footnote">Analysis is computed from the sampled curve at current BSM parameters. Higher-order Greeks can change shape with σ, T, r, q and moneyness — treat “typical” statements as diagnostics, not identities.</p>');
    return bits.join('');
  }

  function statsTable(sweeps) {
    let html = '<table class="matrix"><thead><tr><th class="sticky">Y</th><th>min</th><th>at X</th><th>max</th><th>at X</th><th>now</th><th>shape</th></tr></thead><tbody>';
    for (const s of sweeps) {
      const an = s.an;
      if (!an.ok) {
        html += `<tr><td class="sticky">${s.yKey}</td><td colspan="6" class="muted">n/a</td></tr>`;
        continue;
      }
      html += `<tr><td class="sticky">${s.yKey}</td><td>${fmt(an.ymin, 4)}</td><td>${fmt(an.xminAtMin, 4)}</td><td>${fmt(an.ymax, 4)}</td><td>${fmt(an.xminAtMax, 4)}</td><td>${fmt(an.yNow, 4)}</td><td>${an.monotoneUp ? '↑' : an.monotoneDn ? '↓' : '±'}</td></tr>`;
    }
    html += '</tbody></table>';
    return html;
  }

  function snapshotHTML() {
    const p = currentParams();
    const res = calculateBSM(p);
    const m = classifyMoneyness(res);
    const d = displayOpts();
    const keys = [
      ['Regime', m.label],
      ['Price', fmt(getMetric(res, 'price', d))],
      ['Δ', fmt(getMetric(res, 'delta', d))],
      ['Γ', fmt(getMetric(res, 'gamma', d), 6)],
      ['Vega', fmt(getMetric(res, 'vega', d))],
      ['Θ', fmt(getMetric(res, 'theta', d))],
      ['ρ', fmt(getMetric(res, 'rho', d))],
      ['Vanna', fmt(getMetric(res, 'vanna', d))],
      ['Vomma', fmt(getMetric(res, 'vomma', d))],
      ['ln(F/K)', fmt(res.logFwdMoneyness)],
      ['F', fmt(res.forward, 3)],
      ['d1', fmt(res.d1)]
    ];
    return keys.map(([n, v]) => `<div class="metric"><div class="name">${n}</div><div class="val">${v}</div></div>`).join('');
  }

  function lineChart(canvas, datasets, xTitle, yTitle, key) {
    destroyChart(key);
    if (!window.Chart || !canvas) return null;
    const opt = chartDefaults();
    opt.scales.x.title.text = xTitle;
    opt.scales.y.title.text = yTitle;
    State.charts[key] = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: opt
    });
    return State.charts[key];
  }

  function scatterChart(canvas, datasets, xTitle, yTitle, key) {
    destroyChart(key);
    if (!window.Chart || !canvas) return null;
    const opt = chartDefaults();
    opt.scales.x.title.text = xTitle;
    opt.scales.y.title.text = yTitle;
    State.charts[key] = new Chart(canvas, {
      type: 'scatter',
      data: { datasets },
      options: opt
    });
    return State.charts[key];
  }

  function drawSpark(canvas, seriesList) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 200;
    const h = canvas.clientHeight || 90;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, w, h);
    let ymin = Infinity, ymax = -Infinity;
    for (const s of seriesList) {
      for (const y of s.ys) {
        if (Number.isFinite(y)) { ymin = Math.min(ymin, y); ymax = Math.max(ymax, y); }
      }
    }
    if (!Number.isFinite(ymin)) return;
    if (ymax === ymin) { ymax += 1e-9; ymin -= 1e-9; }
    const pad = 6;
    const mapX = (i, n) => pad + (n <= 1 ? 0 : i / (n - 1)) * (w - 2 * pad);
    const mapY = y => pad + (1 - (y - ymin) / (ymax - ymin)) * (h - 2 * pad);
    for (const s of seriesList) {
      ctx.beginPath();
      ctx.strokeStyle = s.color || '#3d9cf0';
      ctx.lineWidth = 1.4;
      let started = false;
      for (let i = 0; i < s.ys.length; i++) {
        const y = s.ys[i];
        if (!Number.isFinite(y)) { started = false; continue; }
        const x = mapX(i, s.ys.length);
        const py = mapY(y);
        if (!started) { ctx.moveTo(x, py); started = true; }
        else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#8b95a8';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(fmt(ymax, 3), 4, 10);
    ctx.fillText(fmt(ymin, 3), 4, h - 4);
  }

  function regimeLegend(el) {
    el.innerHTML = CONFIG.REGIMES.map(r =>
      `<span><i class="swatch" style="background:${REGIME_COLORS[r.id]}"></i>${r.short}</span>`
    ).join('');
  }

  function builderDatasets(sw, yKeys, opts) {
    const ds = [];
    for (const yKey of yKeys) {
      let ys = sw.series[yKey].slice();
      if (opts.normalize) ys = normalizeSeries(ys);
      if (opts.logY) ys = ys.map(y => transformY(y, { logY: true }));
      if (opts.colorByRegime && sw.extras.length === ys.length) {
        const byReg = {};
        CONFIG.REGIMES.forEach(r => { byReg[r.id] = []; });
        for (let i = 0; i < sw.xs.length; i++) {
          const id = sw.extras[i].regime.id;
          if (!byReg[id]) byReg[id] = [];
          byReg[id].push({ x: sw.xs[i], y: ys[i] });
        }
        for (const r of CONFIG.REGIMES) {
          if (!byReg[r.id] || !byReg[r.id].length) continue;
          ds.push({
            label: `${yKey} · ${r.short}`,
            data: byReg[r.id],
            showLine: true,
            pointRadius: 0,
            borderWidth: 1.6,
            borderColor: REGIME_COLORS[r.id],
            backgroundColor: REGIME_COLORS[r.id]
          });
        }
      } else {
        ds.push({
          label: yKey,
          data: sw.xs.map((x, i) => ({ x, y: ys[i] })),
          showLine: true,
          pointRadius: 0,
          borderWidth: 2,
          borderColor: GREEK_COLORS[yKey] || '#3d9cf0',
          backgroundColor: GREEK_COLORS[yKey] || '#3d9cf0'
        });
      }
    }
    return ds;
  }

  function renderBuilder() {
    const p = currentParams();
    issuesBox();
    const xKey = document.getElementById('bX').value;
    const yKeys = selectedYs();
    if (!yKeys.length) {
      document.getElementById('bAnalysis').innerHTML = '<p class="muted">Select at least one Y metric.</p>';
      return;
    }
    let min = +document.getElementById('bMin').value;
    let max = +document.getElementById('bMax').value;
    const pts = +document.getElementById('bPts').value || 101;
    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      const r = defaultAxisRange(xKey, p);
      min = r.min; max = r.max;
      document.getElementById('bMin').value = +min.toFixed(6);
      document.getElementById('bMax').value = +max.toFixed(6);
    }
    const mode = document.getElementById('bRegimeMode').value;
    const moneySweep = document.getElementById('bMoneySweep').value;
    const normalize = document.getElementById('bNormalize').checked;
    const logY = document.getElementById('bLogY').checked;
    const opts = { range: { min, max }, pts, moneySweep, normalize, logY };

    document.getElementById('bTitle').textContent =
      `${yKeys.join(', ')} vs ${axisLabel(xKey)} · ${p.type.toUpperCase()}`;
    document.getElementById('bSnapshot').innerHTML = snapshotHTML();
    regimeLegend(document.getElementById('bLegend'));

    const datasets = [];
    const analyses = [];
    const extraNotes = [];

    if (mode === 'overlay') {
      extraNotes.push('Each coloured line holds a representative strike for that moneyness band, then sweeps X. This is how Γ(σ) or Δ(T) differ ITM vs OTM.');
      for (const reg of CONFIG.REGIMES) {
        if (!selectedRegimes().includes(reg.id)) continue;
        const rp = representativeParams(reg.id, p.type, p);
        const hold = { ...p, K: rp.K };
        const sw = sweep(hold, xKey, yKeys, opts);
        for (const yKey of yKeys) {
          let ys = sw.series[yKey];
          if (normalize) ys = normalizeSeries(ys);
          if (logY) ys = ys.map(y => transformY(y, { logY: true }));
          datasets.push({
            label: `${yKey} · ${reg.short}`,
            data: sw.xs.map((x, i) => ({ x, y: ys[i] })),
            showLine: true,
            pointRadius: 0,
            borderWidth: 1.7,
            borderColor: REGIME_COLORS[reg.id],
            backgroundColor: REGIME_COLORS[reg.id]
          });
          if (yKeys.length === 1) {
            analyses.push({ yKey: `${yKey} ${reg.short}`, an: analyzeSeries(sw.xs, sw.series[yKey], xKey, yKey, hold) });
          }
        }
      }
      const overall = sweep(p, xKey, yKeys, opts);
      State.lastBuilder = { xKey, yKeys, sweep: overall, params: p };
      const atmAn = analyses.find(a => a.yKey.endsWith(' ATM'));
      const focus = atmAn || analyses[0];
      if (yKeys.length === 1 && focus) {
        document.getElementById('bAnalysis').innerHTML = analysisHTML(focus.an, xKey, yKeys[0], extraNotes);
      } else {
        document.getElementById('bAnalysis').innerHTML = analysisHTML(
          analyzeSeries(overall.xs, overall.series[yKeys[0]], xKey, yKeys[0], p),
          xKey, yKeys[0], extraNotes
        );
      }
      document.getElementById('bStats').innerHTML = statsTable(analyses.length ? analyses : yKeys.map(yKey => ({
        yKey, an: analyzeSeries(overall.xs, overall.series[yKey], xKey, yKey, p)
      })));
    } else {
      if (mode === 'filter') opts.regimes = selectedRegimes();
      const sw = sweep(p, xKey, yKeys, opts);
      State.lastBuilder = { xKey, yKeys, sweep: sw, params: p };
      const dsOpts = { normalize, logY, colorByRegime: mode === 'color' };
      datasets.push(...builderDatasets(sw, yKeys, dsOpts));
      extraNotes.push(mode === 'filter'
        ? 'Points outside the checked moneyness bands were dropped from the sweep.'
        : mode === 'color'
          ? 'The same continuous sweep is split by the signed-ln(F/K) classifier (call ITM ⇔ put OTM flipped).'
          : 'Overall sweep holds other BSM inputs fixed and varies only X.');
      const anList = yKeys.map(yKey => ({ yKey, an: analyzeSeries(sw.xs, sw.series[yKey], xKey, yKey, p) }));
      document.getElementById('bAnalysis').innerHTML = analysisHTML(anList[0].an, xKey, yKeys[0], extraNotes);
      document.getElementById('bStats').innerHTML = statsTable(anList);
    }

    if (document.getElementById('bShowATM').checked && !logY && !normalize) {
      const res0 = calculateBSM(p);
      let xMark = p[xKey];
      if (xKey === 'moneyness') xMark = res0.logFwdMoneyness;
      else if (xKey === 'spotMoneyness') xMark = res0.spotMoneyness;
      else if (xKey === 'fwdMoneyness') xMark = res0.fwdMoneyness;
      if (Number.isFinite(xMark) && mode !== 'overlay') {
        for (const yKey of yKeys) {
          const yNow = metricFromRes(res0, yKey, displayOpts());
          if (!Number.isFinite(yNow)) continue;
          datasets.push({
            label: `${yKey} @ current`,
            data: [{ x: xMark, y: yNow }],
            showLine: false,
            pointRadius: 5,
            pointStyle: 'rectRot',
            borderWidth: 2,
            borderColor: '#f8fafc',
            backgroundColor: GREEK_COLORS[yKey] || '#f8fafc'
          });
        }
      }
    }

    const yTitle = (normalize ? 'normalized ' : '') + (logY ? 'log10|Y|' : (yKeys.length === 1 ? axisLabel(yKeys[0]) : 'metric'));
    const fb = document.getElementById('bFallback');
    if (!window.Chart) fb.style.display = 'block';
    else fb.style.display = 'none';
    lineChart(document.getElementById('bChart'), datasets, axisLabel(xKey), yTitle, 'builder');
  }

  function exportBuilderCsv() {
    const last = State.lastBuilder;
    if (!last) return;
    const sw = last.sweep;
    const cols = ['x', ...last.yKeys, 'regime', 'S', 'K'];
    const lines = [cols.join(',')];
    for (let i = 0; i < sw.xs.length; i++) {
      const ex = sw.extras[i];
      const row = [sw.xs[i], ...last.yKeys.map(k => sw.series[k][i]), ex.regime.id, ex.params.S, ex.params.K];
      lines.push(row.join(','));
    }
    downloadText('bsm-atlas-series.csv', lines.join('\n'));
  }

  function exportPng(key, name) {
    const ch = State.charts[key];
    if (!ch) return;
    const a = document.createElement('a');
    a.href = ch.toBase64Image();
    a.download = name || 'bsm-chart.png';
    a.click();
  }

  function downloadText(name, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  function renderAtlas() {
    const p = currentParams();
    issuesBox();
    const mode = document.getElementById('aMode').value;
    const style = document.getElementById('aStyle').value;
    const grid = document.getElementById('aGrid');
    grid.innerHTML = '';
    regimeLegend(document.getElementById('aLegend'));

    let specs = [];
    if (mode === 'y_vs_inputs') {
      const y = document.getElementById('aY').value;
      specs = DRIVER_AXES.map(ax => ({ x: ax.id, y }));
    } else if (mode === 'greeks_vs_x') {
      const x = document.getElementById('aX').value;
      specs = GREEK_METRICS.map(g => ({ x, y: g.id }));
    } else {
      for (const g of GREEK_METRICS) {
        for (const ax of DRIVER_AXES) specs.push({ x: ax.id, y: g.id });
      }
    }

    const pts = style === 'overlay' ? 21 : 31;
    for (const spec of specs) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML = `<h4>${spec.y} vs ${axisLabel(spec.x)}</h4><canvas></canvas><div class="meta"></div>`;
      grid.appendChild(tile);
      const canvas = tile.querySelector('canvas');
      const meta = tile.querySelector('.meta');
      const seriesList = [];
      if (style === 'overlay') {
        for (const reg of CONFIG.REGIMES) {
          const rp = representativeParams(reg.id, p.type, p);
          const sw = sweep({ ...p, K: rp.K }, spec.x, [spec.y], { pts });
          seriesList.push({ ys: sw.series[spec.y], color: REGIME_COLORS[reg.id] });
        }
        const preview = sweep(p, spec.x, [spec.y], { pts: 41 });
        const an = analyzeSeries(preview.xs, preview.series[spec.y], spec.x, spec.y, p);
        meta.textContent = an.ok ? `${an.shape.split(' ')[0]} · max ${fmt(an.ymax, 3)}` : '';
      } else {
        const sw = sweep(p, spec.x, [spec.y], { pts });
        seriesList.push({ ys: sw.series[spec.y], color: GREEK_COLORS[spec.y] });
        const an = analyzeSeries(sw.xs, sw.series[spec.y], spec.x, spec.y, p);
        meta.textContent = an.ok ? `${an.monotoneUp ? '↑' : an.monotoneDn ? '↓' : '±'}  [${fmt(an.ymin, 3)}, ${fmt(an.ymax, 3)}]` : 'n/a';
      }
      requestAnimationFrame(() => drawSpark(canvas, seriesList));
      tile.addEventListener('click', () => {
        document.querySelectorAll('#mainTabs button').forEach(b => b.classList.toggle('active', b.dataset.page === 'builder'));
        document.querySelectorAll('.page').forEach(pg => pg.classList.toggle('active', pg.id === 'page-builder'));
        document.getElementById('bX').value = spec.x;
        document.querySelectorAll('#bYPicks input').forEach(i => { i.checked = i.value === spec.y; });
        const r = defaultAxisRange(spec.x, p);
        document.getElementById('bMin').value = r.min;
        document.getElementById('bMax').value = r.max;
        document.getElementById('bRegimeMode').value = style === 'overlay' ? 'overlay' : 'overall';
        renderBuilder();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  function renderRegimes() {
    const p = currentParams();
    issuesBox();
    const xKey = document.getElementById('rX').value;
    const yKey = document.getElementById('rY').value;
    const pts = +document.getElementById('rPts').value || 81;
    const host = document.getElementById('rFacets');
    host.innerHTML = '';

    const facets = [{ id: 'overall', label: 'Overall (current K)', params: p, color: REGIME_COLORS.overall }];
    for (const reg of CONFIG.REGIMES) {
      const rp = representativeParams(reg.id, p.type, p);
      facets.push({ id: reg.id, label: reg.label, params: { ...p, K: rp.K }, color: REGIME_COLORS[reg.id] });
    }

    const rows = [];
    const extra = [];
    for (const f of facets) {
      const card = document.createElement('div');
      card.className = 'card';
      const cid = 'rf_' + f.id;
      card.innerHTML = `<h3>${f.label}</h3><div class="chart-wrap"><canvas id="${cid}"></canvas></div><div class="mono muted" style="margin-top:6px;"></div>`;
      host.appendChild(card);
      const sw = sweep(f.params, xKey, [yKey], { pts });
      const an = analyzeSeries(sw.xs, sw.series[yKey], xKey, yKey, f.params);
      const res = calculateBSM(f.params);
      const m = classifyMoneyness(res);
      card.querySelector('.mono').textContent =
        `K=${fmt(f.params.K, 2)} · ln(F/K)=${fmt(res.logFwdMoneyness, 3)} · ${m.label} · ${yKey} now ${fmt(an.yNow, 4)}`;
      lineChart(card.querySelector('canvas'), [{
        label: yKey,
        data: sw.xs.map((x, i) => ({ x, y: sw.series[yKey][i] })),
        showLine: true, pointRadius: 0, borderWidth: 2,
        borderColor: f.color, backgroundColor: f.color
      }], axisLabel(xKey), yKey, cid);
      rows.push({ f, an, res, m });
    }

    let html = `<table class="matrix"><thead><tr><th class="sticky">Regime</th><th>K</th><th>ln(F/K)</th><th>now</th><th>min</th><th>max</th><th>peak X</th><th>shape</th></tr></thead><tbody>`;
    for (const row of rows) {
      const an = row.an;
      html += `<tr><td class="sticky">${row.f.label}</td><td>${fmt(row.f.params.K, 2)}</td><td>${fmt(row.res.logFwdMoneyness, 3)}</td><td>${fmt(an.yNow, 4)}</td><td>${fmt(an.ymin, 4)}</td><td>${fmt(an.ymax, 4)}</td><td>${fmt(an.xminAtMax, 4)}</td><td>${an.monotoneUp ? '↑' : an.monotoneDn ? '↓' : '±'}</td></tr>`;
    }
    html += '</tbody></table>';
    document.getElementById('rTable').innerHTML = html;

    const overall = rows[0];
    const atm = rows.find(r => r.f.id === 'atm');
    const ditm = rows.find(r => r.f.id === 'deep_itm');
    const dotm = rows.find(r => r.f.id === 'deep_otm');
    if (atm && ditm && dotm && atm.an.ok) {
      extra.push(`ATM |${yKey}| peak magnitude ${fmt(Math.max(Math.abs(atm.an.ymax), Math.abs(atm.an.ymin)), 4)} vs deep ITM ${fmt(Math.max(Math.abs(ditm.an.ymax), Math.abs(ditm.an.ymin)), 4)} vs deep OTM ${fmt(Math.max(Math.abs(dotm.an.ymax), Math.abs(dotm.an.ymin)), 4)}.`);
      if (['gamma', 'vega'].includes(yKey)) {
        extra.push('Gamma and vega are typically largest near ATM and compressed in the deep wings — confirm on the peak-X column.');
      }
      if (yKey === 'delta') {
        extra.push('Delta should be closest to ±e^{−qT} in deep ITM and closest to 0 in deep OTM.');
      }
    }
    extra.push(REGIME_EXPLAIN[p.type][classifyMoneyness(calculateBSM(p)).id] || '');
    document.getElementById('rAnalysis').innerHTML = analysisHTML(overall.an, xKey, yKey, extra);
  }

  function parametricPoints(params, driver, gx, gy, opts) {
    const sw = sweep(params, driver, [gx, gy], opts);
    const d = displayOpts();
    const points = sw.extras.map((ex, i) => ({
      x: sw.series[gx][i],
      y: sw.series[gy][i],
      driver: sw.xs[i],
      regime: ex.regime,
      res: ex.res
    })).filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    return { points, sw, d };
  }

  function renderCross() {
    const p = currentParams();
    issuesBox();
    const driver = document.getElementById('cDriver').value;
    const gx = document.getElementById('cGX').value;
    const gy = document.getElementById('cGY').value;
    const pts = +document.getElementById('cPts').value || 121;
    const { points } = parametricPoints(p, driver, gx, gy, { pts });
    State.lastCross = { driver, gx, gy, points, params: p };

    const byReg = {};
    CONFIG.REGIMES.forEach(r => { byReg[r.id] = []; });
    for (const pt of points) {
      byReg[pt.regime.id].push({ x: pt.x, y: pt.y });
    }
    const datasets = CONFIG.REGIMES.filter(r => byReg[r.id].length).map(r => ({
      label: r.short,
      data: byReg[r.id],
      showLine: true,
      pointRadius: 2,
      borderWidth: 1.4,
      borderColor: REGIME_COLORS[r.id],
      backgroundColor: REGIME_COLORS[r.id]
    }));
    document.getElementById('cTitle').textContent = `${gy} vs ${gx}  (driver: ${axisLabel(driver)})`;
    regimeLegend(document.getElementById('cLegend'));
    scatterChart(document.getElementById('cChart'), datasets, axisLabel(gx), axisLabel(gy), 'cross');

    const xs = points.map(pt => pt.x);
    const ys = points.map(pt => pt.y);
    const an = analyzeSeries(xs, ys, gx, gy, p);
    const notes = [
      `Parametric path generated by sweeping ${axisLabel(driver)} with other BSM inputs held at current values.`,
      'Color encodes the moneyness regime of each sample — the path is not a causal “Greek A causes Greek B” relation.',
      gx === 'delta' && gy === 'gamma' ? 'Classic profile: gamma vs delta is typically a hump (calls) peaking near Δ≈e^{−qT}/2.' : '',
      gx === 'vega' && gy === 'vomma' ? 'Vomma vs vega traces how vol convexity evolves as the driver moves through moneyness.' : ''
    ].filter(Boolean);
    document.getElementById('cAnalysis').innerHTML = analysisHTML(an, gx, gy, notes);
  }

  function renderCrossGallery() {
    const p = currentParams();
    const driver = document.getElementById('cDriver').value;
    const grid = document.getElementById('cGrid');
    grid.innerHTML = '';
    const pairs = [];
    for (let i = 0; i < PRIMARY_METRICS.length; i++) {
      for (let j = 0; j < PRIMARY_METRICS.length; j++) {
        if (i === j) continue;
        pairs.push({ gx: PRIMARY_METRICS[i], gy: PRIMARY_METRICS[j] });
      }
    }
    for (const pair of pairs) {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.innerHTML = `<h4>${pair.gy} vs ${pair.gx}</h4><canvas></canvas><div class="meta">driver ${axisLabel(driver)}</div>`;
      grid.appendChild(tile);
      const { points } = parametricPoints(p, driver, pair.gx, pair.gy, { pts: 41 });
      const byReg = {};
      const seriesList = [];
      CONFIG.REGIMES.forEach(r => { byReg[r.id] = []; });
      points.forEach(pt => byReg[pt.regime.id].push(pt.y));
      // spark uses index; reconstruct y in driver order already sequential
      const grouped = {};
      CONFIG.REGIMES.forEach(r => { grouped[r.id] = []; });
      points.forEach(pt => grouped[pt.regime.id].push(pt.y));
      // Better: one polyline in parametric order
      seriesList.push({ ys: points.map(pt => pt.y), color: GREEK_COLORS[pair.gy] });
      requestAnimationFrame(() => drawSpark(tile.querySelector('canvas'), seriesList));
      tile.addEventListener('click', () => {
        document.getElementById('cGX').value = pair.gx;
        document.getElementById('cGY').value = pair.gy;
        renderCross();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }

  function heatColor(t) {
    const c = Math.max(0, Math.min(1, t));
    const r = Math.round(255 * Math.min(1, Math.max(0, c * 2 - 0.5)));
    const g = Math.round(255 * Math.min(1, c < 0.5 ? c * 2 : (1 - c) * 2));
    const b = Math.round(255 * Math.min(1, Math.max(0, 1 - c * 2)));
    return `rgb(${r},${Math.max(g, 40)},${b})`;
  }

  function inRegimeWindow(res, regimeId) {
    if (!regimeId || regimeId === 'all') return true;
    return classifyMoneyness(res).id === regimeId;
  }

  function renderHeatmap() {
    const p = currentParams();
    issuesBox();
    const canvas = document.getElementById('heatmapCanvas');
    const ctx = canvas.getContext('2d');
    const xVar = document.getElementById('hX').value;
    const yVar = document.getElementById('hY').value;
    if (xVar === yVar) {
      document.getElementById('hFoot').textContent = 'Pick two different axes for X and Y.';
      return;
    }
    const zKey = document.getElementById('hZ').value;
    const n = Math.min(80, Math.max(16, +document.getElementById('hRes').value || 40));
    const regimeId = document.getElementById('hRegime').value;
    const xr = defaultAxisRange(xVar, p);
    const yr = defaultAxisRange(yVar, p);
    const d = displayOpts();
    const padL = 56, padR = 24, padT = 24, padB = 44;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, W, H);
    const grid = [];
    let zmin = Infinity, zmax = -Infinity;
    for (let j = 0; j < n; j++) {
      grid[j] = [];
      const yv = yr.min + (yr.max - yr.min) * j / (n - 1);
      for (let i = 0; i < n; i++) {
        const xv = xr.min + (xr.max - xr.min) * i / (n - 1);
        let pr = applyXValue(p, xVar, xv, 'K');
        pr = applyXValue(pr, yVar, yv, 'K');
        const res = calculateBSM(pr);
        if (!inRegimeWindow(res, regimeId)) {
          grid[j][i] = NaN;
          continue;
        }
        const z = metricFromRes(res, zKey, d);
        grid[j][i] = z;
        if (Number.isFinite(z)) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
      }
    }
    if (!Number.isFinite(zmin)) { zmin = 0; zmax = 1; }
    if (zmax === zmin) zmax = zmin + 1e-9;
    const cw = (W - padL - padR) / n;
    const ch = (H - padT - padB) / n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const z = grid[j][i];
        const t = (z - zmin) / (zmax - zmin);
        ctx.fillStyle = Number.isFinite(z) ? heatColor(t) : '#161b22';
        ctx.fillRect(padL + i * cw, padT + (n - 1 - j) * ch, cw + 0.5, ch + 0.5);
      }
    }
    ctx.fillStyle = '#8b95a8';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${axisLabel(xVar)}: ${fmt(xr.min, 3)} → ${fmt(xr.max, 3)}`, padL, H - 14);
    ctx.save();
    ctx.translate(16, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${axisLabel(yVar)}: ${fmt(yr.min, 3)} → ${fmt(yr.max, 3)}`, 0, 0);
    ctx.restore();
    ctx.fillText(`${zKey}: [${fmt(zmin, 4)}, ${fmt(zmax, 4)}]`, padL, 16);
    document.getElementById('hFoot').textContent =
      `Z = ${zKey} from analytical BSM. Dark cells are outside the selected moneyness window. Current type = ${p.type}.`;
  }

  function renderSurface() {
    const p = currentParams();
    const canvas = document.getElementById('surfaceCanvas');
    const ctx = canvas.getContext('2d');
    const xVar = document.getElementById('sX').value;
    const yVar = document.getElementById('sY').value;
    const zKey = document.getElementById('sZ').value;
    if (xVar === yVar) {
      ctx.fillStyle = '#0b0e14';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#8b95a8';
      ctx.font = '14px sans-serif';
      ctx.fillText('Pick two different axes for X and Y.', 16, 28);
      return;
    }
    const n = 28;
    const xr = defaultAxisRange(xVar, p);
    const yr = defaultAxisRange(yVar, p);
    const d = displayOpts();
    const Z = [];
    let zmin = Infinity, zmax = -Infinity;
    for (let j = 0; j < n; j++) {
      Z[j] = [];
      const yv = yr.min + (yr.max - yr.min) * j / (n - 1);
      for (let i = 0; i < n; i++) {
        const xv = xr.min + (xr.max - xr.min) * i / (n - 1);
        let pr = applyXValue(p, xVar, xv, 'K');
        pr = applyXValue(pr, yVar, yv, 'K');
        const z = metricFromRes(calculateBSM(pr), zKey, d);
        Z[j][i] = Number.isFinite(z) ? z : 0;
        if (Number.isFinite(z)) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
      }
    }
    if (zmax === zmin) zmax = zmin + 1;
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(0, 0, W, H);
    const project = (i, j, z) => {
      const x = i / (n - 1), y = j / (n - 1), zz = (z - zmin) / (zmax - zmin);
      const px = W * 0.15 + x * W * 0.7 + y * W * 0.15;
      const py = H * 0.75 - y * H * 0.45 - zz * H * 0.4 - x * H * 0.05;
      return [px, py];
    };
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const p00 = project(i, j, Z[j][i]);
        const p10 = project(i + 1, j, Z[j][i + 1]);
        const p01 = project(i, j + 1, Z[j + 1][i]);
        const p11 = project(i + 1, j + 1, Z[j + 1][i + 1]);
        const t = ((Z[j][i] + Z[j][i + 1] + Z[j + 1][i] + Z[j + 1][i + 1]) / 4 - zmin) / (zmax - zmin);
        ctx.beginPath();
        ctx.moveTo(p00[0], p00[1]);
        ctx.lineTo(p10[0], p10[1]);
        ctx.lineTo(p11[0], p11[1]);
        ctx.lineTo(p01[0], p01[1]);
        ctx.closePath();
        ctx.fillStyle = heatColor(t);
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#8b95a8';
    ctx.font = '12px sans-serif';
    ctx.fillText(`Z=${zKey}  X=${axisLabel(xVar)}  Y=${axisLabel(yVar)}  [${fmt(zmin, 4)}, ${fmt(zmax, 4)}]`, 16, 20);
  }

  function parseLevels(text, fam) {
    const raw = text.split(/[,\s]+/).map(Number).filter(Number.isFinite);
    if (raw.length) {
      return raw.map(v => {
        if (fam === 'sigma' || fam === 'T') return clampPositive(v, fam === 'T' ? CONFIG.EPS_T : CONFIG.EPS_SIGMA);
        if (fam === 'K') return clampPositive(v, 1e-8);
        return v;
      });
    }
    const p = currentParams();
    if (fam === 'T') return [7 / 365, 30 / 365, 90 / 365, 1];
    if (fam === 'sigma') return [0.10, 0.20, 0.35, 0.55];
    if (fam === 'r') return [0, 0.03, 0.05, 0.10];
    if (fam === 'q') return [0, 0.02, 0.04, 0.08];
    if (fam === 'K') return [p.S * 0.8, p.S * 0.9, p.S, p.S * 1.1, p.S * 1.2];
    return [p[fam]];
  }

  function renderFamilies() {
    const p = currentParams();
    issuesBox();
    const xKey = document.getElementById('fX').value;
    const yKey = document.getElementById('fY').value;
    const fam = document.getElementById('fFam').value;
    const both = document.getElementById('fBothTypes').checked;
    const types = both ? ['call', 'put'] : [p.type];
    const levels = fam === 'none' ? [null] : parseLevels(document.getElementById('fLevels').value, fam);
    const datasets = [];
    const palette = ['#3d9cf0', '#22c55e', '#f59e0b', '#a78bfa', '#ef4444', '#2dd4bf', '#f472b6', '#fb923c'];
    let pi = 0;
    const notes = [];
    for (const typ of types) {
      for (const lv of levels) {
        const pr = { ...p, type: typ };
        if (fam !== 'none' && lv != null) pr[fam] = lv;
        const sw = sweep(pr, xKey, [yKey], { pts: 101 });
        const label = fam === 'none'
          ? typ
          : `${typ} · ${fam}=${fmt(lv, 3)}`;
        datasets.push({
          label,
          data: sw.xs.map((x, i) => ({ x, y: sw.series[yKey][i] })),
          showLine: true, pointRadius: 0, borderWidth: 1.8,
          borderColor: palette[pi % palette.length],
          backgroundColor: palette[pi % palette.length],
          borderDash: typ === 'put' ? [5, 3] : []
        });
        pi++;
      }
    }
    document.getElementById('fTitle').textContent =
      `${yKey} vs ${axisLabel(xKey)}` + (fam !== 'none' ? ` · family ${fam}` : '') + (both ? ' · call solid / put dashed' : '');
    lineChart(document.getElementById('fChart'), datasets, axisLabel(xKey), yKey, 'family');
    const base = sweep({ ...p }, xKey, [yKey], { pts: 101 });
    const an = analyzeSeries(base.xs, base.series[yKey], xKey, yKey, p);
    if (both) notes.push('Put-call: same gamma/vega/vomma under European BSM; price/delta/theta/rho differ. Dashed = put.');
    if (fam === 'T') notes.push('Shorter T typically sharpens the ATM gamma/vega peak and steepens delta through ATM.');
    if (fam === 'sigma') notes.push('Higher vol fattens wings (more time value OTM) and can flatten delta through ATM.');
    document.getElementById('fAnalysis').innerHTML = analysisHTML(an, xKey, yKey, notes);
    State.lastFamily = { xKey, yKey, datasets };
  }

  function relationshipConfidence(repParams, variable, greek) {
    const signs = [];
    for (let i = 0; i < 5; i++) {
      const t = i / 4;
      const pr = { ...repParams };
      pr.sigma = clampPositive(repParams.sigma * (0.7 + 0.6 * t), CONFIG.EPS_SIGMA);
      pr.T = clampPositive(repParams.T * (0.5 + t), CONFIG.EPS_T);
      const h = stepSize(pr, variable) * 8;
      const s = sensitivity(pr, variable, greek, h, displayOpts());
      const d = classifyDirection(s.change, s.baseVal);
      if (d.arrow === '↑') signs.push(1);
      else if (d.arrow === '↓') signs.push(-1);
      else signs.push(0);
    }
    const nz = signs.filter(x => x !== 0);
    if (!nz.length) return { arrow: '→', confidence: 'Typical', cls: 'arrow-flat' };
    if (nz.every(x => x > 0)) return { arrow: '↑', confidence: nz.length === signs.length ? 'Universal' : 'Typical', cls: 'arrow-up' };
    if (nz.every(x => x < 0)) return { arrow: '↓', confidence: nz.length === signs.length ? 'Universal' : 'Typical', cls: 'arrow-down' };
    return { arrow: '±', confidence: 'Conditional', cls: 'arrow-cond' };
  }

  function bumpFor(p, v) {
    if (v === 'S') return p.S * 0.01;
    if (v === 'K') return p.K * 0.01;
    if (v === 'sigma') return 0.01;
    if (v === 'T') return Math.max(p.T * 0.05, 1 / State.dayCount);
    return 0.01;
  }

  function renderMatrix() {
    const base = currentParams();
    issuesBox();
    const v = document.getElementById('mInput').value;
    const greeks = CONFIG.GREEKS;
    let html = `<table class="matrix"><thead><tr><th class="sticky">Regime</th>${greeks.map(g => `<th>${g}</th>`).join('')}</tr></thead><tbody>`;
    const store = [];
    const regimes = [{ id: 'overall', label: 'Overall', params: base }].concat(
      CONFIG.REGIMES.map(r => ({ id: r.id, label: r.label, params: { ...base, K: representativeParams(r.id, base.type, base).K } }))
    );
    for (const rg of regimes) {
      html += `<tr><td class="sticky">${rg.label}</td>`;
      for (const g of greeks) {
        const h = bumpFor(rg.params, v);
        const s = sensitivity(rg.params, v, g, h, displayOpts());
        let rel = classifyDirection(s.change, s.baseVal);
        const conf = relationshipConfidence(rg.params, v, g);
        if (conf.arrow === '±') rel = conf;
        else rel.confidence = conf.confidence;
        const idx = store.length;
        store.push({ rg, g, s, rel, v });
        html += `<td class="cell" data-i="${idx}"><span class="${rel.cls}">${rel.arrow}</span> <span class="muted">${s.change >= 0 ? '+' : ''}${fmt(s.change, 4)}</span></td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    const wrap = document.getElementById('mTable');
    wrap.innerHTML = html;
    wrap.querySelectorAll('td.cell').forEach(td => {
      td.addEventListener('click', () => {
        const rec = store[+td.dataset.i];
        document.getElementById('mDetail').innerHTML =
          `<p><strong>${rec.rg.label}</strong> · ∂${rec.g}/∂${rec.v} local bump.</p>
           <ul>
             <li>Baseline ${rec.g} = ${fmt(rec.s.baseVal, 6)}</li>
             <li>After ${rec.v} += ${fmt(rec.s.h, 6)} → ${fmt(rec.s.valUp, 6)}</li>
             <li>Δ = ${fmt(rec.s.change, 6)} · ${rec.rel.arrow} (${rec.rel.confidence || rec.rel.label})</li>
           </ul>
           <p class="footnote">Arrow uses a 1% (or 100bp / 5% of T) bump. Confidence probes neighbouring σ and T inside the same representative K.</p>`;
      });
    });
  }

  function showPage(id) {
    document.querySelectorAll('#mainTabs button').forEach(b => b.classList.toggle('active', b.dataset.page === id));
    document.querySelectorAll('.page').forEach(pg => pg.classList.toggle('active', pg.id === 'page-' + id));
    if (id === 'builder') renderBuilder();
    if (id === 'atlas') renderAtlas();
    if (id === 'regimes') renderRegimes();
    if (id === 'cross') renderCross();
    if (id === 'heat') { renderHeatmap(); renderSurface(); }
    if (id === 'compare') renderFamilies();
    if (id === 'matrix') renderMatrix();
  }

  function initControls() {
    fillSelect(document.getElementById('bX'), INPUT_AXES, 'S');
    fillSelect(document.getElementById('aY'), GREEK_METRICS, 'gamma');
    fillSelect(document.getElementById('aX'), DRIVER_AXES, 'S');
    fillSelect(document.getElementById('rX'), DRIVER_AXES, 'sigma');
    fillSelect(document.getElementById('rY'), GREEK_METRICS, 'gamma');
    fillSelect(document.getElementById('cDriver'), DRIVER_AXES, 'S');
    fillSelect(document.getElementById('cGX'), GREEK_METRICS, 'delta');
    fillSelect(document.getElementById('cGY'), GREEK_METRICS, 'gamma');
    fillSelect(document.getElementById('hX'), DRIVER_AXES, 'S');
    fillSelect(document.getElementById('hY'), DRIVER_AXES.filter(a => a.id !== 'S'), 'sigma');
    fillSelect(document.getElementById('hZ'), GREEK_METRICS, 'gamma');
    fillSelect(document.getElementById('sX'), DRIVER_AXES, 'S');
    fillSelect(document.getElementById('sY'), DRIVER_AXES.filter(a => a.id === 'sigma' || a.id === 'T'), 'sigma');
    fillSelect(document.getElementById('sZ'), GREEK_METRICS, 'gamma');
    fillSelect(document.getElementById('fX'), DRIVER_AXES, 'S');
    fillSelect(document.getElementById('fY'), GREEK_METRICS, 'gamma');

    const hReg = document.getElementById('hRegime');
    hReg.innerHTML = `<option value="all" selected>All (overall)</option>` +
      CONFIG.REGIMES.map(r => `<option value="${r.id}">${r.label}</option>`).join('');

    document.getElementById('bYPicks').innerHTML = METRICS.map((m, i) => {
      const on = ['delta', 'gamma', 'vega', 'theta'].includes(m.id);
      return `<label class="chk"><input type="checkbox" value="${m.id}"${on ? ' checked' : ''}> ${m.label}</label>`;
    }).join('');

    document.getElementById('bRegimeChecks').innerHTML = CONFIG.REGIMES.map(r =>
      `<label class="chk"><input type="checkbox" value="${r.id}" checked> ${r.short}</label>`
    ).join('');

    const r = defaultAxisRange('S', CONFIG.DEFAULT);
    document.getElementById('bMin').value = r.min;
    document.getElementById('bMax').value = r.max;
  }

  function bind() {
    document.getElementById('optTypeSeg').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      State.params.type = b.dataset.type;
      writeParams();
      schedule();
    });
    document.getElementById('btnApply').addEventListener('click', () => showPage(document.querySelector('#mainTabs button.active').dataset.page));
    document.getElementById('btnReset').addEventListener('click', () => {
      State.params = { ...CONFIG.DEFAULT };
      writeParams();
      schedule();
    });
    document.getElementById('paramsBar').addEventListener('change', schedule);
    document.getElementById('paramsBar').addEventListener('input', () => {
      clearTimeout(State.debounce);
      State.debounce = setTimeout(schedule, 180);
    });

    document.getElementById('mainTabs').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      showPage(b.dataset.page);
    });

    document.getElementById('bX').addEventListener('change', () => {
      const p = currentParams();
      const r = defaultAxisRange(document.getElementById('bX').value, p);
      document.getElementById('bMin').value = +r.min.toFixed(6);
      document.getElementById('bMax').value = +r.max.toFixed(6);
    });
    document.getElementById('bResetRange').addEventListener('click', () => {
      const p = currentParams();
      const r = defaultAxisRange(document.getElementById('bX').value, p);
      document.getElementById('bMin').value = +r.min.toFixed(6);
      document.getElementById('bMax').value = +r.max.toFixed(6);
      renderBuilder();
    });
    function setYPicks(pred) {
      document.querySelectorAll('#bYPicks input').forEach(i => { i.checked = pred(i.value); });
    }
    document.getElementById('yPrimary').addEventListener('click', () => {
      setYPicks(v => PRIMARY_METRICS.includes(v) && v !== 'price');
      renderBuilder();
    });
    document.getElementById('yAllGreeks').addEventListener('click', () => {
      setYPicks(v => CONFIG.GREEKS.includes(v));
      renderBuilder();
    });
    document.getElementById('yNone').addEventListener('click', () => setYPicks(() => false));
    document.getElementById('bRender').addEventListener('click', renderBuilder);
    document.getElementById('bExportCsv').addEventListener('click', exportBuilderCsv);
    document.getElementById('bExportPng').addEventListener('click', () => exportPng('builder', 'bsm-custom-plot.png'));
    document.getElementById('aRender').addEventListener('click', renderAtlas);
    document.getElementById('rRender').addEventListener('click', renderRegimes);
    document.getElementById('cRender').addEventListener('click', renderCross);
    document.getElementById('cGallery').addEventListener('click', renderCrossGallery);
    document.getElementById('hRender').addEventListener('click', renderHeatmap);
    document.getElementById('sRender').addEventListener('click', renderSurface);
    document.getElementById('fRender').addEventListener('click', renderFamilies);
    document.getElementById('fFam').addEventListener('change', () => {
      const fam = document.getElementById('fFam').value;
      const el = document.getElementById('fLevels');
      if (fam === 'T') el.value = '0.02, 0.08, 0.25, 1.00';
      if (fam === 'sigma') el.value = '0.10, 0.20, 0.35, 0.55';
      if (fam === 'r') el.value = '0, 0.03, 0.05, 0.10';
      if (fam === 'q') el.value = '0, 0.02, 0.04, 0.08';
      if (fam === 'K') el.value = '80, 90, 100, 110, 120';
    });
    document.getElementById('mRender').addEventListener('click', renderMatrix);
  }

  function schedule() {
    const id = document.querySelector('#mainTabs button.active').dataset.page;
    issuesBox();
    document.getElementById('bSnapshot').innerHTML = snapshotHTML();
    if (id === 'builder') renderBuilder();
    else showPage(id);
  }

  function boot() {
    if (!window.BSM) {
      document.getElementById('modelStatus').textContent = 'Engine failed to load';
      return;
    }
    initControls();
    bind();
    writeParams();
    issuesBox();
    renderBuilder();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
