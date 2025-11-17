const { testNormalizeHelpful } = require('./reviewScraper.test');

function run() {
  console.log('Running normalizeHelpful tests...');
  testNormalizeHelpful();
  console.log('\nAll tests passed.');
}

if (require.main === module) {
  run();
}

module.exports = { run };
