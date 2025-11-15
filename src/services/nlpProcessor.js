const { loadRegionConfig, getOpenAIKey } = require("../config");
const { insertProcessedReview } = require("../models/reviews");
const logger = require("../utils/logger");

let cachedClient;

function getLanguage(region) {
  const config = loadRegionConfig(region);
  return config.language;
}

async function getOpenAIClient() {
  if (cachedClient) return cachedClient;
  const apiKey = getOpenAIKey();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured");
  }
  let OpenAI;
  try {
    // eslint-disable-next-line global-require
    ({ OpenAI } = require("openai"));
  } catch (error) {
    throw new Error("openai package is not installed. Run `npm install`.");
  }
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

async function processReview(region, asin, review) {
  const language = getLanguage(region);
  const client = await getOpenAIClient();
  logger.info("Processing review with GPT", { region, asin, language });

  const prompt = `You are analyzing an Amazon product review. Extract the most impactful sentence, a concise summary in the structure Problem → Solution → Result, and rate sentiment intensity from 0-100.
Return JSON with keys highlight, summary, sentiment.`;

  const completion = await client.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: language === "ja" ? "あなたは日本語レビューデータの分析アシスタントです。" : "You analyze English reviews.",
      },
      {
        role: "user",
        content: `Review:\n${review.text}`,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  const message = completion.output[0].content[0].text;
  let parsed;
  try {
    parsed = JSON.parse(message);
  } catch (error) {
    logger.warn("Failed to parse GPT response, falling back to heuristic", { message });
    parsed = {
      highlight: review.text.slice(0, 180),
      summary: review.text.slice(0, 240),
      sentiment: 70,
    };
  }

  const payload = {
    reviewText: review.text,
    highlightText: parsed.highlight,
    summaryText: parsed.summary,
    sentimentScore: Number.parseInt(parsed.sentiment, 10) || 70,
    helpfulVotes: review.helpful,
    language,
  };

  await insertProcessedReview(region, asin, payload);
  return payload;
}

module.exports = {
  processReview,
};
