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
}
process.exit(failed ? 1 : 0);
