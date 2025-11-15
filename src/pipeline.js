const { getActiveRegions } = require("./config");
const { fetchAsins } = require("./services/asinFetcher");
const { fetchReviews } = require("./services/reviewScraper");
const { processReview } = require("./services/nlpProcessor");
const { createPostQueue } = require("./services/postQueue");
const logger = require("./utils/logger");

async function runForRegion(region, options = {}) {
  const {
    asinLimit = 20,
    reviewLimit = 20,
    postsLimit = 3,
  } = options;

  logger.info("Pipeline start", { region });

  const asins = await fetchAsins(region, { limit: asinLimit });
  const targets = asins.length ? asins : await (async () => {
    logger.info("No fresh ASINs scraped, skipping review collection", { region });
    return [];
  })();

  for (const product of targets) {
    try {
      const reviews = await fetchReviews(region, product.asin, { limit: reviewLimit });
      for (const review of reviews) {
        await processReview(region, product.asin, review);
      }
    } catch (error) {
      logger.error("Failed processing reviews for product", {
        region,
        asin: product.asin,
        error: error.message,
      });
    }
  }

  await createPostQueue(region, { maxPosts: postsLimit });
  logger.info("Pipeline complete", { region });
}

async function runAllRegions(options = {}) {
  const regions = getActiveRegions();
  for (const region of regions) {
    try {
      await runForRegion(region, options);
    } catch (error) {
      logger.error("Pipeline failed for region", { region, error: error.message });
    }
  }
}

if (require.main === module) {
  runAllRegions().catch((error) => {
    logger.error("Pipeline crashed", { error: error.message });
    process.exitCode = 1;
  });
}

module.exports = {
  runForRegion,
  runAllRegions,
};
