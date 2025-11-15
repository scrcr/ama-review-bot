#!/usr/bin/env node
const { Command } = require("commander");
const { fetchAsins } = require("./services/asinFetcher");
const { fetchReviews } = require("./services/reviewScraper");
const { processReview } = require("./services/nlpProcessor");
const { createPostQueue } = require("./services/postQueue");
const { runForRegion, runAllRegions } = require("./pipeline");
const { loadRegionConfig, getCategories } = require("./config");
const { executePostingBlock, isBlockTime, BLOCK_TIMES_JST } = require("./scheduler");
const logger = require("./utils/logger");

const program = new Command();
program.name("ama-review-bot").description("Amazon long-tail review bot (Node.js)");

function ensureRegion(region) {
  loadRegionConfig(region);
  return region;
}

function ensureCategory(category) {
  if (!category) return undefined;
  const categories = getCategories();
  if (!categories.includes(category)) {
    throw new Error(`Unsupported category: ${category}`);
  }
  return category;
}

program
  .command("fetch-asins")
  .description("Fetch ASINs for a region")
  .requiredOption("-r, --region <region>", "Region key")
  .option("-c, --category <category>", "Category override")
  .option("-l, --limit <limit>", "Number of ASINs", (value) => Number.parseInt(value, 10), 20)
  .action(async (options) => {
    const region = ensureRegion(options.region);
    const category = ensureCategory(options.category);
    const products = await fetchAsins(region, { limit: options.limit, category });
    logger.info("Fetched ASINs", { region, category: category || "weighted", count: products.length });
  });

program
  .command("fetch-reviews")
  .description("Fetch reviews for an ASIN")
  .requiredOption("-r, --region <region>", "Region key")
  .requiredOption("-a, --asin <asin>", "ASIN")
  .option("-l, --limit <limit>", "Number of reviews", (value) => Number.parseInt(value, 10), 20)
  .action(async (options) => {
    const region = ensureRegion(options.region);
    const reviews = await fetchReviews(region, options.asin, { limit: options.limit });
    logger.info("Fetched reviews", { region, asin: options.asin, count: reviews.length });
  });

program
  .command("process-reviews")
  .description("Fetch + process reviews for an ASIN")
  .requiredOption("-r, --region <region>", "Region key")
  .requiredOption("-a, --asin <asin>", "ASIN")
  .option("-l, --limit <limit>", "Number of reviews", (value) => Number.parseInt(value, 10), 10)
  .action(async (options) => {
    const region = ensureRegion(options.region);
    const reviews = await fetchReviews(region, options.asin, { limit: options.limit });
    for (const review of reviews) {
      await processReview(region, options.asin, review);
    }
    logger.info("Processed reviews", { region, asin: options.asin, count: reviews.length });
  });

program
  .command("create-posts")
  .description("Generate post queue entries from high sentiment reviews")
  .requiredOption("-r, --region <region>", "Region key")
  .option("-m, --max <max>", "Max posts", (value) => Number.parseInt(value, 10), 3)
  .action(async (options) => {
    const region = ensureRegion(options.region);
    const posts = await createPostQueue(region, { maxPosts: options.max });
    logger.info("Queued posts", { region, count: posts.length });
  });

program
  .command("post-block")
  .description("Execute one Twitter posting block for all active regions")
  .option("--force", "Force execution even if current time is outside the JST block schedule")
  .action(async (options) => {
    const now = new Date();
    const force = Boolean(options.force);
    if (!force && !isBlockTime(now)) {
      logger.warn("Current time is not a configured posting block", {
        currentJst: now.toISOString(),
        allowedBlocks: BLOCK_TIMES_JST,
      });
      return;
    }

    const results = await executePostingBlock(now, { force });
    logger.info("Posting block finished", { posted: results.length });
  });

program
  .command("pipeline")
  .description("Run full pipeline for one or all regions")
  .option("-r, --region <region>", "Optional region")
  .option("--asin-limit <limit>", "ASIN limit", (value) => Number.parseInt(value, 10), 20)
  .option("--review-limit <limit>", "Review limit", (value) => Number.parseInt(value, 10), 20)
  .option("--posts-limit <limit>", "Post limit", (value) => Number.parseInt(value, 10), 3)
  .action(async (options) => {
    if (options.region) {
      ensureRegion(options.region);
      await runForRegion(options.region, {
        asinLimit: options.asinLimit,
        reviewLimit: options.reviewLimit,
        postsLimit: options.postsLimit,
      });
      return;
    }

    await runAllRegions({
      asinLimit: options.asinLimit,
      reviewLimit: options.reviewLimit,
      postsLimit: options.postsLimit,
    });
  });

program.parseAsync(process.argv).catch((error) => {
  logger.error("CLI command failed", { error: error.message });
  process.exitCode = 1;
});
