(function () {
  const F = window.FLY;
  let history = F.getHistory();
  let realHistory = null;
  let bookId = 'synthetic';
  let bookToken = 0;
  let compareSet = [];
  let bottomTab = 'methods';
  let dayBarKey = '';
  const DAY_COLORS = ['#f472b6', '#38bdf8', '#facc15', '#a3e635', '#fb7185', '#c4b5fd'];
  let state = F.linkToFinal(F.defaultState(), history);
  state.greekDials = F.zeroGreekDials();
  let liveFit = null;
  let pinBookState = null;
  let chartId = 'smile';
  let pinnedState = null;
  let greekDiff = null;
  let paintSerial = 0;
  let capture = null;
  let timer = null;
  const scenarios = loadScenarios();

  const CHARTS = [
    ['smile', 'Smile', 'Implied volatility, with 10Δ and 25Δ butterfly brackets'],
    ['delta', 'Smile by delta', 'The same smile against delta'],
    ['flyK', 'Fly by strike', 'How the fly changes with the center strike'],
    ['flyD', 'Fly by delta', 'How the fly changes with the center delta'],
    ['width', 'Fly by width', 'How the fly changes as the wings get wider'],
    ['price', 'Price fly', 'The option premium of the butterfly'],
    ['payoff', 'Payoff', 'Expiration and mark-to-market P&L'],
    ['greeks', 'Greeks', 'One Greek versus spot. Pick which Greek above the chart'],
    ['gmix', 'Greek change', 'How a pinned move splits across every Greek'],
    ['heat', 'Heatmap', 'Two inputs at once. Set the axes in the left panel'],
    ['hist', 'History', 'One year of the 60-day fly'],
    ['attr', 'What moved it', 'Which shock caused the fly to change']
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
    if (!s.greekDials) s.greekDials = F.zeroGreekDials();
    for (const d of F.GREEK_DIALS) {
      const v = num('gd_' + d.key);
      s.greekDials[d.key] = Number.isFinite(v) ? v : 0;
    }
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
    const dials = s.greekDials || F.zeroGreekDials();
    for (const d of F.GREEK_DIALS) setNum('gd_' + d.key, dials[d.key] || 0, 4);
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
    syncPanels();
  }
  function showField(id, on) {
    const el = document.getElementById(id);
    const field = el && el.closest('.field');
    if (field) field.hidden = !on;
  }
  function syncPanels() {
    const center = document.getElementById('centerMode');
    const wing = document.getElementById('wingMode');
    if (!center || !wing) return;
    const byStrike = center.value === 'strike';
    const byDelta = center.value === 'delta';
    showField('centerK', byStrike);
    showField('centerDelta', byDelta);
    showField('centerSide', byDelta);
    showField('wingStrike', wing.value === 'strike');
    showField('wingAsym', wing.value === 'strike');
    showField('wingLog', wing.value === 'log');
    showField('wingDelta', wing.value === 'delta');
    const greekPick = document.getElementById('greekPick');
    if (greekPick) greekPick.hidden = chartId !== 'greeks';
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

  function panel(id, title, body, open) {
    return '<details class="panel"' + (id ? ' id="' + id + '"' : '') + (open ? ' open' : '') + '><summary>' + title + '</summary><div class="body">' + body + '</div></details>';
  }
  function buildControls() {
    document.getElementById('controls').innerHTML = [
      '<div class="row stick-actions">',
      '<button class="btn sm" id="resetMkt" type="button">Reset market</button>',
      '<button class="btn sm" id="resetBase" type="button">Reset shocks</button>',
      '<button class="btn sm" id="resetDials" type="button">Reset dials</button>',
      '</div>',
      '<p class="howto">Move spot or volatility, then pin the chart to compare. Open a section below for wings, shocks, or one Greek at a time.</p>',
      panel('', 'Market', [
        '<p class="muted">Reset market reloads the last session of the book you are on. Editing a smile input switches from that stored smile to the sliders.</p>',
        field('S', 'Spot', { min: 2500, max: 12000, step: 1, range: true }),
        field('atmPct', 'ATM volatility', { min: 5, max: 80, step: 0.1, range: true }),
        '<div class="grid2">',
        field('days', 'Days to expiry', { min: 5, max: 365, step: 1, range: true }),
        sel('dayCount', 'Day count', [['365', 'ACT/365'], ['252', 'ACT/252']]),
        field('rPct', 'Rate %', { min: -1, max: 10, step: 0.01, range: true }),
        field('qPct', 'Dividend %', { min: 0, max: 6, step: 0.01, range: true }),
        '</div>',
        '<p class="muted">History stays on ACT/365 and 60 days, even if pricing uses another day count.</p>',
        field('put10', 'Put skew', { min: -5, max: 25, step: 0.1, range: true }),
        field('call10', 'Call skew', { min: -5, max: 20, step: 0.1, range: true }),
        field('curv10', 'Curvature', { min: -5, max: 12, step: 0.1, range: true }),
        field('asym10', 'Asymmetry', { min: -8, max: 8, step: 0.1, range: true }),
        field('wing10', 'Wing steepness', { min: 0, max: 10, step: 0.1, range: true }),
        '<div class="grid2">',
        field('bumpPts', 'Local bump', { min: -3, max: 3, step: 0.05, range: true }),
        field('bumpK', 'Bump center', { min: -0.2, max: 0.2, step: 0.01, range: true }),
        '</div>'
      ].join(''), true),
      panel('', 'Fly you are measuring', [
        sel('centerMode', 'Center', [['strike', 'Strike'], ['delta', 'Delta']]),
        field('centerK', 'Center strike', { min: 2000, max: 14000, step: 1, range: true }),
        '<div class="grid2">',
        field('centerDelta', 'Center |delta|', { min: 0.05, max: 0.95, step: 0.01, range: true }),
        sel('centerSide', 'Center side', [['call', 'Call'], ['put', 'Put']]),
        '</div>',
        sel('wingMode', 'Wing spacing', [['log', 'Percent from the forward'], ['strike', 'Points from the center'], ['delta', 'Fixed delta, such as 25Δ']]),
        field('wingStrike', 'Wing width (points)', { min: 10, max: 500, step: 1, range: true }),
        field('wingAsym', 'Upper wing extra (points)', { min: -80, max: 80, step: 1, range: true }),
        field('wingLog', 'Wing width (log)', { min: 0.01, max: 0.2, step: 0.005, range: true }),
        field('wingDelta', 'Wing |delta|', { min: 0.05, max: 0.45, step: 0.01, range: true }),
        sel('deltaConv', 'Delta convention', [['forward', 'Forward delta'], ['spot', 'Spot delta'], ['premium', 'Premium-adjusted spot']]),
        sel('flyQuote', 'Fly number in the header', [
          ['raw', 'On the wings selected above'],
          ['atm', 'Around ATM, at the wing delta'],
          ['d25', '25Δ butterfly'],
          ['dn', 'Forward-delta butterfly']
        ]),
        '<p class="muted">The fly number is a volatility gap, not the price of the option package.</p>'
      ].join(''), true),
      panel('', 'Option package', [
        sel('strategy', 'Structure', [
          ['long_call', 'Long call fly +1 / −2 / +1'],
          ['short_call', 'Short call fly'],
          ['long_put', 'Long put fly'],
          ['short_put', 'Short put fly'],
          ['broken_call', 'Broken-wing call (1.6× / 0.7×)'],
          ['dn_call', 'Delta-neutral call'],
          ['dn_put', 'Delta-neutral put']
        ]),
        sel('priceConvention', 'Price weights', [
          ['normalized', 'Half / −1 / half'],
          ['unnormalized', '1 / −2 / 1'],
          ['custom', 'Custom weights']
        ]),
        '<div class="grid2">',
        field('tradeQty', 'Quantity', { min: 1, max: 100, step: 1, range: true }),
        field('multiplier', 'Multiplier', { min: 1, max: 100, step: 1, range: false }),
        field('spreadPct', 'Half-spread %', { min: 0, max: 10, step: 0.1, range: true }),
        field('slippage', 'Slippage', { min: 0, max: 2, step: 0.01, range: true }),
        field('fee', 'Fee per contract', { min: 0, max: 5, step: 0.05, range: true }),
        '</div>',
        '<div class="field"><label>Entry premium (blank uses the baseline mid)</label><input type="number" id="entryPremium" step="0.01" /></div>',
        sel('sticky', 'When spot moves, volatility', [['moneyness', 'Stays at the same moneyness'], ['strike', 'Stays at the same strike']])
      ].join(''), false),
      panel('panelShocks', 'Shocks and presets', [
        '<p class="muted">Each slider is one experiment. Preset K replays a real down day onto today’s smile.</p>',
        field('dS', 'Spot %', { min: -20, max: 20, step: 0.1, range: true }),
        field('dAtm', 'ATM vol points', { min: -10, max: 15, step: 0.1, range: true }),
        field('dPut', 'Put skew', { min: -8, max: 8, step: 0.1, range: true }),
        field('dCall', 'Call skew', { min: -8, max: 8, step: 0.1, range: true }),
        field('dCurv', 'Curvature', { min: -4, max: 4, step: 0.1, range: true }),
        field('dWing', 'Wing', { min: -3, max: 3, step: 0.1, range: true }),
        field('dDays', 'Days', { min: -40, max: 40, step: 1, range: true }),
        field('drBps', 'Rate (bp)', { min: -100, max: 100, step: 1, range: true }),
        field('dqBps', 'Dividend (bp)', { min: -50, max: 50, step: 1, range: true }),
        field('dWidthStrike', 'Strike width', { min: -50, max: 50, step: 1, range: true }),
        field('dWidthLog', 'Log width', { min: -0.05, max: 0.05, step: 0.005, range: true }),
        field('dWidthDelta', 'Delta width', { min: -0.1, max: 0.1, step: 0.01, range: true }),
        field('dCenterDelta', 'Center delta', { min: -0.2, max: 0.2, step: 0.01, range: true }),
        field('dCost', 'Extra slippage', { min: 0, max: 1, step: 0.01, range: true }),
        '<div class="row" id="presetRow"></div>',
        '<div class="field" style="margin-top:8px;"><label>Name for a saved case</label><input type="text" id="scName" value="Case 1" /></div>',
        '<button class="btn sm primary" id="saveSc" type="button">Save this case</button>'
      ].join(''), false),
      panel('panelDials', 'Greek dials', [
        '<p class="muted">Move one dial to change that Greek alone. Move several to see the closest combination. The gap is the part the smile cannot reach.</p>',
        '<div class="grid2">',
        F.GREEK_DIALS.map((d) => field('gd_' + d.key, d.label, { min: d.min, max: d.max, step: d.step, range: true })).join(''),
        '</div>',
        '<div id="dialFit"></div>'
      ].join(''), false),
      panel('panelHeat', 'Heatmap axes', [
        sel('heatX', 'Horizontal', [['S', 'Spot'], ['atm', 'ATM volatility'], ['putSkew', 'Put skew'], ['curvature', 'Curvature'], ['width', 'Wing width'], ['days', 'Days'], ['centerDelta', 'Center delta']]),
        sel('heatY', 'Vertical', [['atm', 'ATM volatility'], ['S', 'Spot'], ['putSkew', 'Put skew'], ['curvature', 'Curvature'], ['width', 'Wing width'], ['days', 'Days']]),
        sel('heatM', 'Color', [['ivFly', 'IV fly'], ['priceFly', 'Price fly'], ['premium', 'Package premium'], ['pnl', 'P&L versus entry'], ['delta', 'Delta'], ['gamma', 'Gamma'], ['vega', 'Vega']])
      ].join(''), false)
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
      '<button class="btn sm" type="button" data-preset="' + p.id + '" title="' + esc(p.note || p.name) + '">' + esc(p.name) + '</button>'
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
      state.source = history.synthetic === false ? 'market' : 'synthetic';
      state.greekDials = F.zeroGreekDials();
      write();
      schedule();
    };
    document.getElementById('resetBase').onclick = () => {
      state.shocks = F.zeroShocks();
      write();
      schedule();
    };
    document.getElementById('resetDials').onclick = () => {
      state.greekDials = F.zeroGreekDials();
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
    if (id === 'centerMode' || id === 'wingMode') syncPanels();
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
    const stack = document.getElementById('chartStack') || document.getElementById('chart');
    const top = stack.getBoundingClientRect().top;
    const note = document.getElementById('chartAbout') || document.getElementById('chartNote');
    const noteH = note ? note.offsetHeight + 8 : 28;
    const fly = document.getElementById('flyPanel');
    const flyH = fly ? 280 : 0;
    return Math.max(320, Math.round(window.innerHeight - top - noteH - flyH - 20));
  }
  function draw(traces, lay, note, csvRows) {
    if (capture) {
      capture.traces = traces;
      capture.lay = lay;
      capture.note = note;
      capture.csv = csvRows;
      return;
    }
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
    lay.uirevision = pinnedState ? (chartId + ':' + paintSerial) : chartId;
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
  function plotEls() {
    const el = document.getElementById('chart');
    return el ? [el] : [];
  }
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
    plotEls().forEach((el) => { if (el.data) Plotly.relayout(el, upd); });
  }
  function setDrag(mode) {
    if (!window.Plotly) return;
    plotEls().forEach((el) => { if (el.data) Plotly.relayout(el, { dragmode: mode }); });
    document.querySelectorAll('[data-drag]').forEach((btn) => btn.classList.toggle('on', btn.getAttribute('data-drag') === mode));
  }

  function selectedFly(view) {
    const q = view.quotes;
    if (state.flyQuote === 'd25') return q.d25;
    if (state.flyQuote === 'atm') return q.atm;
    if (state.flyQuote === 'dn') return q.dn;
    return q.raw;
  }

  function addBrokerGeometry(traces, lay, marks, xOf) {
    if (!marks.length) return;
    const shapes = [];
    const annotations = [];
    const span = Math.abs(xOf(marks[0], 'call') - xOf(marks[0], 'put')) || 1;
    for (const m of marks) {
      const xP = xOf(m, 'put');
      const xA = xOf(m, 'atm');
      const xC = xOf(m, 'call');
      const yP = m.ivL * 100;
      const yA = m.ivC * 100;
      const yC = m.ivU * 100;
      const mid = 0.5 * (yP + yC);
      const chord = line(m.label + ' chord', [xP, xC], [yP, yC], '#f43f5e');
      chord.line.width = 1.5;
      traces.push(chord);
      const width = Math.abs(xC - xP) || span;
      const side = m.delta === 0.25 ? -1 : 1;
      const xb = xA + side * width * 0.035;
      const onPut = m.delta === 0.25;
      const xr = (onPut ? xP : xC) + (onPut ? -1 : 1) * width * 0.045;
      traces.push({
        type: 'scatter', mode: 'markers', showlegend: false, hoverinfo: 'skip',
        marker: { size: 1, color: 'rgba(0,0,0,0)' },
        x: [xr, xb], y: [Math.max(yP, yC), Math.max(yA, 0.5 * (yP + yC))]
      });
      const yHi = Math.max(yP, yC, yA, mid);
      const yLo = Math.min(yP, yC, yA, mid);
      for (const x of [xP, xA, xC]) {
        shapes.push({
          type: 'line', xref: 'x', yref: 'y',
          x0: x, x1: x, y0: yLo, y1: yHi,
          line: { color: 'rgba(148,163,184,0.4)', width: 1, dash: 'dash' }
        });
      }
      const tick = width * 0.015;
      bracket(shapes, xb, Math.min(yA, mid), Math.max(yA, mid), tick);
      annotations.push(tag(xb, (yA + mid) / 2, m.label + ' BF ' + (m.bf * 100).toFixed(2), side < 0 ? 'right' : 'left'));
      bracket(shapes, xr, Math.min(yP, yC), Math.max(yP, yC), tick);
      annotations.push(tag(xr, (yP + yC) / 2, m.label + ' RR ' + (m.rr * 100).toFixed(2), onPut ? 'right' : 'left'));
      annotations.push({
        x: xP, y: yP, text: '−' + m.label, showarrow: false, yshift: 12,
        font: { color: '#94a3b8', size: 11 }
      });
      annotations.push({
        x: xC, y: yC, text: m.label, showarrow: false, yshift: 12,
        font: { color: '#94a3b8', size: 11 }
      });
    }
    const atm = marks[0];
    annotations.push({
      x: xOf(atm, 'atm'), y: atm.ivC * 100, text: 'ATM', showarrow: false, yshift: -14,
      font: { color: '#94a3b8', size: 11 }
    });
    lay.shapes = shapes;
    lay.annotations = annotations;
  }
  function bracket(shapes, x, y0, y1, tick) {
    const green = { color: '#4ade80', width: 2 };
    shapes.push(
      { type: 'line', xref: 'x', yref: 'y', x0: x, x1: x, y0: y0, y1: y1, line: green },
      { type: 'line', xref: 'x', yref: 'y', x0: x - tick, x1: x + tick, y0: y0, y1: y0, line: green },
      { type: 'line', xref: 'x', yref: 'y', x0: x - tick, x1: x + tick, y0: y1, y1: y1, line: green }
    );
  }
  function tag(x, y, text, anchor) {
    return {
      x: x, y: y, text: text, showarrow: false,
      xanchor: anchor, xshift: anchor === 'right' ? -10 : 10,
      font: { color: '#4ade80', size: 12 },
      bgcolor: 'rgba(11,14,20,0.75)'
    };
  }

  function compareItems() {
    const out = [];
    for (const key of compareSet) {
      const warmup = key.charAt(0) === 'w';
      const index = parseInt(key.slice(2), 10);
      const pool = warmup ? history.warmup : history.days;
      const day = pool && pool[index];
      if (day) out.push({ key, day, warmup, index });
    }
    return out;
  }
  function openSession(index, warmup) {
    pinnedState = null;
    paintSerial += 1;
    state = warmup ? F.linkToWarmup(state, history, index) : F.linkToSession(state, history, index);
    state.greekDials = F.zeroGreekDials();
    state.source = history.synthetic === false ? 'market' : 'synthetic';
    write();
    render();
  }
  function toggleCompare(key) {
    const at = compareSet.indexOf(key);
    if (at >= 0) compareSet.splice(at, 1);
    else if (compareSet.length < 6) compareSet.push(key);
    render();
  }
  function smileOf(day) {
    const x = [], y = [];
    for (let i = 0; i < day.ks.length; i++) {
      if (typeof day.iv[i] === 'number' && Number.isFinite(day.iv[i])) {
        x.push(day.ks[i]);
        y.push(day.iv[i] * 100);
      }
    }
    return { x, y };
  }
  function flyOfK(s) {
    const rows = F.flyCurve(s);
    const fwd = F.forward(F.materialize(s));
    return {
      x: rows.map((r) => Math.log(r.K / fwd)),
      y: rows.map((r) => r.fly * 100)
    };
  }

  function renderChart(view) {
    if (chartId === 'smile') {
      const s = F.smileSeries(state, history);
      const compared = compareItems().filter((item) => item.day.date !== state.asOf);
      const useK = compared.length > 0;
      const fwd = F.forward(state);
      const xs = s.rows.map((r) => useK ? r.k : r.K);
      const traces = [
        line(state.asOf || 'This session', xs, s.rows.map((r) => r.market * 100), '#e6edf7'),
        line('Baseline', xs, s.rows.map((r) => r.baseline * 100), '#8b95a8', 'dot'),
        line('Quadratic smooth (bump off)', xs, s.quadratic.map((v) => v * 100), '#2dd4bf', 'dash')
      ];
      if (s.svi.ok) traces.push(line('SVI fit', xs, s.rows.map((r) => s.svi.iv(r.k) * 100), '#f59e0b'));
      if (s.ssvi.ok) traces.push(line('SSVI fit', xs, s.rows.map((r) => s.ssvi.iv(r.k) * 100), '#a78bfa'));
      compared.forEach((item, i) => {
        const sm = smileOf(item.day);
        traces.push(line(item.day.date + (item.warmup ? ' warm-up' : ''), sm.x, sm.y, DAY_COLORS[i % DAY_COLORS.length], 'dash'));
      });
      const wingX = [view.wings.Kl, view.wings.Kc, view.wings.Ku].map((K) => useK && K > 0 ? Math.log(K / fwd) : K);
      traces.push({
        type: 'scatter', mode: 'markers', name: 'Wings / center',
        x: wingX,
        y: [view.wings.ivL, view.wings.ivC, view.wings.ivU].map((v) => v * 100),
        marker: { size: 10, color: ['#7dd3fc', '#f59e0b', '#fca5a5'] }
      });
      const smileLay = layout(
        useK ? 'Compared smiles vs log-moneyness' : 'Implied volatility vs strike',
        'IV (vol points)',
        useK ? 'k = ln(K/F)' : 'Strike'
      );
      const marks = F.brokerMarks(state);
      addBrokerGeometry(traces, smileLay, marks, (m, side) => {
        const K = side === 'put' ? m.Kl : side === 'call' ? m.Ku : m.Kc;
        return useK && K > 0 ? Math.log(K / fwd) : K;
      });
      draw(traces, smileLay,
        (useK ? 'Checked days share log-moneyness, so a different spot does not shift the smile. Dashed curves are the other sessions. ' : '') +
        'The red chord joins the 10Δ or 25Δ put to the matching call. BF is the vol-point gap from that chord down to the center. RR is call-wing vol minus put-wing vol. These are smile quotes, not the package debit. |k|>0.30 is outside the quoted grid.',
        xs.map((x, i) => [x, s.rows[i].market, s.rows[i].baseline]));
    } else if (chartId === 'delta') {
      const rows = F.deltaSmile(state);
      const traces = [
        line(state.asOf || 'This session', rows.map((r) => r.delta), rows.map((r) => r.iv * 100), '#e6edf7')
      ];
      compareItems().filter((item) => item.day.date !== state.asOf).forEach((item, i) => {
        const other = F.stateFromDay(item.day);
        other.deltaConv = state.deltaConv;
        const alt = F.deltaSmile(other);
        traces.push(line(item.day.date, alt.map((r) => r.delta), alt.map((r) => r.iv * 100), DAY_COLORS[i % DAY_COLORS.length], 'dash'));
      });
      const deltaLay = layout('Implied volatility vs ' + state.deltaConv + ' delta', 'IV (vol points)', 'Signed delta (put < 0 < call)');
      addBrokerGeometry(traces, deltaLay, F.brokerMarks(state), (m, side) => side === 'put' ? m.putDelta : side === 'call' ? m.callDelta : 0);
      draw(traces, deltaLay,
        'Puts use the put delta, calls the call delta. BF is the gap from the wing chord to ATM. RR is the call wing minus the put wing, in vol points.',
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
    } else if (chartId === 'gmix') {
      if (!greekDiff || !greekDiff.ok) {
        draw([], layout('Package price change through the Greek combination', 'Index points', 'Greek'),
          'Pin overlay, then move spot, volatility, time, or rates. This chart splits that package price change across every Greek, including the cross terms vanna (spot × vol), charm (spot × time), and color (spot² × time).',
          []);
      } else {
        const m = greekDiff;
        const labels = m.terms.map((t) => t.key);
        const values = m.terms.map((t) => t.value);
        const hover = m.terms.map((t) => t.combo + ' · ' + t.formula);
        labels.push('residual');
        values.push(m.residual);
        hover.push('actual minus the Greek sum, same strikes');
        if (Math.abs(m.structure) > 1e-4) {
          labels.push('new strikes');
          values.push(m.structure);
          hover.push('live wings minus the pinned strikes');
        }
        draw([{
          type: 'bar', name: 'Price change', x: labels, y: values,
          marker: { color: values.map((v) => v >= 0 ? '#22c55e' : '#ef4444') },
          customdata: hover,
          hovertemplate: '%{x}<br>%{customdata}<br>%{y:.4f} pts<extra></extra>'
        }], layout('Package price change through the Greek combination', 'Index points', 'Greek'),
          m.note + ' Explained ' + F.fmt(m.explained, 3) + ' pts. Same-strike actual ' + F.fmt(m.actualSameStrikes, 3) +
            ' pts. Residual ' + F.fmt(m.residual, 3) + ' pts.',
          labels.map((name, i) => [name, values[i], hover[i]]));
      }
    } else if (chartId === 'heat') {
      const hmap = F.heatmap(state, state.heatmap.x, state.heatmap.y, state.heatmap.metric, 13);
      draw([{
        type: 'heatmap', x: hmap.x, y: hmap.y, z: hmap.z, colorscale: 'RdBu', reversescale: true, hovertemplate: 'x %{x:.4g}<br>y %{y:.4g}<br>%{z:.4g}<extra></extra>'
      }], layout(hmap.metric + ' heatmap', hmap.yLabel, hmap.xLabel), hmap.note, []);
    } else if (chartId === 'hist') {
      const hch = F.historyChart(state, history);
      const histTraces = [
        line('Daily fly (vol pts)', hch.dates, hch.fly.map((v) => v * 100), '#3d9cf0'),
        line('63-session median', hch.dates, hch.roll.map((v) => v * 100), '#22c55e'),
        line('Robust z', hch.dates, hch.z, '#f59e0b'),
        line('Next 5-session spot return', hch.dates, hch.outcome5d, '#fca5a5', 'dot')
      ];
      const openI = state.viewWarmup ? -1 : (Number.isFinite(state.sessionIndex) ? state.sessionIndex : hch.dates.length - 1);
      if (openI >= 0 && openI < hch.dates.length) {
        histTraces.push({
          type: 'scatter', mode: 'markers', name: 'Open day',
          x: [hch.dates[openI]], y: [hch.fly[openI] * 100],
          marker: { size: 12, color: '#e6edf7', symbol: 'diamond' }
        });
      }
      const cmpX = [], cmpY = [];
      compareItems().forEach((item) => {
        if (item.warmup) return;
        cmpX.push(hch.dates[item.index]);
        cmpY.push(hch.fly[item.index] * 100);
      });
      if (cmpX.length) {
        histTraces.push({
          type: 'scatter', mode: 'markers', name: 'Compared',
          x: cmpX, y: cmpY,
          marker: { size: 9, color: '#f472b6', symbol: 'circle-open', line: { width: 2, color: '#f472b6' } }
        });
      }
      draw(histTraces, layout('One-year 60-DTE fly', 'Vol points, z, or return', 'Session'),
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

  function asPinned(trace) {
    const t = JSON.parse(JSON.stringify(trace));
    t.name = 'Pinned · ' + (trace.name || 'series');
    if (t.type === 'heatmap') {
      t.type = 'contour';
      t.showscale = false;
      delete t.colorscale;
      delete t.reversescale;
      t.contours = { coloring: 'none', showlabels: false };
      t.line = { color: '#f59e0b', width: 1.4 };
      return t;
    }
    if (t.type === 'bar') {
      t.marker = Object.assign({}, t.marker || {}, { color: '#f59e0b', opacity: 0.45 });
      t.opacity = 0.55;
      return t;
    }
    const color = (t.line && t.line.color) || '#f59e0b';
    t.line = Object.assign({}, t.line || {}, { color: color, dash: 'dash', width: 1.6 });
    if (t.marker) {
      t.marker = {
        size: (t.marker.size || 9) - 1,
        symbol: 'circle-open',
        color: 'rgba(0,0,0,0)',
        line: { width: 2, color: Array.isArray(trace.marker && trace.marker.color) ? '#f59e0b' : color }
      };
    }
    return t;
  }
  function paintCharts(liveView) {
    paintSerial += 1;
    if (!pinnedState) {
      renderChart(liveView);
      setPinChrome('');
      return;
    }
    if (chartId === 'gmix') {
      renderChart(liveView);
      const pinOnly = F.view(pinBookState || pinnedState, history);
      const pinFly = selectedFly(pinOnly);
      const liveFly = selectedFly(liveView);
      const deltaPts = (liveFly - pinFly) * 100;
      setPinChrome(Number.isFinite(deltaPts)
        ? 'IV fly ' + (deltaPts > 0 ? '+' : '') + deltaPts.toFixed(2) + ' vol pts vs pin'
        : '');
      return;
    }
    const saved = state;
    let pinView;
    let pinCap;
    try {
      state = pinnedState;
      capture = {};
      pinView = F.view(pinBookState || pinnedState, history);
      renderChart(pinView);
      pinCap = capture;
    } finally {
      state = saved;
      capture = null;
    }
    capture = {};
    renderChart(liveView);
    const liveCap = capture;
    capture = null;
    const traces = (liveCap.traces || []).concat((pinCap.traces || []).map(asPinned));
    const lay = liveCap.lay;
    if (traces.some((t) => t.type === 'bar')) lay.barmode = 'overlay';
    draw(traces, lay,
      'Dashed curves are the pinned parameters on this same chart. Solid curves follow the controls. ' + (liveCap.note || ''),
      liveCap.csv);
    const pinFly = selectedFly(pinView);
    const liveFly = selectedFly(liveView);
    const deltaPts = (liveFly - pinFly) * 100;
    const delta = Number.isFinite(deltaPts)
      ? 'IV fly ' + (deltaPts > 0 ? '+' : '') + deltaPts.toFixed(2) + ' vol pts vs pin'
      : '';
    setPinChrome(delta);
  }
  function setPinChrome(delta) {
    const pinBtn = document.getElementById('pinBtn');
    const closePin = document.getElementById('closePin');
    const deltaEl = document.getElementById('pinDelta');
    if (pinBtn) pinBtn.textContent = pinnedState ? 'Update pin' : 'Pin overlay';
    if (closePin) closePin.style.display = pinnedState ? '' : 'none';
    if (deltaEl) deltaEl.textContent = delta || '';
  }

  function solveDials(s) {
    if (!s) return null;
    const fit = F.solveGreekDials(s, s.greekDials);
    return fit && fit.ok && fit.active ? fit : null;
  }
  function renderDialFit(fit) {
    const el = document.getElementById('dialFit');
    if (!el) return;
    if (!fit || !fit.active) {
      el.innerHTML = '<p class="muted">Dials at zero. Turn one Greek, then add others to see the combination.</p>';
      return;
    }
    const rows = F.GREEK_DIALS.filter((d) => Math.abs(fit.targets[d.key]) > 1e-12).map((d) => {
      const gap = fit.achieved[d.key] - fit.targets[d.key];
      return '<tr><td>' + esc(d.label) + '</td><td>' + F.fmt(fit.targets[d.key], 4) + '</td><td>' + F.fmt(fit.achieved[d.key], 4) + '</td><td>' + F.fmt(gap, 4) + '</td></tr>';
    }).join('');
    el.innerHTML = '<table><thead><tr><th>Greek</th><th>Asked</th><th>Got</th><th>Gap</th></tr></thead><tbody>' + rows +
      '</tbody></table><p class="muted">' + esc((fit.drivers || []).join(' · ') || 'No move inside the caps.') + '</p>';
  }

  function greekMixTable() {
    const m = greekDiff;
    if (!m || !m.ok) {
      return '<p class="muted">Pin overlay, then change parameters. Each row is one Greek. Columns are the wings and the package. Vanna, charm, and color are the cross terms. Values are index points for one package.</p>';
    }
    const legs = m.legs;
    const head = legs.map((leg) => esc(leg.type) + ' ' + leg.K.toFixed(0)).join('</th><th>');
    const bodyRows = m.terms.map((t) => {
      const cells = legs.map((leg) => '<td>' + F.fmt(leg.terms[t.key], 4) + '</td>').join('');
      return '<tr><td>' + esc(t.key) + '</td><td>' + esc(t.combo) + '</td>' + cells + '<td>' + F.fmt(t.value, 4) + '</td></tr>';
    }).join('');
    const actualCells = legs.map((leg) => '<td>' + F.fmt(leg.actual, 4) + '</td>').join('');
    return '<p class="muted">' + esc(m.note) + '</p>' +
      '<p class="mono">dS ' + F.fmt(m.dS, 2) + ' · dT ' + F.fmt(m.dT, 5) + ' · dr ' + F.fmt(m.dr, 5) + ' · dq ' + F.fmt(m.dq, 5) +
      ' · same-strike ' + F.fmt(m.actualSameStrikes, 4) + ' · explained ' + F.fmt(m.explained, 4) +
      ' · residual ' + F.fmt(m.residual, 4) + ' · new strikes ' + F.fmt(m.structure, 4) + '</p>' +
      '<div class="scroll"><table><thead><tr><th>Greek</th><th>Combination</th><th>' + head + '</th><th>Package</th></tr></thead><tbody>' +
      bodyRows +
      '<tr><td>actual</td><td>repriced</td>' + actualCells + '<td>' + F.fmt(m.actualSameStrikes, 4) + '</td></tr>' +
      '</tbody></table></div>';
  }

  function flyChip(label, value, change) {
    return '<span class="pill">' + label + ' <strong>' + value + '</strong>' +
      (change ? ' <span class="chg">' + change + '</span>' : '') + '</span>';
  }
  function signedPts(v) {
    if (!Number.isFinite(v)) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(2) + ' pts';
  }
  function drawFlyPanel(view, liveState, baseState, pinState) {
    const host = document.getElementById('flyValues');
    const el = document.getElementById('flyChart');
    if (!host || !el) return;
    const q = view.quotes || {};
    const price = view.priceFly && Number.isFinite(view.priceFly.normalized) ? view.priceFly.normalized : NaN;
    const vol = (v) => Number.isFinite(v) ? (v * 100).toFixed(2) + ' pts' : '—';
    const chips = [
      flyChip('Raw', vol(q.raw)),
      flyChip('25Δ', vol(q.d25)),
      flyChip('10Δ', vol(q.d10)),
      flyChip('ATM', vol(q.atm)),
      flyChip('Fwd Δ', vol(q.dn)),
      flyChip('Price', Number.isFinite(price) ? F.fmt(price, 2) + ' pts' : '—')
    ];
    const compared = compareItems().filter((item) => item.day.date !== state.asOf);
    const useK = compared.length > 0;
    const liveRows = F.flyCurve(liveState);
    const liveK = useK ? flyOfK(liveState) : null;
    const traces = [line(state.asOf || 'This session', useK ? liveK.x : liveRows.map((r) => r.K), useK ? liveK.y : liveRows.map((r) => r.fly * 100), '#e6edf7')];
    function rawOf(s) {
      return F.ivFlyOf(F.resolveWings(F.materialize(s)));
    }
    if (baseState) {
      const d = (q.raw - rawOf(baseState)) * 100;
      chips.push(flyChip('vs dials off', signedPts(d)));
      const rows = useK ? flyOfK(baseState) : null;
      const raw = F.flyCurve(baseState);
      traces.push(line('Before dials', useK ? rows.x : raw.map((r) => r.K), useK ? rows.y : raw.map((r) => r.fly * 100), '#8b95a8', 'dash'));
    }
    if (pinState) {
      const d = (q.raw - rawOf(pinState)) * 100;
      chips.push(flyChip('vs pin', signedPts(d)));
      const rows = useK ? flyOfK(pinState) : null;
      const raw = F.flyCurve(pinState);
      traces.push(line('Pinned', useK ? rows.x : raw.map((r) => r.K), useK ? rows.y : raw.map((r) => r.fly * 100), '#f59e0b', 'dash'));
    }
    compared.forEach((item, i) => {
      const other = F.stateFromDay(item.day);
      other.centerMode = state.centerMode;
      other.centerK = state.centerMode === 'strike' ? F.forward(other) : state.centerK;
      other.centerDelta = state.centerDelta;
      other.centerSide = state.centerSide;
      other.wingMode = state.wingMode;
      other.wingStrike = state.wingStrike;
      other.wingAsym = state.wingAsym;
      other.wingLog = state.wingLog;
      other.wingAsymLog = state.wingAsymLog;
      other.wingDelta = state.wingDelta;
      other.deltaConv = state.deltaConv;
      const rows = flyOfK(other);
      traces.push(line(item.day.date, rows.x, rows.y, DAY_COLORS[i % DAY_COLORS.length], 'dash'));
    });
    if (view.wings && Number.isFinite(view.wings.Kc) && Number.isFinite(q.raw)) {
      const fwd = F.forward(liveState);
      traces.push({
        type: 'scatter', mode: 'markers', name: 'This center',
        x: [useK ? Math.log(view.wings.Kc / fwd) : view.wings.Kc], y: [q.raw * 100],
        marker: { size: 11, color: '#2dd4bf' }
      });
    }
    host.innerHTML = chips.join('');
    if (!window.Plotly) {
      el.innerHTML = '<p class="muted">Plotly failed to load.</p>';
      return;
    }
    const lay = layout(useK ? 'IV fly vs log-moneyness' : 'IV fly vs center strike', 'IV fly (vol points)', useK ? 'Center k = ln(K/F)' : 'Center strike');
    lay.height = 240;
    lay.margin = { l: 56, r: 12, t: 28, b: 40 };
    lay.title.font.size = 12;
    lay.uirevision = 'fly-strip';
    const ys = [];
    traces.forEach((t) => finiteValues(t.y).forEach((v) => ys.push(v)));
    const yRange = paddedRange(ys, 0.1, false);
    if (yRange) {
      lay.yaxis.range = yRange;
      lay.yaxis.autorange = false;
    }
    Plotly.react(el, traces, lay, { responsive: true, displaylogo: false, displayModeBar: false, scrollZoom: true });
  }

  function fmtInf(v) {
    if (v === Infinity) return 'unbounded +';
    if (v === -Infinity) return 'unbounded −';
    return F.fmt(v, 2);
  }

  function render() {
  try {
    read();
    liveFit = solveDials(state);
    const pinFit = pinnedState ? solveDials(pinnedState) : null;
    const liveBook = liveFit ? liveFit.state : state;
    pinBookState = pinFit ? pinFit.state : pinnedState;
    greekDiff = pinnedState ? F.greekMove(pinBookState, liveBook) : null;
    const view = F.view(liveBook, history);
    const fly = selectedFly(view);
    const cls = view.scores.composite ? view.scores.composite.classification : 'insufficient';
    document.getElementById('pills').innerHTML = [
      ['Session', state.asOf || '—'],
      ['Spot', F.fmt(view.work.S, 1)],
      ['ATM', (view.work.atm * 100).toFixed(2) + ' pts'],
      ['DTE', view.work.days.toFixed(0)],
      ['IV fly', Number.isFinite(fly) ? (fly * 100).toFixed(2) + ' pts' : '—'],
      ['Class', cls]
    ].map((p) => '<span class="pill">' + p[0] + ' <strong class="' + (p[0] === 'Class' ? cls : '') + '">' + esc(p[1]) + '</strong></span>').join('');
    document.getElementById('banner').textContent = view.label + ' · Session ' + (state.asOf || '') +
      (state.viewWarmup ? ' is warm-up and is not scored.' : ' · scores use only earlier sessions.') +
      ' A positive residual means the fly looks expensive. Cheap is not a buy.';

    const sc = view.scores;
    const rail = [];
    if (compareItems().length) {
      const board = F.sessionBoard(history);
      const pts = (v) => Number.isFinite(v) ? (v * 100).toFixed(2) : '—';
      rail.push('<h3>Compared sessions</h3>');
      rail.push('<table><tbody>' + compareItems().map((item) => {
        const row = board.find((r) => r.warmup === item.warmup && r.index === item.index);
        if (!row) return '';
        return '<tr><td>' + row.date + '</td><td>' + pts(row.bf25) + ' / ' + pts(row.rr25) + '</td></tr>';
      }).join('') + '</tbody></table>');
      rail.push('<p class="muted">25Δ butterfly / risk reversal, vol points. The smile and fly strip draw the same days on log-moneyness.</p>');
    }
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
    if (greekDiff && greekDiff.ok) {
      const top = greekDiff.terms.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0];
      rail.push('<h3>Greek mix vs pin</h3>');
      rail.push('<p class="mono">Same-strike ' + F.fmt(greekDiff.actualSameStrikes, 3) + ' pts</p>');
      rail.push('<p class="mono">Largest ' + esc(top.key) + ' ' + F.fmt(top.value, 3) + ' · ' + esc(top.combo) + '</p>');
      rail.push('<p class="muted">Explained ' + F.fmt(greekDiff.explained, 3) + ' · residual ' + F.fmt(greekDiff.residual, 3) + '. The Greek mix chart has every term.</p>');
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
      '<button data-b="days"' + (bottomTab === 'days' ? ' class="active"' : '') + '>All days</button>' +
      '<button data-b="methods"' + (bottomTab === 'methods' ? ' class="active"' : '') + '>15 scores</button><button data-b="legs">Legs</button><button data-b="gmix">Greek mix</button><button data-b="attr">Interactions</button><button data-b="scen">Saved scenarios</button><button data-b="method">Methodology</button>' +
      '</div><div id="bottomBody"></div>';
    const body = document.getElementById('bottomBody');
    function showBottom(which) {
      if (which === 'days') {
        const board = F.sessionBoard(history);
        const q = (document.getElementById('dayFind').value || '').trim();
        const pts = (v) => Number.isFinite(v) ? (v * 100).toFixed(2) : '—';
        const shown = board.filter((r) => !q || String(r.date).indexOf(q) >= 0);
        body.innerHTML = '<p class="muted">Open puts that session on every chart. Tick compare to draw it with the open session. Smiles share log-moneyness, so a different spot does not slide the curve. Warm-up rows are listed and are not scored. ' + shown.length + ' of ' + board.length + '.</p>' +
          '<div class="scroll" style="max-height:460px"><table><thead><tr><th>Compare</th><th>Date</th><th>Role</th><th>Spot</th><th>ATM</th><th>25Δ BF</th><th>25Δ RR</th><th>10Δ BF</th><th>10Δ RR</th><th></th></tr></thead><tbody>' +
          shown.map((r) => {
            const key = (r.warmup ? 'w:' : 'v:') + r.index;
            const open = (r.warmup && state.viewWarmup && r.date === state.asOf) || (!r.warmup && !state.viewWarmup && r.index === state.sessionIndex);
            return '<tr class="' + (open ? 'open-day' : '') + '"><td><input type="checkbox" data-cmp="' + key + '"' + (compareSet.indexOf(key) >= 0 ? ' checked' : '') + ' /></td><td>' + r.date + '</td><td>' + (r.warmup ? 'warm-up' : 'valuation') + '</td><td>' + F.fmt(r.S, 1) + '</td><td>' + pts(r.atm) + '</td><td>' + pts(r.bf25) + '</td><td>' + pts(r.rr25) + '</td><td>' + pts(r.bf10) + '</td><td>' + pts(r.rr10) + '</td><td><button class="btn sm" type="button" data-open="' + key + '">Open</button></td></tr>';
          }).join('') + '</tbody></table></div>';
        body.querySelectorAll('[data-cmp]').forEach((box) => {
          box.onchange = () => toggleCompare(box.getAttribute('data-cmp'));
        });
        body.querySelectorAll('[data-open]').forEach((btn) => {
          btn.onclick = () => {
            const key = btn.getAttribute('data-open');
            openSession(parseInt(key.slice(2), 10), key.charAt(0) === 'w');
          };
        });
      } else if (which === 'legs') {
        body.innerHTML = '<div class="scroll"><table><thead><tr><th>Type</th><th>Strike</th><th>Qty</th><th>IV</th><th>Mid</th><th>Delta</th><th>Vega / pt</th></tr></thead><tbody>' +
          (view.greeks ? view.greeks.perLeg.map((r) => '<tr><td>' + r.type + '</td><td>' + r.K.toFixed(2) + '</td><td>' + F.fmt(r.qty, 3) + '</td><td>' + (r.iv * 100).toFixed(2) + '</td><td>' + F.fmt(r.price, 2) + '</td><td>' + F.fmt(r.delta, 3) + '</td><td>' + F.fmt(r.vega / 100, 3) + '</td></tr>').join('') : '') +
          '</tbody></table></div>';
      } else if (which === 'gmix') {
        body.innerHTML = greekMixTable();
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
    showBottom(bottomTab);
    document.getElementById('bottomTabs').onclick = (ev) => {
      const b = ev.target.getAttribute('data-b');
      if (!b) return;
      bottomTab = b;
      document.querySelectorAll('#bottomTabs button').forEach((btn) => btn.classList.toggle('active', btn === ev.target));
      showBottom(b);
    };
    renderDayBar();
    paintCharts(view);
    renderDialFit(liveFit);
    drawFlyPanel(view, liveBook, liveFit ? state : null, pinnedState ? pinBookState : null);
    if (liveFit && liveFit.active) {
      const note = document.getElementById('chartNote');
      if (note) note.textContent = 'Greek dials solved the book: ' + liveFit.drivers.join(', ') + '. ' + note.textContent;
    }
  } catch (err) {
    document.getElementById('chartNote').textContent = 'Calculation error: ' + err.message;
    console.error(err);
  }
  }

  function buildChartChrome() {
    document.getElementById('chartTabs').innerHTML = CHARTS.map((c) =>
      '<button type="button" data-c="' + c[0] + '" title="' + esc(c[2]) + '"' + (c[0] === chartId ? ' class="active"' : '') + '>' + c[1] + '</button>'
    ).join('');
    document.getElementById('chartTabs').onclick = (ev) => {
      const id = ev.target.getAttribute('data-c');
      if (!id) return;
      chartId = id;
      document.querySelectorAll('#chartTabs button').forEach((b) => b.classList.toggle('active', b.getAttribute('data-c') === id));
      if (id === 'heat') { const p = document.getElementById('panelHeat'); if (p) p.open = true; }
      if (id === 'gmix' || id === 'greeks') { const p = document.getElementById('panelDials'); if (p) p.open = true; }
      if (id === 'attr' || id === 'payoff') { const p = document.getElementById('panelShocks'); if (p) p.open = true; }
      syncPanels();
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
      '<span class="sep"></span>' +
      '<button class="btn sm primary" type="button" id="pinBtn" title="Freeze these curves on the same chart, then move the controls">Pin overlay</button>' +
      '<button class="btn sm" type="button" id="closePin" style="display:none" title="Remove the pinned curves">Clear pin</button>' +
      '<span class="pin-delta" id="pinDelta"></span>' +
      '<span class="hint">Scroll zooms · double-click resets</span>';
    document.getElementById('zoomIn').onclick = () => zoomAxes(0.8, 0.8);
    document.getElementById('zoomOut').onclick = () => zoomAxes(1.25, 1.25);
    document.getElementById('zoomYIn').onclick = () => zoomAxes(null, 0.72);
    document.getElementById('zoomYOut').onclick = () => zoomAxes(null, 1.4);
    document.getElementById('zoomXIn').onclick = () => zoomAxes(0.8, null);
    document.getElementById('zoomXOut').onclick = () => zoomAxes(1.25, null);
    document.getElementById('fitView').onclick = () => {
      if (!window.Plotly) return;
      plotEls().forEach((el) => { if (el.data) Plotly.relayout(el, { 'xaxis.autorange': true, 'yaxis.autorange': true }); });
    };
    document.getElementById('pinBtn').onclick = () => {
      read();
      pinnedState = JSON.parse(JSON.stringify(state));
      render();
    };
    document.getElementById('closePin').onclick = () => {
      pinnedState = null;
      render();
    };
    document.getElementById('viewTools').addEventListener('click', (ev) => {
      const mode = ev.target.getAttribute && ev.target.getAttribute('data-drag');
      if (mode) setDrag(mode);
    });
    document.getElementById('chartTools').innerHTML =
      '<label class="muted" id="greekPick">Greek <select id="greekName"><option>delta</option><option>gamma</option><option>vega</option><option>theta</option><option>rho</option><option>vanna</option><option>vomma</option><option>charm</option><option>color</option><option>speed</option></select></label>' +
      '<details class="export"><summary>Download</summary><div class="row" id="exportRow">' +
      '<button class="btn sm" id="csvBtn" type="button">This chart</button>' +
      '<button class="btn sm" id="pngBtn" type="button">PNG</button>' +
      '<button class="btn sm" id="histCsv" type="button">History</button>' +
      '<button class="btn sm" id="chainCsv" type="button">Sample chain</button>' +
      '</div></details>';
    document.getElementById('greekName').onchange = () => schedule();
    document.getElementById('csvBtn').onclick = () => download('fly-chart.csv', toCSV(window.__csv || []));
    document.getElementById('pngBtn').onclick = () => { if (window.Plotly) Plotly.downloadImage('chart', { format: 'png', filename: 'spx-fly' }); };
    document.getElementById('histCsv').onclick = () => {
      const h = F.historyChart(state, history);
      const tag = history.synthetic === false ? 'REAL' : 'SYNTHETIC';
      download(history.synthetic === false ? 'fly-history-snp.csv' : 'fly-history-synthetic.csv', toCSV([['source', tag]].concat(h.dates.map((d, i) => [d, h.fly[i], h.z[i], h.outcome5d[i]]))));
    };
    document.getElementById('chainCsv').onclick = () => download(history.synthetic === false ? 'snp-60d-chain.csv' : 'synthetic-spx-60d-sample.csv', F.chainCSV(history));
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
    document.getElementById('exportRow').appendChild(btn);
    document.getElementById('exportRow').appendChild(imp);
    syncPanels();
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

  function renderDayBar() {
    const sel = document.getElementById('dayPick');
    const key = (history.seed || '') + ':' + history.days.length + ':' + (history.days[0] ? history.days[0].date : '');
    if (sel && dayBarKey !== key) {
      dayBarKey = key;
      sel.innerHTML = history.days.map((d, i) => '<option value="' + i + '">' + d.date + '</option>').join('');
    }
    if (sel && document.activeElement !== sel && !state.viewWarmup) {
      const idx = Number.isFinite(state.sessionIndex) ? state.sessionIndex : history.days.length - 1;
      sel.value = String(idx);
    }
    const meta = document.getElementById('dayMeta');
    if (!meta) return;
    const open = state.viewWarmup
      ? 'Warm-up ' + state.asOf + ' is open. It is not in the scores.'
      : 'Open ' + (state.asOf || 'latest') + '. Scores use only earlier sessions.';
    const names = compareItems().map((item) => item.day.date);
    const extra = names.length ? ' Comparing ' + names.join(', ') + '.' : ' Tick rows in All days to compare up to six.';
    meta.textContent = open + ' ' + extra + (compareSet.length >= 6 ? ' Six is the limit.' : '');
  }
  function stepSession(dir) {
    if (state.viewWarmup) {
      const i = history.warmup.findIndex((d) => d.date === state.asOf);
      const at = i < 0 ? 0 : i;
      const next = at + dir;
      if (next >= 0 && next < history.warmup.length) openSession(next, true);
      else if (dir > 0 && history.days.length) openSession(0, false);
      return;
    }
    const at = Number.isFinite(state.sessionIndex) ? state.sessionIndex : history.days.length - 1;
    const next = at + dir;
    if (next >= 0 && next < history.days.length) openSession(next, false);
    else if (dir < 0 && history.warmup.length) openSession(history.warmup.length - 1, true);
  }
  function bookNoteText() {
    if (bookId !== 'real') return 'Synthetic 252-day study. The listed chains are not mixed into it.';
    const day = history.days[history.days.length - 1];
    const tenors = day && day.dteLo != null ? ' Last session blends the ' + day.dteLo + '-day and ' + day.dteHi + '-day expiries.' : '';
    return (history.ratesNote || '') + ' ' + (history.interpolation || '') + tenors;
  }
  function setBookButtons() {
    const syn = document.getElementById('bookSyn');
    const real = document.getElementById('bookReal');
    if (syn) syn.classList.toggle('active', bookId === 'synthetic');
    if (real) real.classList.toggle('active', bookId === 'real');
    const navFly = document.querySelector('.nav a[href="fly.html"]');
    const navReal = document.getElementById('navReal');
    if (navFly) navFly.classList.toggle('active', bookId !== 'real');
    if (navReal) navReal.classList.toggle('active', bookId === 'real');
  }
  function applyBook(next, id) {
    history = next;
    bookId = id;
    compareSet = [];
    pinnedState = null;
    paintSerial += 1;
    const keep = {
      wingMode: state.wingMode, strategy: state.strategy, deltaConv: state.deltaConv,
      sticky: state.sticky, tradeQty: state.tradeQty, priceConvention: state.priceConvention,
      flyQuote: state.flyQuote, centerMode: state.centerMode, wingDelta: state.wingDelta,
      centerDelta: state.centerDelta, centerSide: state.centerSide
    };
    state = F.linkToFinal(F.defaultState(), history);
    Object.assign(state, keep);
    if (state.centerMode === 'strike') state.centerK = F.forward(state);
    state.greekDials = F.zeroGreekDials();
    state.source = history.synthetic === false ? 'market' : 'synthetic';
    const note = document.getElementById('bookNote');
    if (note) note.textContent = bookNoteText();
    setBookButtons();
    write();
    render();
  }
  function useReal() {
    const token = ++bookToken;
    const note = document.getElementById('bookNote');
    if (realHistory) {
      applyBook(realHistory, 'real');
      return;
    }
    if (note) note.textContent = 'Building the constant 60-day smiles from the listed weekly chains…';
    fetch('data/snp-60d.json').then((res) => {
      if (!res.ok) throw new Error('missing');
      return res.json();
    }).then((payload) => {
      if (token !== bookToken) return;
      realHistory = F.ingestMarketHistory(payload);
      applyBook(realHistory, 'real');
    }).catch(() => {
      if (token !== bookToken) return;
      if (note) note.textContent = 'The real chain file did not load. The synthetic study is still available.';
    });
  }
  function syncBook() {
    if (location.hash === '#real') useReal();
    else if (bookId !== 'synthetic') applyBook(F.getHistory(), 'synthetic');
    else {
      const note = document.getElementById('bookNote');
      if (note) note.textContent = bookNoteText();
      setBookButtons();
    }
  }

  buildControls();
  buildChartChrome();
  write();
  render();
  document.getElementById('bookSyn').onclick = () => {
    bookToken += 1;
    if (location.hash) location.hash = '';
    else syncBook();
  };
  document.getElementById('bookReal').onclick = () => {
    if (location.hash !== '#real') location.hash = 'real';
    else useReal();
  };
  window.addEventListener('hashchange', syncBook);
  syncBook();
  document.getElementById('dayPrev').onclick = () => stepSession(-1);
  document.getElementById('dayNext').onclick = () => stepSession(1);
  document.getElementById('dayLast').onclick = () => openSession(history.days.length - 1, false);
  document.getElementById('dayPick').onchange = (ev) => openSession(parseInt(ev.target.value, 10), false);
  document.getElementById('dayAll').onclick = () => {
    bottomTab = 'days';
    render();
    const bottom = document.getElementById('bottom');
    if (bottom) bottom.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  document.getElementById('dayClear').onclick = () => {
    compareSet = [];
    render();
  };
  document.getElementById('dayFind').oninput = () => {
    bottomTab = 'days';
    render();
  };
  renderDayBar();
  window.addEventListener('resize', () => {
    const el = plotEl();
    if (!window.Plotly || !el || !el.data) return;
    const h = chartHeight();
    plotEls().forEach((node) => {
      node.style.height = h + 'px';
      if (node.data) Plotly.relayout(node, { height: h });
    });
  });
  document.addEventListener('keydown', (ev) => {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.key === '+' || ev.key === '=') { ev.preventDefault(); zoomAxes(0.8, 0.8); }
    else if (ev.key === '-' || ev.key === '_') { ev.preventDefault(); zoomAxes(1.25, 1.25); }
    else if (ev.key === '0') {
      ev.preventDefault();
      if (window.Plotly) plotEls().forEach((el) => { if (el.data) Plotly.relayout(el, { 'xaxis.autorange': true, 'yaxis.autorange': true }); });
    }
  });
})();
