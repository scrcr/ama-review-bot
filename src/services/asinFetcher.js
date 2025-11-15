const { loadRegionConfig, getCategoryUrl, getCategories } = require("../config");
const { insertProducts, listKnownAsins } = require("../models/products");
const logger = require("../utils/logger");

function extractProductsFromHtml(html, domain, limit) {
  const asinRegex = /data-asin="([A-Z0-9]{10})"/g;
  const titleRegex = /<span class="a-size-medium a-color-base a-text-normal">([^<]+)<\/span>/g;

  const asins = [];
  let match;
  while ((match = asinRegex.exec(html)) !== null) {
    const asin = match[1];
    if (!asin || asin === "" || asin === "NONE") continue;
    if (!asins.includes(asin)) {
      asins.push(asin);
    }
    if (asins.length >= limit) break;
  }

  const titles = [];
  while ((match = titleRegex.exec(html)) !== null) {
    titles.push(match[1]);
  }

  return asins.map((asin, index) => ({
    asin,
    title: titles[index] || `Product ${asin}`,
    url: `https://www.${domain}/dp/${asin}`,
  }));
}

function pickWeightedCategory(weights = {}) {
  const categories = getCategories();
  const entries = categories
    .map((category) => {
      const weight = Number(weights[category] ?? 1);
      return { category, weight: Number.isFinite(weight) && weight > 0 ? weight : 0 };
    })
    .filter((entry) => entry.weight > 0);

  if (!entries.length) {
    throw new Error("No positive category weights configured");
  }

  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let threshold = Math.random() * total;
  for (const entry of entries) {
    threshold -= entry.weight;
    if (threshold <= 0) {
      return entry.category;
    }
  }

  return entries[entries.length - 1].category;
}

async function fetchAsins(region, { limit = 20, category: categoryOverride } = {}) {
  const regionConfig = loadRegionConfig(region);
  const categoryWeights = regionConfig.category_weights || {};
  const category = categoryOverride || pickWeightedCategory(categoryWeights);
  const categoryUrl = getCategoryUrl(region, category);

  logger.info("Fetching ASINs", { region, category, categoryUrl });

  const response = await fetch(categoryUrl, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; AMAReviewBot/1.0)",
      accept: "text/html",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ASIN list (${response.status})`);
  }

  const html = await response.text();
  const scrapedProducts = extractProductsFromHtml(html, regionConfig.domain, limit * 2);

  const knownAsins = await listKnownAsins(region);
  const freshProducts = scrapedProducts.filter((product) => !knownAsins.includes(product.asin)).slice(0, limit);

  if (freshProducts.length) {
    await insertProducts(
      region,
      freshProducts.map((product) => ({
        asin: product.asin,
        title: product.title,
        imageUrl: `https://images-na.ssl-images-amazon.com/images/P/${product.asin}.jpg`,
      }))
    );
  }

  logger.info("ASIN fetch complete", { region, category, requested: limit, stored: freshProducts.length });
  return freshProducts;
}

module.exports = {
  fetchAsins,
  pickWeightedCategory,
};
