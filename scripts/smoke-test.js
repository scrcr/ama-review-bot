const assert = require("assert");
const path = require("path");
const fs = require("fs");

const {
  getSupportedRegions,
  getActiveRegions,
  loadRegionConfig,
  getCategories,
} = require("../src/config");
const { renderTemplate } = require("../src/services/templates");
const { normalizeHelpful } = require("../src/services/reviewScraper");
const { BLOCK_TIMES_JST, isBlockTime } = require("../src/scheduler");

const regions = getSupportedRegions();
assert.deepStrictEqual(
  regions.sort(),
  ["au", "ca", "eu", "in", "jp", "uk", "us"],
  "Unexpected supported regions list",
);

const previousActive = process.env.ACTIVE_REGIONS;
process.env.ACTIVE_REGIONS = "jp,us";
assert.deepStrictEqual(getActiveRegions(), ["jp", "us"], "ACTIVE_REGIONS override should narrow the list");
if (previousActive === undefined) {
  delete process.env.ACTIVE_REGIONS;
} else {
  process.env.ACTIVE_REGIONS = previousActive;
}

assert.deepStrictEqual(getActiveRegions().sort(), regions.sort(), "Default active regions should match supported regions");

regions.forEach((region) => {
  const config = loadRegionConfig(region);
  assert.ok(config.domain, `Region ${region} must have a domain`);
  assert.ok(config.language, `Region ${region} must have a language`);
  assert.ok(config.category_weights, `Region ${region} must have category weights`);
});

const categories = getCategories();
assert(categories.length >= 10, "Expected a broad list of categories");

const sample = renderTemplate("ja", {
  title: "テスト商品",
  highlight: "半年悩んで買ったけど、これは本物だった。",
  summary: "Problem → Solution → Result",
  domain: "amazon.co.jp",
  asin: "TESTASIN",
  affiliateId: "test",
});

assert(sample.includes("TESTASIN"), "Template should include ASIN");

const schema = fs.readFileSync(path.resolve(__dirname, "../db/schema.sql"), "utf-8");
assert(schema.includes("region VARCHAR(10) NOT NULL"), "Schema must include region column");
assert(
  schema.includes("UNIQUE KEY uniq_products_region_asin (region, asin)"),
  "Products table should scope ASIN uniqueness per region"
);

assert.strictEqual(
  normalizeHelpful("One person found this helpful"),
  1,
  "Should parse English singular helpful count"
);
assert.strictEqual(
  normalizeHelpful("Eine Person fand dies hilfreich"),
  1,
  "Should parse German singular helpful count"
);
assert.strictEqual(
  normalizeHelpful("2 Personen fanden das hilfreich"),
  2,
  "Should parse numeric helpful count"
);

assert.deepStrictEqual(
  BLOCK_TIMES_JST,
  ["02:00", "06:00", "10:00", "14:00", "18:00", "22:00"],
  "Posting blocks must match specification"
);

const blockDate = new Date(Date.UTC(2024, 0, 1, 17, 0));
assert(isBlockTime(blockDate), "Expected 02:00 JST to be recognised as a block time");
const nonBlockDate = new Date(Date.UTC(2024, 0, 1, 17, 30));
assert(!isBlockTime(nonBlockDate), "Non block minutes should not trigger block execution");

// eslint-disable-next-line no-console
console.log("Smoke test passed");
