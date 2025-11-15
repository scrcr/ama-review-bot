const logger = require("./utils/logger");
const { formatJstTime, getJstDayRange, JST_TIMEZONE } = require("./utils/time");
const { getActiveRegions, loadRegionConfig } = require("./config");
const { fetchAsins, pickWeightedCategory } = require("./services/asinFetcher");
const { fetchReviews } = require("./services/reviewScraper");
const { processReview } = require("./services/nlpProcessor");
const { renderTemplate } = require("./services/templates");
const { postTweet } = require("./services/twitterBot");
const {
  recordPostedTweet,
  listPostedTweets,
  getMostRecentPosted,
} = require("./models/postQueue");
const { listProducts } = require("./models/products");

const BLOCK_TIMES_JST = ["02:00", "06:00", "10:00", "14:00", "18:00", "22:00"];
function isBlockTime(date = new Date()) {
  const time = formatJstTime(date);
  return BLOCK_TIMES_JST.includes(time);
}

function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

async function getTweetHistory(currentDate) {
  const { startUtc, endUtc } = getJstDayRange(currentDate);
  const todaysPosts = await listPostedTweets({ start: startUtc, end: endUtc });
  const todaysTexts = new Set(todaysPosts.map((post) => post.postText));
  const todaysAsinsByRegion = new Map();
  const todaysGlobalAsins = new Set(todaysPosts.map((post) => post.asin));

  todaysPosts.forEach((post) => {
    if (!todaysAsinsByRegion.has(post.region)) {
      todaysAsinsByRegion.set(post.region, new Set());
    }
    todaysAsinsByRegion.get(post.region).add(post.asin);
  });

  const regions = getActiveRegions();
  regions.forEach((region) => {
    if (!todaysAsinsByRegion.has(region)) {
      todaysAsinsByRegion.set(region, new Set());
    }
  });

  const lastGlobalPost = await getMostRecentPosted();
  const lastPostByRegion = new Map();
  await Promise.all(
    regions.map(async (region) => {
      const record = await getMostRecentPosted(region);
      if (record) {
        lastPostByRegion.set(region, record);
      }
    })
  );

  return {
    todaysPosts,
    todaysTexts,
    todaysAsinsByRegion,
    todaysGlobalAsins,
    lastGlobalPost,
    lastPostByRegion,
    startUtc,
    endUtc,
  };
}

function buildAffiliateUrl(regionConfig, asin) {
  return `https://www.${regionConfig.domain}/dp/${asin}?tag=${regionConfig.affiliate_id}`;
}

function buildProductUrl(regionConfig, asin) {
  return `https://www.${regionConfig.domain}/dp/${asin}`;
}

async function getCandidateProducts(region, regionConfig, category, disallowedAsins) {
  const exclusionList = Array.from(disallowedAsins);
  const freshProducts = await fetchAsins(region, { limit: 20, category });
  const fallbackProducts = await listProducts(region, {
    excludeAsins: exclusionList,
    limit: 40,
  });

  const combined = [
    ...freshProducts,
    ...fallbackProducts.map((product) => ({
      asin: product.asin,
      title: product.title,
      imageUrl: product.imageUrl,
      url: buildProductUrl(regionConfig, product.asin),
    })),
  ];

  const seen = new Set();
  return combined
    .filter((product) => {
      if (disallowedAsins.has(product.asin)) return false;
      if (seen.has(product.asin)) return false;
      seen.add(product.asin);
      return true;
    })
    .map((product) => ({
      asin: product.asin,
      title: product.title || `Product ${product.asin}`,
      imageUrl: product.imageUrl || `https://images-na.ssl-images-amazon.com/images/P/${product.asin}.jpg`,
      url: product.url || buildProductUrl(regionConfig, product.asin),
    }));
}

