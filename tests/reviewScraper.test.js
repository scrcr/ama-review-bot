const assert = require('assert');
const { normalizeHelpful } = require('../src/services/reviewScraper');

function testNormalizeHelpful() {
  const cases = [
    {
      name: 'returns numeric counts when digits are present',
      actual: normalizeHelpful('10 people found this helpful'),
      expected: 10,
    },
    {
      name: 'handles spelled out english singular counts',
      actual: normalizeHelpful('One person found this helpful'),
      expected: 1,
    },
    {
      name: 'handles german singular counts via locale hint',
      actual: normalizeHelpful('Eine Person fand dies hilfreich', 'de-DE'),
      expected: 1,
    },
    {
      name: 'handles german singular counts without locale hint',
      actual: normalizeHelpful('ein kunde fand dies hilfreich'),
      expected: 1,
    },
    {
      name: 'handles other locales with digits',
      actual: normalizeHelpful('10 personnes ont trouvé cela utile'),
      expected: 10,
    },
    {
      name: 'returns zero when no helpful information is present',
      actual: normalizeHelpful('Not helpful at all'),
      expected: 0,
    },
    {
      name: 'supports thousands separators in numeric strings',
      actual: normalizeHelpful('1.234 Personen fanden das hilfreich'),
      expected: 1234,
    },
    {
      name: 'handles spanish feminine singular count',
      actual: normalizeHelpful('Una persona encontró esto útil', 'es'),
      expected: 1,
    },
  ];

  for (const testCase of cases) {
    assert.strictEqual(testCase.actual, testCase.expected, testCase.name);
    console.log(`✓ ${testCase.name}`);
  }
}

module.exports = { testNormalizeHelpful };
