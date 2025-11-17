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
const { normalizeProduct } = require("../src/services/productNormalizer");

async function runProductNormalizerTests() {
  const basePayload = {
    source: {
      asin: "B0SOURCE01",
      title: "静音 小型 加湿器 2.4L",
      brand: "MoriTech",
      region: "jp",
    },
    target_region: "us",
    config: {
      missing_mode: "skip",
      similarity_threshold: 0.7,
    },
    reviewText: "This quiet compact humidifier keeps my office fresh.",
  };

  const exactResult = await normalizeProduct(basePayload, {
    dependencies: {
      fetchImpl: async () => ({
        status: 200,
        text: async () => "<title>Quiet Mini Humidifier</title>",
      }),
      searchProducts: async () => [],
    },
  });
  assert.strictEqual(exactResult.reason, "exact_match", "Exact match should short-circuit");

  const similarResult = await normalizeProduct(basePayload, {
    dependencies: {
      fetchImpl: async () => ({ status: 404, text: async () => "" }),
      translateToEnglish: async () => "Silent Mini Humidifier 2.4L",
      searchProducts: async ({ query }) => {
        if (query.includes("静音") || query.includes("Silent")) {
          return [
            { asin: "B0SIM0001", title: "Silent Mini Humidifier", brand: "MoriTech" },
          ];
        }
        return [];
      },
    },
  });
  assert.strictEqual(similarResult.reason, "similar_match", "Should accept similar match when over threshold");

  const forcedResult = await normalizeProduct(
    { ...basePayload, config: { missing_mode: "similar", similarity_threshold: 0.95 } },
    {
      dependencies: {
        fetchImpl: async () => ({ status: 404, text: async () => "" }),
        searchProducts: async () => [{ asin: "B0FORCE01", title: "Basic Humidifier" }],
      },
    },
  );
  assert.strictEqual(forcedResult.reason, "forced_similar", "Missing similar mode should force return");

  const skipped = await normalizeProduct(basePayload, {
    dependencies: {
      fetchImpl: async () => ({ status: 404, text: async () => "" }),
      searchProducts: async () => [],
    },
  });
  assert.strictEqual(skipped.status, "skipped", "Skip mode should skip when no candidate");

  const noLink = await normalizeProduct(
    { ...basePayload, config: { missing_mode: "nolink" } },
    {
      dependencies: {
        fetchImpl: async () => ({ status: 404, text: async () => "" }),
        searchProducts: async () => [],
      },
    },
  );
  assert.strictEqual(noLink.status, "no_match", "Nolink mode should return no_match status");

  const suggest = await normalizeProduct(
    { ...basePayload, config: { missing_mode: "suggest" } },
    {
      dependencies: {
        fetchImpl: async () => ({ status: 404, text: async () => "" }),
        searchProducts: async ({ query }) => {
          if (query.includes("cleaning") || query.includes("quiet")) {
            return [
              { asin: "B0SUGGEST", title: "Quiet Cleaning Companion" },
            ];
          }
          return [];
        },
        extractFeaturesFromReview: () => ({ purpose: "cleaning", attributes: ["quiet"] }),
      },
    },
  );
  assert.strictEqual(suggest.reason, "suggested_match", "Suggest mode should surface fallback match");
}

async function run() {
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

  assert.deepStrictEqual(
    getActiveRegions().sort(),
    regions.sort(),
    "Default active regions should match supported regions",
  );

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
    "Products table should scope ASIN uniqueness per region",
  );

  assert.strictEqual(
    normalizeHelpful("One person found this helpful"),
    1,
    "Should parse English singular helpful count",
  );
  assert.strictEqual(
    normalizeHelpful("Eine Person fand dies hilfreich"),
    1,
    "Should parse German singular helpful count",
  );
  assert.strictEqual(
    normalizeHelpful("2 Personen fanden das hilfreich"),
    2,
    "Should parse numeric helpful count",
  );

  assert.deepStrictEqual(
    BLOCK_TIMES_JST,
    ["02:00", "06:00", "10:00", "14:00", "18:00", "22:00"],
    "Posting blocks must match specification",
  );

  const blockDate = new Date(Date.UTC(2024, 0, 1, 17, 0));
  assert(isBlockTime(blockDate), "Expected 02:00 JST to be recognised as a block time");
  const nonBlockDate = new Date(Date.UTC(2024, 0, 1, 17, 30));
  assert(!isBlockTime(nonBlockDate), "Non block minutes should not trigger block execution");

  await runProductNormalizerTests();

  // eslint-disable-next-line no-console
  console.log("Smoke test passed");
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