async function postForRegion(region, state, currentDate = new Date()) {
  const regionConfig = loadRegionConfig(region);
  const categoryWeights = regionConfig.category_weights || {};
  const category = pickWeightedCategory(categoryWeights);
  const disallowedAsins = new Set([
    ...(state.todaysAsinsByRegion.get(region) || []),
    ...state.blockAsins,
    ...state.todaysGlobalAsins,
  ]);

  const lastGlobalAsin = state.lastGlobalPost?.asin;
  if (lastGlobalAsin) disallowedAsins.add(lastGlobalAsin);
  const lastRegionAsin = state.lastPostByRegion.get(region)?.asin;
  if (lastRegionAsin) disallowedAsins.add(lastRegionAsin);

  const candidates = await getCandidateProducts(region, regionConfig, category, disallowedAsins);
  if (!candidates.length) {
    logger.warn("No eligible product found", { region, category });
    return null;
  }

  for (const product of candidates) {
    let reviews;
    try {
      reviews = await fetchReviews(region, product.asin, { limit: 20 });
    } catch (error) {
      logger.error("Failed to fetch reviews for product", {
        region,
        asin: product.asin,
        error: error.message,
      });
      continue;
    }

    if (!reviews.length) {
      logger.warn("No qualifying reviews for product", { region, asin: product.asin });
      continue;
    }

    const shuffledReviews = shuffle(reviews);
    for (const review of shuffledReviews) {
      try {
        const processed = await processReview(region, product.asin, review);
        const highlight = processed.highlightText || processed.highlight || "";
        const summary = processed.summaryText || processed.summary || "";
        if (!highlight || !summary) {
          logger.warn("Processed review missing highlight or summary", { region, asin: product.asin });
          continue;
        }

        const text = renderTemplate(regionConfig.language, {
          title: product.title,
          highlight,
          summary,
          domain: regionConfig.domain,
          asin: product.asin,
          affiliateId: regionConfig.affiliate_id,
          affid: regionConfig.affiliate_id,
        });

        const affiliateUrl = buildAffiliateUrl(regionConfig, product.asin);

        if (state.todaysTexts.has(text)) {
          logger.warn("Skipping duplicate tweet text", { region, asin: product.asin });
          continue;
        }

        if (state.lastGlobalPost && state.lastGlobalPost.postText === text) {
          logger.warn("Skipping tweet identical to last global post", { region, asin: product.asin });
          continue;
        }

        if (state.lastGlobalPost && state.lastGlobalPost.affiliateUrl === affiliateUrl) {
          logger.warn("Skipping tweet with duplicate URL to last post", { region, asin: product.asin });
          continue;
        }

        const lastRegionalPost = state.lastPostByRegion.get(region);
        if (lastRegionalPost && lastRegionalPost.postText === text) {
          logger.warn("Skipping tweet identical to previous regional post", { region, asin: product.asin });
          continue;
        }

        const tweetId = await postTweet(region, { text, imageUrl: product.imageUrl });
        const postedAt = new Date();
        await recordPostedTweet(region, product.asin, text, affiliateUrl, postedAt, tweetId);

        logger.info("Tweet workflow completed", {
          region,
          asin: product.asin,
          category,
        });

        return {
          region,
          asin: product.asin,
          text,
          affiliateUrl,
          category,
          postedAt,
          tweetId: tweetId || undefined,
        };
      } catch (error) {
        logger.error("Failed to process review for tweeting", {
          region,
          asin: product.asin,
          error: error.message,
        });
      }
    }
  }

  logger.error("Unable to find suitable review for tweet", { region, category });
  return null;
}

async function executePostingBlock(currentDate = new Date(), { force = false } = {}) {
  const blockTime = formatJstTime(currentDate);
  if (!force && !BLOCK_TIMES_JST.includes(blockTime)) {
    logger.info("Skipping block execution outside configured time", { blockTime });
    return [];
  }

  logger.info("Starting posting block", { blockTime });
  const regions = shuffle(getActiveRegions());
  const state = await getTweetHistory(currentDate);
  state.blockAsins = new Set();

  const results = [];
  for (const region of regions) {
    try {
      const outcome = await postForRegion(region, state, currentDate);
      if (outcome) {
        state.blockAsins.add(outcome.asin);
        state.todaysGlobalAsins.add(outcome.asin);
        state.todaysTexts.add(outcome.text);
        state.todaysAsinsByRegion.get(region)?.add(outcome.asin);
        state.lastGlobalPost = { ...outcome, postText: outcome.text };
        state.lastPostByRegion.set(region, {
          asin: outcome.asin,
          postText: outcome.text,
          affiliateUrl: outcome.affiliateUrl,
        });
        results.push(outcome);
      }
    } catch (error) {
      logger.error("Failed to post for region", { region, error: error.message });
    }
  }

  logger.info("Posting block complete", { blockTime, posted: results.length });
  return results;
}

function getCron() {
  let cron;
  try {
    // eslint-disable-next-line global-require
    cron = require("node-cron");
  } catch (error) {
    throw new Error("node-cron package is not installed. Run `npm install` to use the scheduler.");
  }
  return cron;
}

function startScheduler() {
  const cron = getCron();
  cron.schedule(
    "0 2,6,10,14,18,22 * * *",
    () =>
      executePostingBlock(new Date(), { force: false }).catch((error) =>
        logger.error("Posting block failed", { error: error.message }),
      ),
    { timezone: JST_TIMEZONE },
  );
  logger.info("Scheduler initialised", { blocks: BLOCK_TIMES_JST });
}

if (require.main === module) {
  executePostingBlock().catch((error) => {
    logger.error("Scheduler execution failed", { error: error.message });
    process.exitCode = 1;
  });
}

module.exports = {
  BLOCK_TIMES_JST,
  executePostingBlock,
  startScheduler,
  postForRegion,
  isBlockTime,
};
