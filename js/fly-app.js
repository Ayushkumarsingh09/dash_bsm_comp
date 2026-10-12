(function () {
  const F = window.FLY;
  const history = F.getHistory();
  let state = F.linkToFinal(F.defaultState(), history);
  let chartId = 'smile';
  let timer = null;
  const scenarios = loadScenarios();

  const CHARTS = [
    ['smile', '1 IV vs strike'],
    ['delta', '2 IV vs delta'],
    ['flyK', '3 Fly vs strike'],
    ['flyD', '4 Fly vs delta'],
    ['width', '5 Fly vs width'],
    ['price', '6 Price fly'],
    ['payoff', '7 Payoff / P&L'],
    ['greeks', '8 Greeks'],
    ['heat', '9 Heatmap'],
    ['hist', '10 History'],
    ['attr', 'Attribution']
  ];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function num(id) {
    const el = document.getElementById(id);
    return el ? parseFloat(el.value) : NaN;
  }
  function setNum(id, v, d) {
    const el = document.getElementById(id);
    if (!el || document.activeElement === el) return;
    if (!Number.isFinite(v)) { el.value = ''; return; }
    el.value = d == null ? String(v) : v.toFixed(d);
    const range = document.getElementById(id + 'R');
    if (range && document.activeElement !== range) range.value = el.value;
  }
  function loadScenarios() {
    try { return JSON.parse(localStorage.getItem('spx-fly-scenarios-v1') || '[]'); }
    catch (e) { return []; }
  }
  function saveScenarios() {
    localStorage.setItem('spx-fly-scenarios-v1', JSON.stringify(scenarios.slice(-24)));
  }

  function read() {
    const s = state;
    const z = F.zeroShocks();
    s.S = num('S');
    s.r = num('rPct') / 100;
    s.q = num('qPct') / 100;
    s.days = num('days');
    s.dayCount = parseInt(document.getElementById('dayCount').value, 10);
    s.atm = num('atmPct') / 100;
    s.putSkew = F.units.putFromPts(num('put10'));
    s.callSkew = F.units.putFromPts(num('call10'));
    s.curvature = F.units.curvFromPts(num('curv10'));
    s.asymmetry = F.units.asymFromPts(num('asym10'));
    s.wingSteepness = F.units.wingFromPts(num('wing10'));
    s.bump = num('bumpPts') / 100;
    s.bumpK = num('bumpK');
    s.centerMode = document.getElementById('centerMode').value;
    s.centerK = num('centerK');
    s.centerDelta = num('centerDelta');
    s.centerSide = document.getElementById('centerSide').value;
    s.wingMode = document.getElementById('wingMode').value;
    s.wingStrike = num('wingStrike');
    s.wingAsym = num('wingAsym');
    s.wingLog = num('wingLog');
    s.wingDelta = num('wingDelta');
    s.deltaConv = document.getElementById('deltaConv').value;
    s.flyQuote = document.getElementById('flyQuote').value;
    s.priceConvention = document.getElementById('priceConvention').value;
    s.strategy = document.getElementById('strategy').value;
    s.tradeQty = num('tradeQty');
    s.multiplier = num('multiplier');
    s.spreadFrac = num('spreadPct') / 100;
    s.slippagePts = num('slippage');
    s.feePerContract = num('fee');
    const entry = document.getElementById('entryPremium').value;
    s.entryPremium = entry === '' ? null : parseFloat(entry);
    s.sticky = document.getElementById('sticky').value;
    z.dS = num('dS') / 100;
    z.dAtm = num('dAtm') / 100;
    z.dPut = F.units.putFromPts(num('dPut'));
    z.dCall = F.units.putFromPts(num('dCall'));
    z.dCurv = F.units.curvFromPts(num('dCurv'));
    z.dWing = F.units.wingFromPts(num('dWing'));
    z.dDays = num('dDays');
    z.dr = num('drBps') / 10000;
    z.dq = num('dqBps') / 10000;
    z.dWingStrike = num('dWidthStrike');
    z.dWingLog = num('dWidthLog');
    z.dWingDelta = num('dWidthDelta');
    z.dCenterDelta = num('dCenterDelta');
    z.dCost = num('dCost');
    s.shocks = z;
    s.heatmap = {
      x: document.getElementById('heatX').value,
      y: document.getElementById('heatY').value,
      metric: document.getElementById('heatM').value,
      n: 13
    };
    F.ensureT(s);
  }

  function write() {
    const s = state;
    setNum('S', s.S, 2);
    setNum('rPct', s.r * 100, 3);
    setNum('qPct', s.q * 100, 3);
    setNum('days', s.days, 1);
    document.getElementById('dayCount').value = String(s.dayCount);
    setNum('atmPct', s.atm * 100, 2);
    setNum('put10', F.units.ptsFromPut(s.putSkew), 2);
    setNum('call10', F.units.ptsFromPut(s.callSkew), 2);
    setNum('curv10', F.units.ptsFromCurv(s.curvature), 2);
    setNum('asym10', F.units.ptsFromAsym(s.asymmetry), 2);
    setNum('wing10', F.units.ptsFromWing(s.wingSteepness), 2);
    setNum('bumpPts', s.bump * 100, 2);
    setNum('bumpK', s.bumpK, 3);
    document.getElementById('centerMode').value = s.centerMode;
    setNum('centerK', s.centerK, 2);
    setNum('centerDelta', s.centerDelta, 3);
    document.getElementById('centerSide').value = s.centerSide;
    document.getElementById('wingMode').value = s.wingMode;
    setNum('wingStrike', s.wingStrike, 2);
    setNum('wingAsym', s.wingAsym, 2);
    setNum('wingLog', s.wingLog, 4);
    setNum('wingDelta', s.wingDelta, 3);
    document.getElementById('deltaConv').value = s.deltaConv;
    document.getElementById('flyQuote').value = s.flyQuote;
    document.getElementById('priceConvention').value = s.priceConvention;
    document.getElementById('strategy').value = s.strategy;
    setNum('tradeQty', s.tradeQty, 2);
    setNum('multiplier', s.multiplier, 0);
    setNum('spreadPct', s.spreadFrac * 100, 2);
    setNum('slippage', s.slippagePts, 3);
    setNum('fee', s.feePerContract, 3);
    const entry = document.getElementById('entryPremium');
    if (document.activeElement !== entry) entry.value = s.entryPremium == null ? '' : s.entryPremium;
    document.getElementById('sticky').value = s.sticky;
    const z = s.shocks;
    setNum('dS', z.dS * 100, 2);
    setNum('dAtm', z.dAtm * 100, 2);
    setNum('dPut', F.units.ptsFromPut(z.dPut), 2);
    setNum('dCall', F.units.ptsFromPut(z.dCall), 2);
    setNum('dCurv', F.units.ptsFromCurv(z.dCurv), 2);
    setNum('dWing', F.units.ptsFromWing(z.dWing), 2);
    setNum('dDays', z.dDays, 1);
    setNum('drBps', z.dr * 10000, 2);
    setNum('dqBps', z.dq * 10000, 2);
    setNum('dWidthStrike', z.dWingStrike, 2);
    setNum('dWidthLog', z.dWingLog, 4);
    setNum('dWidthDelta', z.dWingDelta, 3);
    setNum('dCenterDelta', z.dCenterDelta, 3);
    setNum('dCost', z.dCost, 3);
    document.getElementById('heatX').value = s.heatmap.x;
    document.getElementById('heatY').value = s.heatmap.y;
    document.getElementById('heatM').value = s.heatmap.metric;
  }

  function field(id, label, attrs) {
    const range = attrs.range ? '<input type="range" id="' + id + 'R" min="' + attrs.min + '" max="' + attrs.max + '" step="' + attrs.step + '" />' : '';
    return '<div class="field"><label>' + label + '</label><div class="pair">' + range +
      '<input type="number" id="' + id + '" step="' + attrs.step + '" /></div></div>';
  }
  function sel(id, label, options) {
    return '<div class="field"><label>' + label + '</label><select id="' + id + '">' +
      options.map((o) => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select></div>';
  }

  function buildControls() {
    document.getElementById('controls').innerHTML = [
      '<h3>Market — assumptions vs the synthetic book</h3>',
      '<p class="muted">Yellow-free numbers are assumptions. Reset to market reloads the final synthetic 60-DTE session. Editing a smile coefficient drops the stored quote grid and uses the parametric generator.</p>',
      field('S', 'SPX spot', { min: 3500, max: 7500, step: 1, range: true }),
      '<div class="grid2">',
      field('rPct', 'Rate %', { min: -1, max: 10, step: 0.01, range: true }),
      field('qPct', 'Dividend %', { min: 0, max: 6, step: 0.01, range: true }),
      field('days', 'Days to expiry', { min: 5, max: 365, step: 1, range: true }),
      sel('dayCount', 'Day count', [['365', 'ACT/365'], ['252', 'ACT/252']]),
      '</div>',
      '<p class="muted">The historical study stays on ACT/365, 60 calendar DTE, even if live pricing uses ACT/252.</p>',
      field('atmPct', 'ATM IV (vol points)', { min: 5, max: 80, step: 0.1, range: true }),
      field('put10', 'Put skew, vol pts at k=−0.10', { min: -5, max: 25, step: 0.1, range: true }),
      field('call10', 'Call skew, vol pts at k=+0.10', { min: -5, max: 20, step: 0.1, range: true }),
      field('curv10', 'Curvature, vol pts at |k|=0.10', { min: -5, max: 12, step: 0.1, range: true }),
      field('asym10', 'Asymmetry, vol pts at k=+0.10', { min: -8, max: 8, step: 0.1, range: true }),
      field('wing10', 'Wing steepness, vol pts at |k|=0.10', { min: 0, max: 10, step: 0.1, range: true }),
      '<div class="grid2">',
      field('bumpPts', 'Local bump (vol pts)', { min: -3, max: 3, step: 0.05, range: true }),
      field('bumpK', 'Bump center k', { min: -0.2, max: 0.2, step: 0.01, range: true }),
      '</div>',
      '<h3>Fly construction</h3>',
      sel('centerMode', 'Center', [['strike', 'Absolute strike'], ['delta', 'Delta']]),
      field('centerK', 'Center strike', { min: 2000, max: 9000, step: 1, range: true }),
      '<div class="grid2">',
      field('centerDelta', 'Center |delta|', { min: 0.05, max: 0.95, step: 0.01, range: true }),
      sel('centerSide', 'Center side', [['call', 'Call'], ['put', 'Put']]),
      '</div>',
      sel('wingMode', 'Wings', [['log', 'Fixed log-moneyness'], ['strike', 'Fixed strike distance'], ['delta', 'Fixed delta (25Δ-style)']]),
      field('wingStrike', 'Strike wing (points)', { min: 10, max: 500, step: 1, range: true }),
      field('wingAsym', 'Strike asymmetry (+ upper)', { min: -80, max: 80, step: 1, range: true }),
      field('wingLog', 'Log wing', { min: 0.01, max: 0.2, step: 0.005, range: true }),
      field('wingDelta', 'Wing |delta|', { min: 0.05, max: 0.45, step: 0.01, range: true }),
      sel('deltaConv', 'Delta convention', [['forward', 'Forward delta'], ['spot', 'Spot delta'], ['premium', 'Premium-adjusted spot']]),
      sel('flyQuote', 'Highlighted IV-fly definition', [
        ['raw', 'Raw fly on the selected wings'],
        ['atm', 'ATM-relative, user wing delta'],
        ['d25', '25Δ butterfly vs ATM'],
        ['dn', 'Forward-delta quoted butterfly']
      ]),
      '<p class="muted">An IV fly is curvature of the smile, in volatility. It is not the debit of a three-leg option position.</p>',
      '<h3>Tradable package</h3>',
      sel('strategy', 'Strategy', [
        ['long_call', 'Long call fly +1/−2/+1'],
        ['short_call', 'Short call fly'],
        ['long_put', 'Long put fly'],
        ['short_put', 'Short put fly'],
        ['broken_call', 'Broken-wing call (1.6× / 0.7×)'],
        ['dn_call', 'Delta-neutral call (body qty solved)'],
        ['dn_put', 'Delta-neutral put']
      ]),
      sel('priceConvention', 'Price-fly weights', [
        ['normalized', '0.5 / −1 / 0.5'],
        ['unnormalized', '1 / −2 / 1'],
        ['custom', 'Custom weights below']
      ]),
      '<div class="grid2">',
      field('tradeQty', 'Trade quantity', { min: 1, max: 100, step: 1, range: true }),
      field('multiplier', 'Multiplier', { min: 1, max: 100, step: 1, range: false }),
      field('spreadPct', 'Half-spread % of premium', { min: 0, max: 10, step: 0.1, range: true }),
      field('slippage', 'Slippage (points)', { min: 0, max: 2, step: 0.01, range: true }),
      field('fee', 'Fee $ / contract', { min: 0, max: 5, step: 0.05, range: true }),
      '</div>',
      '<div class="field"><label>Entry premium (points, blank = baseline mid)</label><input type="number" id="entryPremium" step="0.01" /></div>',
      sel('sticky', 'Smile when spot moves', [['moneyness', 'Sticky log-moneyness'], ['strike', 'Sticky strike']]),
      '<h3>Scenario shocks</h3>',
      '<p class="muted">Independent shocks are experiments. They are not a claim that spot, skew, and curvature move separately in the market. Preset K uses a realized historical day.</p>',
      field('dS', 'Spot shock %', { min: -20, max: 20, step: 0.1, range: true }),
      field('dAtm', 'ATM shock (vol pts)', { min: -10, max: 15, step: 0.1, range: true }),
      field('dPut', 'Put-skew shock (pts at 0.10)', { min: -8, max: 8, step: 0.1, range: true }),
      field('dCall', 'Call-skew shock (pts at 0.10)', { min: -8, max: 8, step: 0.1, range: true }),
      field('dCurv', 'Curvature shock (pts at 0.10)', { min: -4, max: 4, step: 0.1, range: true }),
      field('dWing', 'Wing shock (pts at 0.10)', { min: -3, max: 3, step: 0.1, range: true }),
      field('dDays', 'Time shock (days)', { min: -40, max: 40, step: 1, range: true }),
      field('drBps', 'Rate shock (bp)', { min: -100, max: 100, step: 1, range: true }),
      field('dqBps', 'Dividend shock (bp)', { min: -50, max: 50, step: 1, range: true }),
      field('dWidthStrike', 'Strike-width shock', { min: -50, max: 50, step: 1, range: true }),
      field('dWidthLog', 'Log-width shock', { min: -0.05, max: 0.05, step: 0.005, range: true }),
      field('dWidthDelta', 'Delta-width shock', { min: -0.1, max: 0.1, step: 0.01, range: true }),
      field('dCenterDelta', 'Center-delta shock', { min: -0.2, max: 0.2, step: 0.01, range: true }),
      field('dCost', 'Extra slippage (points)', { min: 0, max: 1, step: 0.01, range: true }),
      '<div class="row" id="presetRow"></div>',
      '<div class="row" style="margin-top:8px;">',
      '<button class="btn sm" id="resetMkt" type="button">Reset to market</button>',
      '<button class="btn sm" id="resetBase" type="button">Reset shocks</button>',
      '<button class="btn sm primary" id="saveSc" type="button">Save scenario</button>',
      '</div>',
      '<div class="field" style="margin-top:8px;"><label>Scenario name</label><input type="text" id="scName" value="Case 1" /></div>',
      '<h3>Heatmap axes</h3>',
      sel('heatX', 'X', [['S', 'Spot'], ['atm', 'ATM IV'], ['putSkew', 'Put skew'], ['curvature', 'Curvature'], ['width', 'Log wing'], ['days', 'DTE'], ['centerDelta', 'Center delta']]),
      sel('heatY', 'Y', [['atm', 'ATM IV'], ['S', 'Spot'], ['putSkew', 'Put skew'], ['curvature', 'Curvature'], ['width', 'Log wing'], ['days', 'DTE']]),
      sel('heatM', 'Color', [['ivFly', 'IV fly'], ['priceFly', 'Price fly'], ['premium', 'Package premium'], ['pnl', 'Mark P&L vs entry'], ['delta', 'Delta'], ['gamma', 'Gamma'], ['vega', 'Vega']])
    ].join('');

    document.querySelectorAll('#controls input[type=range]').forEach((range) => {
      const id = range.id.slice(0, -1);
      const numEl = document.getElementById(id);
      range.addEventListener('input', () => {
        numEl.value = range.value;
        onEdit(id);
      });
    });
    document.querySelectorAll('#controls input, #controls select').forEach((el) => {
      el.addEventListener('input', () => {
        const range = document.getElementById(el.id + 'R');
        if (range && el.type === 'number') range.value = el.value;
        onEdit(el.id);
      });
      el.addEventListener('change', () => onEdit(el.id));
    });
    document.getElementById('presetRow').innerHTML = F.presets(history).map((p) =>
      '<button class="btn sm" type="button" data-preset="' + p.id + '">' + esc(p.id) + '</button>'
    ).join('');
    document.getElementById('presetRow').addEventListener('click', (ev) => {
      const id = ev.target.getAttribute('data-preset');
      if (!id) return;
      const p = F.presets(history).find((x) => x.id === id);
      if (!p || !p.shocks) return;
      state.shocks = p.shocks;
      write();
      schedule();
    });
    document.getElementById('resetMkt').onclick = () => {
      const keep = { wingMode: state.wingMode, strategy: state.strategy, deltaConv: state.deltaConv, sticky: state.sticky, tradeQty: state.tradeQty };
      state = F.linkToFinal(state, history);
      Object.assign(state, keep);
      state.quoteGrid = F.linkToFinal(F.defaultState(), history).quoteGrid;
      state.linkedToFinal = true;
      state.source = 'synthetic';
      write();
      schedule();
    };
    document.getElementById('resetBase').onclick = () => {
      state.shocks = F.zeroShocks();
      write();
      schedule();
    };
    document.getElementById('saveSc').onclick = () => {
      read();
      scenarios.push({ name: document.getElementById('scName').value || 'scenario', at: new Date().toISOString(), state: JSON.parse(JSON.stringify(state)) });
      saveScenarios();
      schedule();
    };
  }

  const smileFields = new Set(['atmPct', 'put10', 'call10', 'curv10', 'asym10', 'wing10', 'bumpPts', 'bumpK', 'days', 'dayCount']);
  function onEdit(id) {
    if (smileFields.has(id)) {
      state.quoteGrid = null;
      state.linkedToFinal = false;
      state.source = 'synthetic-override';
    } else if (id !== 'scName') {
      state.linkedToFinal = false;
    }
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 40);
  }

  function layout(title, yTitle, xTitle) {
    return {
      title: { text: title, font: { size: 13, color: '#e6edf7' }, x: 0 },
      paper_bgcolor: '#12161f', plot_bgcolor: '#0b0e14',
      font: { color: '#8b95a8', size: 11 },
      margin: { l: 64, r: 24, t: 36, b: 52 },
      legend: { orientation: 'h', y: 1.02, yanchor: 'bottom', x: 0 },
      hovermode: 'x unified',
      uirevision: chartId,
      xaxis: {
        title: xTitle, gridcolor: '#2a3344', zerolinecolor: '#3a4558',
        showspikes: true, spikemode: 'across', spikedash: 'dot', spikecolor: '#8b95a8',
        automargin: true
      },
      yaxis: {
        title: yTitle, gridcolor: '#2a3344', zerolinecolor: '#3a4558',
        showspikes: true, spikedash: 'dot', spikecolor: '#8b95a8',
        automargin: true, rangemode: 'normal'
      }
    };
  }
  function line(name, x, y, color, dash) {
    return { type: 'scatter', mode: 'lines', name, x, y, line: { color, width: 2, dash: dash || 'solid' }, hovertemplate: '%{x:.4g}<br>%{y:.4g}<extra>' + name + '</extra>' };
  }

  function finiteValues(arr) {
    const out = [];
    if (!arr) return out;
    for (let i = 0; i < arr.length; i++) if (typeof arr[i] === 'number' && Number.isFinite(arr[i])) out.push(arr[i]);
    return out;
  }
  function paddedRange(vals, padFrac, pinZero) {
    if (!vals.length) return null;
    let lo = Math.min.apply(null, vals);
    let hi = Math.max.apply(null, vals);
    if (pinZero) lo = Math.min(0, lo);
    if (lo === hi) { lo -= Math.abs(lo) * 0.05 || 1; hi += Math.abs(hi) * 0.05 || 1; }
    const pad = (hi - lo) * padFrac;
    return [lo - (pinZero && lo === 0 ? 0 : pad), hi + pad];
  }
  function chartHeight() {
    const el = document.getElementById('chart');
    const top = el.getBoundingClientRect().top;
    const note = document.getElementById('chartNote');
    const noteH = note ? note.offsetHeight + 8 : 28;
    return Math.max(640, Math.round(window.innerHeight - top - noteH - 16));
  }
  function draw(traces, lay, note, csvRows) {
    document.getElementById('chartNote').textContent = note || '';
    window.__csv = csvRows || [];
    const el = document.getElementById('chart');
    if (!window.Plotly) {
      el.innerHTML = '<p class="muted">Plotly failed to load. Series are still computed — use Export CSV.</p>';
      return;
    }
    const ys = [];
    const bars = traces.some((t) => t.type === 'bar');
    const heat = traces.some((t) => t.type === 'heatmap');
    if (!heat) {
      for (const t of traces) {
        if (t.yaxis === 'y2') continue;
        finiteValues(t.y).forEach((v) => ys.push(v));
      }
      const yRange = paddedRange(ys, 0.06, bars);
      if (yRange) {
        lay.yaxis.range = yRange;
        lay.yaxis.autorange = false;
      }
    }
    const h = chartHeight();
    el.style.height = h + 'px';
    lay.height = h;
    lay.uirevision = chartId;
    Plotly.react(el, traces, lay, {
      responsive: true,
      displaylogo: false,
      scrollZoom: true,
      doubleClick: 'reset',
      displayModeBar: true,
      modeBarButtonsToRemove: ['lasso2d', 'select2d'],
      toImageButtonOptions: { format: 'png', filename: 'spx-fly', scale: 2 }
    });
  }
  function plotEl() { return document.getElementById('chart'); }
  function currentRanges() {
    const gd = plotEl();
    const fl = gd && gd._fullLayout;
    if (!fl || !fl.xaxis || !fl.yaxis) return null;
    return { x: fl.xaxis.range.slice(), y: fl.yaxis.range.slice() };
  }
  function scalePair(a, b, factor) {
    const na = typeof a === 'number' ? a : Date.parse(a);
    const nb = typeof b === 'number' ? b : Date.parse(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return [a, b];
    const mid = (na + nb) / 2;
    const half = Math.abs(nb - na) * factor / 2;
    const lo = mid - half;
    const hi = mid + half;
    if (typeof a === 'number' && typeof b === 'number') return [lo, hi];
    return [new Date(lo).toISOString().slice(0, 10), new Date(hi).toISOString().slice(0, 10)];
  }
  function zoomAxes(xFactor, yFactor) {
    const r = currentRanges();
    if (!r || !window.Plotly) return;
    const upd = {};
    if (xFactor) {
      upd['xaxis.range'] = scalePair(r.x[0], r.x[1], xFactor);
      upd['xaxis.autorange'] = false;
    }
    if (yFactor) {
      upd['yaxis.range'] = scalePair(r.y[0], r.y[1], yFactor);
      upd['yaxis.autorange'] = false;
    }
    Plotly.relayout(plotEl(), upd);
  }
  function setDrag(mode) {
    if (!window.Plotly) return;
    Plotly.relayout(plotEl(), { dragmode: mode });
    document.querySelectorAll('[data-drag]').forEach((btn) => btn.classList.toggle('on', btn.getAttribute('data-drag') === mode));
  }

  function selectedFly(view) {
    const q = view.quotes;
    if (state.flyQuote === 'd25') return q.d25;
    if (state.flyQuote === 'atm') return q.atm;
    if (state.flyQuote === 'dn') return q.dn;
    return q.raw;
  }

  function renderChart(view) {
    if (chartId === 'smile') {
      const s = F.smileSeries(state, history);
      const xs = s.rows.map((r) => r.K);
      const traces = [
        line('Scenario / market', xs, s.rows.map((r) => r.market * 100), '#e6edf7'),
        line('Baseline', xs, s.rows.map((r) => r.baseline * 100), '#8b95a8', 'dot'),
        line('Quadratic smooth (bump off)', xs, s.quadratic.map((v) => v * 100), '#2dd4bf', 'dash')
      ];
      if (s.svi.ok) traces.push(line('SVI fit', xs, s.rows.map((r) => s.svi.iv(r.k) * 100), '#f59e0b'));
      if (s.ssvi.ok) traces.push(line('SSVI fit', xs, s.rows.map((r) => s.ssvi.iv(r.k) * 100), '#a78bfa'));
      traces.push({
        type: 'scatter', mode: 'markers', name: 'Wings / center',
        x: [view.wings.Kl, view.wings.Kc, view.wings.Ku],
        y: [view.wings.ivL, view.wings.ivC, view.wings.ivU].map((v) => v * 100),
        marker: { size: 10, color: ['#7dd3fc', '#f59e0b', '#fca5a5'] }
      });
      draw(traces, layout('Implied volatility vs strike', 'IV (vol points)', 'Strike'),
        'Market in synthetic mode is the variance-interpolated 60-DTE grid when linked, otherwise the parametric generator. SVI/SSVI are fits, not prints. |k|>0.30 is outside the quoted grid.',
        xs.map((x, i) => [x, s.rows[i].market, s.rows[i].baseline]));
    } else if (chartId === 'delta') {
      const rows = F.deltaSmile(state);
      draw([
        line('OTM IV vs signed delta', rows.map((r) => r.delta), rows.map((r) => r.iv * 100), '#e6edf7')
      ], layout('Implied volatility vs ' + state.deltaConv + ' delta', 'IV (vol points)', 'Signed delta (put < 0 < call)'),
        'Puts use the put delta, calls the call delta, under the selected convention. 10/25/35/50 markers are solved on this smile.',
        rows.map((r) => [r.delta, r.iv, r.K]));
    } else if (chartId === 'flyK') {
      const rows = F.flySweepStrike(state, history).filter((r) => r.ordered);
      draw([
        line('Raw IV fly', rows.map((r) => r.K), rows.map((r) => r.fly * 100), '#3d9cf0'),
        line('Historical median', rows.map((r) => r.K), rows.map((r) => r.fair * 100), '#22c55e', 'dash'),
        line('SVI fly', rows.map((r) => r.K), rows.map((r) => r.svi * 100), '#f59e0b', 'dot'),
        line('Robust z', rows.map((r) => r.K), rows.map((r) => r.z), '#fca5a5')
      ], layout('IV fly vs center strike', 'Vol points (z on the right scale is unitless — read the hover)', 'Center strike'),
        'Wings follow the selected wing mode. Unordered centers are omitted. z uses the causal one-year sample at that center’s log-moneyness.',
        rows.map((r) => [r.K, r.fly, r.fair, r.z]));
    } else if (chartId === 'flyD') {
      const rows = F.flySweepDelta(state, history).filter((r) => r.ordered && Number.isFinite(r.fly));
      const puts = rows.filter((r) => r.side === 'put');
      const calls = rows.filter((r) => r.side === 'call');
      draw([
        line('Put-center fly', puts.map((r) => r.delta), puts.map((r) => r.fly * 100), '#7dd3fc'),
        line('Call-center fly', calls.map((r) => r.delta), calls.map((r) => r.fly * 100), '#fca5a5')
      ], layout('IV fly vs center delta', 'IV fly (vol points)', 'Signed center delta'),
        'Fixed-delta wings can cross the center; those points are dropped rather than redrawn.',
        rows.map((r) => [r.delta, r.fly, r.K]));
    } else if (chartId === 'width') {
      const rows = F.flySweepWidth(state).filter((r) => r.ordered);
      draw([
        line('Raw IV fly (vol pts)', rows.map((r) => r.width), rows.map((r) => r.fly * 100), '#3d9cf0'),
        line('Fly / Δk', rows.map((r) => r.width), rows.map((r) => r.flyPerK * 100), '#2dd4bf'),
        line('Price fly', rows.map((r) => r.width), rows.map((r) => r.price), '#f59e0b'),
        line('Smooth model fly (vol pts)', rows.map((r) => r.width), rows.map((r) => r.model * 100), '#a78bfa', 'dash')
      ], layout('Fly vs wing width', 'Mixed units — see legend', state.wingMode + ' width'),
        'Raw curvature, curvature per unit log-moneyness, and the option-price fly are different objects. They share an x-axis only.',
        rows.map((r) => [r.width, r.fly, r.price, r.model]));
    } else if (chartId === 'price') {
      const pack = F.priceFlySweep(state);
      const traces = ['fixed', 'shift', 'log', 'delta'].map((m, i) => line(
        m, pack.bySpot[m].map((r) => r.S), pack.bySpot[m].map((r) => r.price),
        ['#e6edf7', '#3d9cf0', '#2dd4bf', '#f59e0b'][i]
      ));
      traces.push(line('Vs center strike (top axis not shared)', pack.byCenter.map((r) => r.K), pack.byCenter.map((r) => r.price), '#fca5a5', 'dot'));
      draw(traces, layout('Option-price fly', 'Normalized price fly (index points)', 'Spot, or strike for the dotted curve'),
        pack.note + ' The dotted curve’s x-axis is center strike, not spot.',
        pack.bySpot.fixed.map((r, i) => [r.S, r.price, pack.bySpot.log[i].price, pack.bySpot.delta[i].price]));
    } else if (chartId === 'payoff') {
      const p = view.position;
      draw([
        line('Expiration P&L', p.spots.map((r) => r.S), p.spots.map((r) => r.expiry), '#e6edf7'),
        line('Mark-to-market P&L', p.spots.map((r) => r.S), p.spots.map((r) => r.mtm), '#3d9cf0')
      ], layout('Butterfly P&L (package × quantity)', 'P&L (index points)', 'Spot'),
        'Expiration P&L is intrinsic minus the entry debit. Mark-to-market reprices with the sticky rule. Breakevens: ' +
          p.breakevens.map((x) => x.toFixed(1)).join(', ') +
          '. Max profit ' + fmtInf(p.extrema.maxProfit) + ', max loss ' + fmtInf(p.extrema.maxLoss) + '.',
        p.spots.map((r) => [r.S, r.expiry, r.mtm]));
    } else if (chartId === 'greeks') {
      const g = F.greekSeries(state);
      const which = document.getElementById('greekName').value;
      draw([
        line('Package', g.vsSpot.map((r) => r.S), g.vsSpot.map((r) => r.sum[which]), '#e6edf7'),
        line('Lower', g.vsSpot.map((r) => r.S), g.vsSpot.map((r) => r.legs[0][which]), '#7dd3fc'),
        line('Body', g.vsSpot.map((r) => r.S), g.vsSpot.map((r) => r.legs[1][which]), '#f59e0b'),
        line('Upper', g.vsSpot.map((r) => r.S), g.vsSpot.map((r) => r.legs[2][which]), '#fca5a5')
      ], layout(which + ' vs spot, strikes held at the scenario wings', which, 'Spot'),
        'Analytical BSM Greeks hold each leg’s IV fixed. Smile delta in the table is the finite difference when IV is allowed to move with the sticky rule. Vega is per 1.00 vol; divide by 100 for one vol point. Theta is per year.',
        g.vsSpot.map((r) => [r.S, r.sum[which]]));
    } else if (chartId === 'heat') {
      const hmap = F.heatmap(state, state.heatmap.x, state.heatmap.y, state.heatmap.metric, 13);
      draw([{
        type: 'heatmap', x: hmap.x, y: hmap.y, z: hmap.z, colorscale: 'RdBu', reversescale: true, hovertemplate: 'x %{x:.4g}<br>y %{y:.4g}<br>%{z:.4g}<extra></extra>'
      }], layout(hmap.metric + ' heatmap', hmap.yLabel, hmap.xLabel), hmap.note, []);
    } else if (chartId === 'hist') {
      const hch = F.historyChart(state, history);
      draw([
        line('Daily fly (vol pts)', hch.dates, hch.fly.map((v) => v * 100), '#3d9cf0'),
        line('63-session median', hch.dates, hch.roll.map((v) => v * 100), '#22c55e'),
        line('Robust z', hch.dates, hch.z, '#f59e0b'),
        line('Next 5-session spot return', hch.dates, hch.outcome5d, '#fca5a5', 'dot')
      ], layout('One-year 60-DTE fly', 'Vol points, z, or return', 'Session'),
        hch.note + ' Sample size ' + hch.dates.length + '. Warm-up is excluded.',
        hch.dates.map((d, i) => [d, hch.fly[i], hch.z[i], hch.outcome5d[i]]));
    } else {
      const a = view.attribution;
      draw([
        { type: 'bar', name: 'OFAT', x: a.ofat.map((r) => r.factor), y: a.ofat.map((r) => r.delta), marker: { color: '#3d9cf0' } },
        { type: 'bar', name: 'Shapley', x: a.shapley.map((r) => r.factor), y: a.shapley.map((r) => r.value), marker: { color: '#2dd4bf' } }
      ], layout('Scenario attribution of the IV fly', 'Contribution (decimal vol)', 'Shock'),
        'OFAT ignores interactions (gap ' + F.fmt(a.ofatGap, 6) + '). Shapley sums to the total change (gap ' + F.fmt(a.shapleyGap, 8) + '). ' + a.note,
        a.ofat.map((r) => [r.factor, r.delta]));
    }
  }

  function fmtInf(v) {
    if (v === Infinity) return 'unbounded +';
    if (v === -Infinity) return 'unbounded −';
    return F.fmt(v, 2);
  }

  function render() {
  try {
    read();
    const view = F.view(state, history);
    const fly = selectedFly(view);
    const cls = view.scores.composite ? view.scores.composite.classification : 'insufficient';
    document.getElementById('pills').innerHTML = [
      ['Spot', F.fmt(view.work.S, 1)],
      ['ATM', (view.work.atm * 100).toFixed(2) + ' pts'],
      ['DTE', view.work.days.toFixed(0)],
      ['IV fly', Number.isFinite(fly) ? (fly * 100).toFixed(2) + ' pts' : '—'],
      ['Class', cls]
    ].map((p) => '<span class="pill">' + p[0] + ' <strong class="' + (p[0] === 'Class' ? cls : '') + '">' + esc(p[1]) + '</strong></span>').join('');
    document.getElementById('banner').textContent = view.label + ' Positive residual = expensive curvature. Cheap ≠ buy.';

    const sc = view.scores;
    const rail = [];
    rail.push('<h3>Valuation</h3>');
    rail.push('<div class="metric"><div class="k">Composite · ' + esc(cls) + '</div><div class="v ' + cls + '">' + F.fmt(sc.composite.z, 2) + ' z</div></div>');
    rail.push('<div class="metric"><div class="k">Raw IV fly</div><div class="v">' + (Number.isFinite(sc.yNow) ? (sc.yNow * 100).toFixed(2) : '—') + ' vol pts</div></div>');
    rail.push('<div class="metric"><div class="k">Ensemble fair</div><div class="v">' + (Number.isFinite(sc.composite.fair) ? (sc.composite.fair * 100).toFixed(2) : '—') + ' vol pts</div></div>');
    rail.push('<div class="metric"><div class="k">Causal percentile</div><div class="v">' + (Number.isFinite(sc.composite.percentile) ? (100 * sc.composite.percentile).toFixed(1) + '%' : '—') + '</div></div>');
    rail.push('<p class="muted">n = ' + sc.refN + ' causal sessions of ' + sc.sampleN + '. Warm-up excluded: ' + sc.warmupExcluded + '.</p>');
    if (sc.correlationWarning) rail.push('<p class="warn-line">' + esc(sc.correlationWarning) + '</p>');
    rail.push('<p class="muted">' + esc(sc.sign || '') + '</p>');
    rail.push('<h3>Quote board (not P&L)</h3>');
    rail.push('<table><tbody>' +
      [['Raw', view.quotes.raw], ['ATM-relative', view.quotes.atm], ['25Δ', view.quotes.d25], ['10Δ', view.quotes.d10], ['Fwd-delta quote', view.quotes.dn]].map((r) =>
        '<tr><td>' + r[0] + '</td><td>' + (Number.isFinite(r[1]) ? (r[1] * 100).toFixed(2) + ' pts' : '—') + '</td></tr>'
      ).join('') + '</tbody></table>');
    if (view.position) {
      rail.push('<h3>Package</h3>');
      rail.push('<p class="mono">Mid debit ' + F.fmt(view.position.mid, 2) + ' pts</p>');
      rail.push('<p class="mono">Executable ' + F.fmt(view.position.executable, 2) + ' pts</p>');
      rail.push('<p class="mono">Fees ' + F.fmt(view.position.fees, 3) + ' pts</p>');
      rail.push('<p class="muted">Theoretical mark P&L ' + F.fmt(view.position.theoreticalPnL, 2) + ' pts. After costs ' + F.fmt(view.position.executablePnL, 2) + ' pts. Dollars = points × ' + view.position.dollarsPerPoint + ' × quantity.</p>');
    }
    if (view.greeks) {
      rail.push('<h3>Greeks (1 package, IV frozen)</h3>');
      const g = view.greeks;
      rail.push('<p class="mono">Δ ' + F.fmt(g.sum.delta, 3) + ' · smile Δ ' + F.fmt(g.smileDelta, 3) + '</p>');
      rail.push('<p class="mono">Γ ' + F.fmt(g.sum.gamma, 5) + ' · 1% Γ P&L ' + F.fmt(g.gamma1pct, 3) + '</p>');
      rail.push('<p class="mono">Vega/pt ' + F.fmt(g.vegaPerPoint, 3) + ' · Θ/day ' + F.fmt(g.thetaPerDay, 3) + '</p>');
      rail.push('<p class="muted">FD − analytic Δ = ' + F.fmt(g.fdGap, 6) + '. ' + esc(g.units.vega) + '</p>');
    }
    view.wings.notes.forEach((n) => rail.push('<p class="warn-line">' + esc(n) + '</p>'));
    if (!view.arbitrage.ok) view.arbitrage.issues.forEach((n) => rail.push('<p class="warn-line">' + esc(n) + '</p>'));
    else rail.push('<p class="muted">No butterfly or calendar failure on the checked grid. SVI RMSE ' + (view.arbitrage.svi.rmseVolPts != null ? view.arbitrage.svi.rmseVolPts.toFixed(2) : '—') + ' vol pts.</p>');
    if (view.decomp) {
      rail.push('<h3>What moves this fly</h3>');
      rail.push('<table><tbody>' + view.decomp.components.slice(0, 7).map((c) =>
        '<tr><td>' + esc(c.name.split('.')[0]) + '</td><td>' + F.fmt(c.contributionPts, 2) + '</td></tr>'
      ).join('') + '</tbody></table>');
      rail.push('<p class="muted">' + esc(view.decomp.orderNote) + '</p>');
    }
    document.getElementById('rail').innerHTML = rail.join('');

    const rows = sc.methods || [];
    const legRows = (view.position && view.position.legs) ? view.position.legs : [];
    document.getElementById('bottom').innerHTML =
      '<div class="tabs" id="bottomTabs">' +
      '<button class="active" data-b="methods">15 scores</button><button data-b="legs">Legs</button><button data-b="attr">Interactions</button><button data-b="scen">Saved scenarios</button><button data-b="method">Methodology</button>' +
      '</div><div id="bottomBody"></div>';
    const body = document.getElementById('bottomBody');
    function showBottom(which) {
      if (which === 'legs') {
        body.innerHTML = '<div class="scroll"><table><thead><tr><th>Type</th><th>Strike</th><th>Qty</th><th>IV</th><th>Mid</th><th>Delta</th><th>Vega / pt</th></tr></thead><tbody>' +
          (view.greeks ? view.greeks.perLeg.map((r) => '<tr><td>' + r.type + '</td><td>' + r.K.toFixed(2) + '</td><td>' + F.fmt(r.qty, 3) + '</td><td>' + (r.iv * 100).toFixed(2) + '</td><td>' + F.fmt(r.price, 2) + '</td><td>' + F.fmt(r.delta, 3) + '</td><td>' + F.fmt(r.vega / 100, 3) + '</td></tr>').join('') : '') +
          '</tbody></table></div>';
      } else if (which === 'attr') {
        const pairs = view.attribution.pairs;
        body.innerHTML = '<p class="muted">Interaction(A,B) = f(A,B) − f(A) − f(B) + f(0), with 0 the unshocked baseline.</p><div class="scroll"><table><thead><tr><th>A</th><th>B</th><th>Interaction</th></tr></thead><tbody>' +
          pairs.map((p) => '<tr><td>' + p.a + '</td><td>' + p.b + '</td><td>' + F.fmt(p.interaction, 5) + '</td></tr>').join('') +
          '</tbody></table></div>';
      } else if (which === 'scen') {
        body.innerHTML = '<div class="scroll"><table><thead><tr><th>Name</th><th></th></tr></thead><tbody>' +
          scenarios.map((scen, i) => '<tr><td>' + esc(scen.name) + '</td><td><button class="btn sm" data-load="' + i + '">Load</button></td></tr>').join('') +
          '</tbody></table></div>';
        body.querySelectorAll('[data-load]').forEach((btn) => {
          btn.onclick = () => {
            state = scenarios[parseInt(btn.getAttribute('data-load'), 10)].state;
            write();
            render();
          };
        });
      } else if (which === 'method') {
        body.innerHTML = '<div class="muted" style="max-width:900px">' +
          '<p>σ(k) = atm + putSkew·max(−k,0) + callSkew·max(k,0) + ½·curvature·k² + asymmetry·k³ + wingSteepness·|k|³ + Gaussian bump. k = ln(K/F).</p>' +
          '<p>Raw fly = (IV lower + IV upper) / 2 − IV center, in decimal volatility. ×100 is vol points. The 25Δ butterfly uses a 25-forward-delta put, ATM, and a 25-forward-delta call. That quote is not the premium of +1/−2/+1.</p>' +
          '<p>Price fly, normalized = 0.5·P(K1) + 0.5·P(K3) − P(K2). Unnormalized = P(K1) − 2·P(K2) + P(K3).</p>' +
          '<p>The research sample is exactly 252 business days ending 2026-10-09, seed 20261012, target 60/365. Each smile is total-variance interpolation of 45-DTE and 75-DTE slices. Forty warm-up sessions feed realized vol and drawdown and are excluded from every score. At a linked final session the causal reference drops that session. Positive residual means expensive. Thresholds |z|=1 are labels, not tests. No method is a trading recommendation.</p>' +
          '<p>Quadratic residual near zero in synthetic mode is by construction once bump and interpolation are removed. Import a chain to compare a real smile. Imported rows never enter the synthetic history.</p></div>';
      } else {
        body.innerHTML = '<div class="scroll"><table><thead><tr><th>Method</th><th>Class</th><th>z</th><th>Percentile</th><th>Fair</th><th>Residual</th><th>n</th><th>Failure</th></tr></thead><tbody>' +
          rows.map((m) => '<tr><td>' + esc(m.name) + '</td><td class="' + m.classification + '">' + m.classification + '</td><td>' + F.fmt(m.z, 2) + '</td><td>' + (Number.isFinite(m.percentile) ? (100 * m.percentile).toFixed(1) + '%' : '—') + '</td><td>' + F.fmt(m.fair, 4) + '</td><td>' + F.fmt(m.residual, 4) + '</td><td>' + m.n + '</td><td>' + esc(m.failure || '') + '</td></tr>').join('') +
          '</tbody></table></div>';
      }
    }
    showBottom('methods');
    document.getElementById('bottomTabs').onclick = (ev) => {
      const b = ev.target.getAttribute('data-b');
      if (!b) return;
      document.querySelectorAll('#bottomTabs button').forEach((btn) => btn.classList.toggle('active', btn === ev.target));
      showBottom(b);
    };
    renderChart(view);
  } catch (err) {
    document.getElementById('chartNote').textContent = 'Calculation error: ' + err.message;
    console.error(err);
  }
  }

  function buildChartChrome() {
    document.getElementById('chartTabs').innerHTML = CHARTS.map((c) =>
      '<button type="button" data-c="' + c[0] + '"' + (c[0] === chartId ? ' class="active"' : '') + '>' + c[1] + '</button>'
    ).join('');
    document.getElementById('chartTabs').onclick = (ev) => {
      const id = ev.target.getAttribute('data-c');
      if (!id) return;
      chartId = id;
      document.querySelectorAll('#chartTabs button').forEach((b) => b.classList.toggle('active', b.getAttribute('data-c') === id));
      schedule();
    };
    document.getElementById('viewTools').innerHTML =
      '<button class="btn sm" type="button" id="zoomIn" title="Zoom in (+)">Zoom in</button>' +
      '<button class="btn sm" type="button" id="zoomOut" title="Zoom out (-)">Zoom out</button>' +
      '<button class="btn sm" type="button" id="zoomYIn" title="Taller y scale">Y+</button>' +
      '<button class="btn sm" type="button" id="zoomYOut" title="Shorter y scale">Y−</button>' +
      '<button class="btn sm" type="button" id="zoomXIn" title="Zoom x in">X+</button>' +
      '<button class="btn sm" type="button" id="zoomXOut" title="Zoom x out">X−</button>' +
      '<span class="sep"></span>' +
      '<button class="btn sm on" type="button" data-drag="zoom" title="Drag a box to zoom">Box zoom</button>' +
      '<button class="btn sm" type="button" data-drag="pan" title="Drag to pan">Pan</button>' +
      '<span class="sep"></span>' +
      '<button class="btn sm" type="button" id="fitView" title="Fit both axes to the data (0)">Fit</button>' +
      '<span class="hint">Scroll zooms · drag a box · double-click resets · + / − / 0</span>';
    document.getElementById('zoomIn').onclick = () => zoomAxes(0.8, 0.8);
    document.getElementById('zoomOut').onclick = () => zoomAxes(1.25, 1.25);
    document.getElementById('zoomYIn').onclick = () => zoomAxes(null, 0.72);
    document.getElementById('zoomYOut').onclick = () => zoomAxes(null, 1.4);
    document.getElementById('zoomXIn').onclick = () => zoomAxes(0.8, null);
    document.getElementById('zoomXOut').onclick = () => zoomAxes(1.25, null);
    document.getElementById('fitView').onclick = () => {
      if (window.Plotly) Plotly.relayout(plotEl(), { 'xaxis.autorange': true, 'yaxis.autorange': true });
    };
    document.getElementById('viewTools').addEventListener('click', (ev) => {
      const mode = ev.target.getAttribute && ev.target.getAttribute('data-drag');
      if (mode) setDrag(mode);
    });
    document.getElementById('chartTools').innerHTML =
      '<label class="muted">Greek <select id="greekName"><option>delta</option><option>gamma</option><option>vega</option><option>theta</option><option>rho</option><option>vanna</option><option>vomma</option><option>charm</option><option>color</option><option>speed</option></select></label>' +
      '<button class="btn sm" id="csvBtn" type="button">Export CSV</button>' +
      '<button class="btn sm" id="pngBtn" type="button">Export PNG</button>' +
      '<button class="btn sm" id="histCsv" type="button">Export history</button>' +
      '<button class="btn sm" id="chainCsv" type="button">Sample chain CSV</button>';
    document.getElementById('greekName').onchange = () => schedule();
    document.getElementById('csvBtn').onclick = () => download('fly-chart.csv', toCSV(window.__csv || []));
    document.getElementById('pngBtn').onclick = () => { if (window.Plotly) Plotly.downloadImage('chart', { format: 'png', filename: 'spx-fly' }); };
    document.getElementById('histCsv').onclick = () => {
      const h = F.historyChart(state, history);
      download('fly-history-synthetic.csv', toCSV([['source', 'SYNTHETIC']].concat(h.dates.map((d, i) => [d, h.fly[i], h.z[i], h.outcome5d[i]]))));
    };
    document.getElementById('chainCsv').onclick = () => download('synthetic-spx-60d-sample.csv', F.chainCSV(history));
    const imp = document.createElement('input');
    imp.type = 'file'; imp.accept = '.csv,text/csv';
    imp.style.display = 'none';
    const btn = document.createElement('button');
    btn.className = 'btn sm'; btn.type = 'button'; btn.textContent = 'Import chain';
    btn.onclick = () => imp.click();
    imp.onchange = () => {
      const file = imp.files && imp.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const applied = F.applyImport(state, F.parseCSV(String(reader.result)));
        if (!applied.ok) { alert(applied.error); return; }
        state = applied.state;
        write();
        render();
      };
      reader.readAsText(file);
    };
    document.getElementById('chartTools').appendChild(btn);
    document.getElementById('chartTools').appendChild(imp);
  }

  function toCSV(rows) {
    return rows.map((r) => r.map((c) => c == null ? '' : String(c)).join(',')).join('\n');
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name;
    a.click();
  }

  buildControls();
  buildChartChrome();
  write();
  render();
  window.addEventListener('resize', () => {
    const el = plotEl();
    if (!window.Plotly || !el || !el.data) return;
    const h = chartHeight();
    el.style.height = h + 'px';
    Plotly.relayout(el, { height: h });
  });
  document.addEventListener('keydown', (ev) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); zoomAxes(0.8, 0.8); }
    else if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); zoomAxes(1.25, 1.25); }
    else if (ev.key === '0') {
      ev.preventDefault();
      if (window.Plotly) Plotly.relayout(plotEl(), { 'xaxis.autorange': true, 'yaxis.autorange': true });
    }
  });
})();
