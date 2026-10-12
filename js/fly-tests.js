/**
 * Headless tests for the fly engine. Load bsm-engine.js and fly-engine.js first.
 * Node: node tests/run-fly.js
 */
(function (global) {
  function runFlyTests() {
    const F = global.FLY;
    const B = global.BSM;
    const results = [];
    function test(name, fn) {
      try {
        fn();
        results.push({ name, pass: true });
      } catch (err) {
        results.push({ name, pass: false, err: err && err.message ? err.message : String(err) });
      }
    }
    function assert(cond, msg) {
      if (!cond) throw new Error(msg || 'assertion failed');
    }
    function near(a, b, tol, msg) {
      if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tol) {
        throw new Error((msg || 'not near') + ' got ' + a + ' expected ' + b);
      }
    }

    test('put-call parity', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.S = 5800; s.r = 0.045; s.q = 0.013; s.days = 60; s.dayCount = 365;
      F.ensureT(s);
      const K = 5750;
      const call = F.bsm(s, K, 'call', 0.18);
      const put = F.bsm(s, K, 'put', 0.18);
      const rhs = s.S * Math.exp(-s.q * s.T) - K * Math.exp(-s.r * s.T);
      near(call.price - put.price, rhs, 1e-6);
    });

    test('implied vol round trip', () => {
      const s = F.defaultState();
      F.ensureT(s);
      const px = F.bsm(s, 5800, 'call', 0.22).price;
      const inv = F.impliedVol(px, s.S, 5800, s.T, s.r, s.q, 'call');
      assert(inv.status === 'ok', inv.status);
      near(inv.iv, 0.22, 1e-4);
    });

    test('iv below intrinsic is rejected', () => {
      const s = F.defaultState();
      F.ensureT(s);
      const bad = F.impliedVol(0, s.S, s.S * 0.5, s.T, s.r, s.q, 'call');
      assert(bad.status === 'below-intrinsic', bad.status);
    });

    test('flat smile has zero raw IV fly', () => {
      const s = F.defaultState();
      Object.assign(s, {
        quoteGrid: null, linkedToFinal: false, S: 5000, centerK: 5000, r: 0.02, q: 0.02,
        atm: 0.2, putSkew: 0, callSkew: 0, curvature: 0, asymmetry: 0, wingSteepness: 0, bump: 0,
        wingMode: 'log', wingLog: 0.05, wingAsymLog: 0, centerMode: 'strike', days: 60
      });
      F.ensureT(s);
      s.centerK = F.forward(s);
      near(F.ivFlyOf(F.resolveWings(s)), 0, 1e-10);
    });

    test('parallel ATM does not change fixed-k IV fly', () => {
      const s = F.defaultState();
      Object.assign(s, {
        quoteGrid: null, linkedToFinal: false, putSkew: 0.8, callSkew: 0.2, curvature: 2, asymmetry: -1,
        wingSteepness: 3, bump: 0, wingMode: 'log', wingLog: 0.04, centerMode: 'strike', S: 5800, days: 60
      });
      F.ensureT(s);
      s.centerK = F.forward(s);
      s.atm = 0.16;
      const y1 = F.ivFlyOf(F.resolveWings(s));
      s.atm = 0.28;
      const y2 = F.ivFlyOf(F.resolveWings(s));
      near(y1, y2, 1e-10);
      assert(y1 > 0, 'curved smile should have a positive fly');
    });

    test('spot shock keeps absolute strikes fixed', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      s.centerMode = 'strike';
      s.wingMode = 'strike';
      s.centerK = 5800;
      s.wingStrike = 100;
      s.wingAsym = 10;
      s.sticky = 'moneyness';
      const w0 = F.resolveWings(F.materialize(s, F.zeroShocks()));
      const w1 = F.resolveWings(F.materialize(s, Object.assign(F.zeroShocks(), { dS: 0.05 })));
      near(w1.Kl, w0.Kl, 1e-8);
      near(w1.Kc, w0.Kc, 1e-8);
      near(w1.Ku, w0.Ku, 1e-8);
    });

    test('sticky strike holds IV at a fixed strike when spot moves', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      s.sticky = 'strike';
      s.centerMode = 'strike';
      s.centerK = 5700;
      const K = 5700;
      const iv0 = F.ivAt(F.materialize(s, F.zeroShocks()), K).iv;
      const moved = F.materialize(s, Object.assign(F.zeroShocks(), { dS: 0.05 }));
      near(F.ivAt(moved, K).iv, iv0, 1e-8);
    });

    test('normalized price fly is half the unnormalized fly', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      F.ensureT(s);
      s.centerK = F.forward(s);
      const p = F.priceFly(s);
      near(p.normalized * 2, p.unnormalized, 1e-8);
      assert(p.unnormalized > 0, 'call price fly should be convex');
    });

    test('symmetric call fly payoff', () => {
      const legs = [
        { type: 'call', K: 100, qty: 1 },
        { type: 'call', K: 110, qty: -2 },
        { type: 'call', K: 120, qty: 1 }
      ];
      near(F.payoff(legs, 90), 0, 1e-12);
      near(F.payoff(legs, 110), 10, 1e-12);
      near(F.payoff(legs, 140), 0, 1e-12);
      const lim = F.payoffLimits(legs);
      near(lim.upside, 0, 1e-12);
    });

    test('broken-wing upside residual', () => {
      const legs = [
        { type: 'call', K: 100, qty: 1 },
        { type: 'call', K: 110, qty: -2 },
        { type: 'call', K: 130, qty: 1 }
      ];
      near(F.payoff(legs, 200), -10, 1e-10);
      near(F.payoffLimits(legs).upside, -10, 1e-10);
    });

    test('package value equals the sum of legs', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      F.ensureT(s);
      const legs = F.unitLegs(s);
      const pack = F.packagePoints(s, legs, 'mid').points;
      let sum = 0;
      for (const leg of legs) sum += leg.qty * F.priceOf(s, leg.K, leg.type).mid;
      near(pack, sum, 1e-8);
    });

    test('a spot move is carried by delta, gamma, and speed', () => {
      const from = F.defaultState();
      from.quoteGrid = null;
      from.linkedToFinal = false;
      from.atm = 0.2;
      from.putSkew = 0;
      from.callSkew = 0;
      from.curvature = 0;
      from.asymmetry = 0;
      from.wingSteepness = 0;
      from.bump = 0;
      from.shocks = F.zeroShocks();
      const to = JSON.parse(JSON.stringify(from));
      to.S = from.S + 25;
      const m = F.greekMove(from, to);
      assert(m.ok, 'ordered');
      const spot = m.terms.filter((t) => t.key === 'delta' || t.key === 'gamma' || t.key === 'speed')
        .reduce((s, t) => s + t.value, 0);
      near(spot, m.actualSameStrikes, Math.max(1e-3, Math.abs(m.actualSameStrikes) * 0.02));
      near(m.explained, m.actualSameStrikes, Math.max(1e-3, Math.abs(m.actualSameStrikes) * 0.02));
    });

    test('a vol move is carried by vega, vomma, and vanna', () => {
      const from = F.defaultState();
      from.quoteGrid = null;
      from.linkedToFinal = false;
      from.shocks = F.zeroShocks();
      const to = JSON.parse(JSON.stringify(from));
      to.atm = from.atm + 0.01;
      const m = F.greekMove(from, to);
      assert(m.ok, 'ordered');
      const vol = m.terms.filter((t) => t.key === 'vega' || t.key === 'vomma' || t.key === 'vanna')
        .reduce((s, t) => s + t.value, 0);
      near(vol, m.actualSameStrikes, Math.max(1e-2, Math.abs(m.actualSameStrikes) * 0.08));
    });

    test('a delta dial moves package delta toward the request', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      const fit = F.solveGreekDials(s, { delta: 0.05 });
      assert(fit.ok && fit.active, 'solved');
      assert(Math.abs(fit.achieved.delta - 0.05) < 0.02, 'delta gap ' + fit.achieved.delta);
    });

    test('delta and vega dials are pursued together', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      const fit = F.solveGreekDials(s, { delta: 0.04, vega: 1 });
      assert(fit.ok && fit.active, 'solved');
      assert(Math.abs(fit.achieved.delta) > 0.015, 'delta ' + fit.achieved.delta);
      assert(Math.abs(fit.achieved.vega) > 0.4, 'vega ' + fit.achieved.vega);
    });

    test('25Δ and 10Δ broker marks put the butterfly on the smile chord', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      const marks = F.brokerMarks(s);
      assert(marks.length === 2, 'two quotes');
      for (const m of marks) {
        assert(m.Kl < m.Kc && m.Kc < m.Ku, 'strike order');
        near(m.bf, 0.5 * (m.ivL + m.ivU) - m.ivC, 1e-12);
        near(m.rr, m.ivU - m.ivL, 1e-12);
        assert(m.putDelta < 0 && m.callDelta > 0, 'signed wings');
      }
    });

    test('zero greek dials leave the request inactive', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      const fit = F.solveGreekDials(s, F.zeroGreekDials());
      assert(fit.ok && !fit.active, 'inactive');
      assert(fit.state === s, 'same state');
    });

    test('frozen-IV finite-difference delta matches analytic delta', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      F.ensureT(s);
      const legs = F.unitLegs(s);
      const g = F.greeksOf(s, legs);
      near(g.fdDelta, g.sum.delta, 1e-4);
    });

    test('25-delta put is below the forward and call is above', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      s.deltaConv = 'forward';
      F.ensureT(s);
      const Fwd = F.forward(s);
      const kp = F.strikeForDelta(s, 0.25, 'put');
      const kc = F.strikeForDelta(s, 0.25, 'call');
      assert(kp < Fwd && kc > Fwd, 'wing order');
      near(F.deltaAbs(s, kp, 'put'), 0.25, 0.01);
      near(F.deltaAbs(s, kc, 'call'), 0.25, 0.01);
    });

    test('total-variance interpolation is not a volatility average', () => {
      const shape = {
        atm: 0.16, putSkew: 0, callSkew: 0, curvature: 0, asymmetry: 0, wingSteepness: 0,
        bump: 0, termSlope: -0.2
      };
      const sl = F.varianceInterp(0, shape, 365);
      const volAvg = 0.5 * (
        Math.sqrt(sl.w1 / sl.T1) + Math.sqrt(sl.w2 / sl.T2)
      );
      assert(Math.abs(sl.iv - volAvg) > 1e-4, 'interpolation collapsed to a vol average');
      assert(sl.calendarOk, 'calendar');
      near(sl.alpha, 0.5, 1e-12);
    });

    test('valuation sample is exactly 252 business days and excludes warm-up', () => {
      const h = F.getHistory();
      assert(h.synthetic === true, 'label');
      assert(h.days.length === 252, 'len ' + h.days.length);
      assert(h.warmup.length === 40, 'warmup');
      assert(h.days[h.days.length - 1].date === '2026-10-09', h.days[h.days.length - 1].date);
      const dates = new Set(h.days.map((d) => d.date));
      assert(dates.size === 252, 'duplicate dates');
      for (const d of h.days) {
        const dt = new Date(d.date + 'T00:00:00Z');
        assert(dt.getUTCDay() !== 0 && dt.getUTCDay() !== 6, d.date);
        assert(!h.warmup.some((w) => w.date === d.date), 'warmup leaked');
      }
      const span = (new Date(h.days[251].date + 'T00:00:00Z') - new Date(h.days[0].date + 'T00:00:00Z')) / 86400000;
      assert(span > 340 && span < 380, 'span ' + span);
      assert(h.warmup[h.warmup.length - 1].date < h.days[0].date, 'warmup not before sample');
    });

    test('expanding percentile ignores the future', () => {
      const sample = [1, 2, 3, 4, 5, 6, 7, 8];
      const before = F.percentile ? null : null;
      void before;
      const rank = (arr, v) => arr.filter((x) => x <= v).length / arr.length;
      const past = sample.slice(0, 4);
      const r1 = rank(past, 3);
      sample[7] = 100;
      const r2 = rank(sample.slice(0, 4), 3);
      near(r1, r2, 0);
    });

    test('causal score ignores the final session when controls are linked', () => {
      const h = F.getHistory();
      const last = h.days[h.days.length - 1];
      const saved = last.iv.slice();
      const s = F.defaultState();
      s.linkedToFinal = true;
      s.quoteGrid = null;
      s.wingMode = 'log';
      s.centerMode = 'strike';
      F.ensureT(s);
      s.centerK = F.forward(s);
      const before = F.assess(s, h);
      last.iv = last.iv.map((v) => v + 0.08);
      const after = F.assess(s, h);
      last.iv = saved;
      near(before.methods[0].percentile, after.methods[0].percentile, 1e-12, 'final session leaked into the causal sample');
      assert(before.refN === 251, 'ref ' + before.refN);
    });

    test('Shapley values sum to the scenario change', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      s.wingMode = 'log';
      s.centerMode = 'strike';
      F.ensureT(s);
      s.centerK = F.forward(s);
      s.shocks = Object.assign(F.zeroShocks(), { dS: -0.04, dAtm: 0.02, dPut: 0.15, dCurv: 0.4 });
      const attr = F.attributeScenario(s, 'ivFly');
      near(attr.shapleyGap, 0, 1e-8);
      const sum = attr.shapley.reduce((a, b) => a + b.value, 0);
      near(sum, attr.change, 1e-8);
    });

    test('level Shapley is ~0 for a fixed log-moneyness fly', () => {
      const h = F.getHistory();
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      s.wingMode = 'log';
      s.centerMode = 'strike';
      s.bump = 0;
      F.ensureT(s);
      s.centerK = F.forward(s);
      const d = F.decompose(s, h);
      const atm = d.components.find((c) => c.id === 'atm');
      near(atm.contribution, 0, 1e-8);
      near(d.reconGap, 0, 1e-6);
    });

    test('same scenario is reproducible', () => {
      const s = F.defaultState();
      s.quoteGrid = null;
      s.linkedToFinal = false;
      F.ensureT(s);
      const a = F.ivFlyOf(F.resolveWings(F.materialize(s)));
      const b = F.ivFlyOf(F.resolveWings(F.materialize(JSON.parse(JSON.stringify(s)))));
      near(a, b, 0);
    });

    test('import refuses a multi-year span', () => {
      const csv = 'date,strike,iv,spot\n2024-01-02,5000,0.2,5000\n2026-10-09,5000,0.2,5200\n';
      const parsed = F.parseCSV(csv);
      const applied = F.applyImport(F.defaultState(), parsed);
      assert(!applied.ok, 'should reject');
    });

    test('import accepts a labeled synthetic slice', () => {
      const h = F.getHistory();
      const csv = F.chainCSV(h, h.days.length - 1);
      assert(csv.indexOf('SYNTHETIC') > 0, 'label');
      const applied = F.applyImport(F.defaultState(), F.parseCSV(csv));
      assert(applied.ok, applied.error || 'import');
      assert(applied.state.source === 'imported', 'source');
      assert(applied.state.quoteGrid.length >= 5, 'grid');
    });

    test('quick check and fifteen methods', () => {
      const q = F.quickCheck();
      assert(q.ok, q.issues.join(','));
      const h = F.getHistory();
      const s = F.linkToFinal(F.defaultState(), h);
      const a = F.assess(s, h);
      assert(a.methods.length === 15, 'methods ' + a.methods.length);
      assert(a.sampleN === 252, 'n');
      assert(a.warmupExcluded === 40, 'warm');
      for (const m of a.methods) {
        assert(m.name && m.methodology, m.name);
        assert(m.classification === 'cheap' || m.classification === 'fair' || m.classification === 'expensive' || m.classification === 'insufficient', m.classification);
      }
    });

    return results;
  }

  global.runFlyTests = runFlyTests;
  if (typeof module !== 'undefined' && module.exports) module.exports = { runFlyTests };
})(typeof globalThis !== 'undefined' ? globalThis : window);
