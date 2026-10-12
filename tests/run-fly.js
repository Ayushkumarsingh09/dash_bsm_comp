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
process.exit(failed ? 1 : 0);
