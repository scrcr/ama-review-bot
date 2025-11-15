const { loadRegionConfig } = require("../config");
const { listTopReviews } = require("../models/reviews");
const { enqueuePost } = require("../models/postQueue");
const { getProduct } = require("../models/products");
const { renderTemplate } = require("./templates");
const logger = require("../utils/logger");

async function createPostQueue(region, { maxPosts = 3 } = {}) {
  const regionConfig = loadRegionConfig(region);
  const reviews = await listTopReviews(region, maxPosts);
  const results = [];

  for (const review of reviews) {
    const product = await getProduct(region, review.asin);
    if (!product) {
      logger.warn("Product missing for review", { region, asin: review.asin });
      continue;
    }

    const highlight = review.highlight_text || review.highlightText || "";
    const summary = review.summary_text || review.summaryText || "";
    const language = review.language || regionConfig.language;

    if (!highlight || !summary) {
      logger.warn("Skipping review without highlight or summary", { region, asin: review.asin });
      continue;
    }

    const affiliateId = regionConfig.affiliate_id;
    const text = renderTemplate(language, {
      title: product.title,
      highlight,
      summary,
      domain: regionConfig.domain,
      asin: review.asin,
      affiliateId,
      affid: affiliateId,
    });

    const postId = await enqueuePost(region, review.asin, text);
    results.push({ id: postId, asin: review.asin });
  }

  logger.info("Post queue created", { region, count: results.length });
  return results;
}

module.exports = {
  createPostQueue,
};
