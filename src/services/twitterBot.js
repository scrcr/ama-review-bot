const { loadRegionConfig, getTwitterCredentials } = require("../config");
const logger = require("../utils/logger");

async function getTwitterClient(region) {
  const credentials = getTwitterCredentials(region);
  if (!credentials.appKey || !credentials.appSecret || !credentials.accessToken || !credentials.accessSecret) {
    throw new Error(`Twitter credentials missing for region ${region}`);
  }

  let TwitterApi;
  try {
    // eslint-disable-next-line global-require
    ({ TwitterApi } = require("twitter-api-v2"));
  } catch (error) {
    throw new Error("twitter-api-v2 package is not installed. Run `npm install`.");
  }

  return new TwitterApi({
    appKey: credentials.appKey,
    appSecret: credentials.appSecret,
    accessToken: credentials.accessToken,
    accessSecret: credentials.accessSecret,
  });
}

async function downloadImage(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function postTweet(region, { text, imageUrl }, { retries = 3, retryDelayMs = 2000 } = {}) {
  if (!text) {
    throw new Error("Tweet text is required");
  }

  const regionConfig = loadRegionConfig(region);
  const client = await getTwitterClient(region);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      let mediaId;
      if (imageUrl) {
        const buffer = await downloadImage(imageUrl);
        const v1 = client.v1.readWrite;
        mediaId = await v1.uploadMedia(buffer, { mimeType: "image/jpeg" });
      }

      const v2 = client.v2.readWrite;
      const response = await v2.tweet({ text, media: mediaId ? { media_ids: [mediaId] } : undefined });
      logger.info("Tweet posted", { region, tweetId: response?.data?.id, domain: regionConfig.domain });
      return response?.data?.id || null;
    } catch (error) {
      lastError = error;
      logger.error("Failed to post tweet", {
        region,
        attempt,
        retries,
        error: error.message,
      });
      if (attempt === retries) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
    }
  }

  throw lastError || new Error("Tweet posting failed");
}

module.exports = {
  postTweet,
};
