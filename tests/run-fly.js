const path = require('path');
const root = path.join(__dirname, '..');
require(path.join(root, 'js', 'bsm-engine.js'));
require(path.join(root, 'js', 'fly-engine.js'));
require(path.join(root, 'js', 'fly-tests.js'));
const results = globalThis.runFlyTests();
let failed = 0;
for (const r of results) {
  if (r.pass) console.log('PASS  ' + r.name);
  else {
    failed++;
    console.log('FAIL  ' + r.name + '\n      ' + r.err);
  }
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
if (!failed) {
  const fs = require('fs');
  const payload = JSON.parse(fs.readFileSync(path.join(root, 'data', 'snp-60d.json'), 'utf8'));
  const h = globalThis.FLY.ingestMarketHistory(payload);
  const day = h.days[h.days.length - 1];
  const problems = [];
  if (h.synthetic !== false) problems.push('synthetic flag');
  if (h.days.length !== 252) problems.push('valuation ' + h.days.length);
  if (h.warmup.length !== 40) problems.push('warmup ' + h.warmup.length);
  const syn = globalThis.FLY.getHistory();
  if (syn.synthetic === false || syn.days.length !== 252) problems.push('synthetic cache was replaced');
  if (!(day.S > 7000)) problems.push('spot ' + day.S);
  if (!(day.r > 0 && day.r < 0.12 && day.q > -0.02 && day.q < 0.2)) problems.push('rates');
  const ivNear = (k) => {
    let best = NaN, gap = 1;
    for (let i = 0; i < day.ks.length; i++) {
      const d = Math.abs(day.ks[i] - k);
      if (d < gap) { gap = d; best = day.iv[i]; }
    }
    return best;
  };
  if (!(ivNear(-0.04) > ivNear(0) && ivNear(0) > ivNear(0.04))) problems.push('put skew missing on the last session');
  if (!Number.isFinite(day.fly25)) problems.push('25 delta fly');
  const s = globalThis.FLY.linkToFinal(globalThis.FLY.defaultState(), h);
  const a = globalThis.FLY.assess(s, h);
  if (a.methods.length !== 15 || a.sampleN !== 252 || a.warmupExcluded !== 40) problems.push('scores');
  const smile = globalThis.FLY.smileSeries(s, h);
  if (!smile.histMean.length || smile.histMean.some((v) => !Number.isFinite(v))) problems.push('pca');
  const marks = globalThis.FLY.brokerMarks(s);
  if (!marks.some((m) => Math.abs(m.delta - 0.25) < 1e-9)) problems.push('25 delta marks');
  if (problems.length) {
    console.log('FAIL  real SNP book\n      ' + problems.join('; '));
    process.exit(1);
  }
  console.log('PASS  real SNP book ' + h.days[0].date + ' → ' + day.date + ' spot ' + day.S);
  const stickyPath = path.join(root, 'data', 'sticky-60d.json');
  const stickyPayload = JSON.parse(fs.readFileSync(stickyPath, 'utf8'));
  const hs = globalThis.FLY.ingestMarketHistory(stickyPayload);
  const last = hs.days[hs.days.length - 1];
  const stickyProblems = [];
  if (hs.synthetic !== false) stickyProblems.push('synthetic flag');
  if (hs.family !== 'sticky-delta') stickyProblems.push('family ' + hs.family);
  if (hs.days.length !== 252) stickyProblems.push('valuation ' + hs.days.length);
  if (hs.warmup.length !== 40) stickyProblems.push('warmup ' + hs.warmup.length);
  if (last.date !== '2026-10-12') stickyProblems.push('last ' + last.date);
  if (!(last.S > 7000)) stickyProblems.push('spot ' + last.S);
  if (last.r !== 0 || last.q !== 0) stickyProblems.push('rates ' + last.r + ' ' + last.q);
  const mark25 = (last.stickyMarks || []).filter((m) => Math.abs(m.delta - 0.25) < 1e-9)[0];
  const mark10 = (last.stickyMarks || []).filter((m) => Math.abs(m.delta - 0.10) < 1e-9)[0];
  if (!mark25 || !mark10) stickyProblems.push('stored marks');
  if (mark25 && Math.abs(last.fly25 - mark25.bf) > 1e-8) stickyProblems.push('fly25 ' + last.fly25);
  if (mark25 && Math.abs(mark25.bf - (0.5 * (mark25.ivL + mark25.ivU) - mark25.ivC)) > 1e-8) stickyProblems.push('bf identity');
  const ss = globalThis.FLY.linkToFinal(globalThis.FLY.defaultState(), hs);
  if (ss.r !== 0 || ss.q !== 0) stickyProblems.push('state rates');
  const boardMarks = globalThis.FLY.brokerMarks(ss);
  if (boardMarks.length !== 2) stickyProblems.push('broker ' + boardMarks.length);
  const smileS = globalThis.FLY.smileSeries(ss, hs);
  if (!smileS.histMean.length || smileS.histMean.some((v) => !Number.isFinite(v))) stickyProblems.push('pca');
  const scored = globalThis.FLY.assess(ss, hs);
  if (scored.methods.length !== 15 || scored.sampleN !== 252 || scored.warmupExcluded !== 40) stickyProblems.push('scores');
  const syn2 = globalThis.FLY.getHistory();
  if (syn2.synthetic === false || syn2.days.length !== 252) stickyProblems.push('synthetic cache was replaced');
  const day1006 = hs.days.concat(hs.warmup).filter((d) => d.date === '2026-10-06')[0];
  if (!day1006) stickyProblems.push('missing 2026-10-06');
  else {
    const atm = day1006.iv.reduce((best, v, i) => (Math.abs(day1006.ks[i]) < Math.abs(best.k) ? { k: day1006.ks[i], v } : best), { k: 9, v: NaN });
    if (!(atm.v > 0.12 && atm.v < 0.14)) stickyProblems.push('2026-10-06 atm ' + atm.v);
    const m = day1006.stickyMarks.filter((x) => Math.abs(x.delta - 0.25) < 1e-9)[0];
    if (!m || !(m.ivL > m.ivU)) stickyProblems.push('2026-10-06 put wing');
  }
  if (stickyProblems.length) {
    console.log('FAIL  sticky plus SNP book\n      ' + stickyProblems.join('; '));
    process.exit(1);
  }
  console.log('PASS  sticky plus SNP book ' + hs.days[0].date + ' → ' + last.date + ' spot ' + last.S + ' 25Δ bf ' + last.fly25);
}
process.exit(failed ? 1 : 0);
