const SINGULAR_WORDS_BY_LOCALE = {
  en: ['one'],
  de: ['eins', 'eine', 'ein'],
  fr: ['un', 'une'],
  es: ['uno', 'una'],
  it: ['uno', 'una'],
  pt: ['um', 'uma'],
  nl: ['één', 'een'],
  sv: ['en', 'ett'],
  da: ['en', 'et'],
  no: ['en', 'ett'],
};

const FALLBACK_PATTERN = buildFallbackPattern(SINGULAR_WORDS_BY_LOCALE);
const SINGULAR_PATTERNS = buildLocalePatterns(SINGULAR_WORDS_BY_LOCALE);

function normalizeHelpful(helpful, locale) {
  if (Number.isFinite(helpful)) {
    return Math.max(0, helpful);
  }

  if (helpful === null || helpful === undefined) {
    return 0;
  }

  const text = String(helpful).trim();
  if (!text) {
    return 0;
  }

  if (matchesSingularWord(text, locale)) {
    return 1;
  }

  const numericPortion = extractFirstNumber(text);
  if (numericPortion !== null) {
    return numericPortion;
  }

  return 0;
}

function matchesSingularWord(text, locale) {
  const normalizedText = normalizeWhitespace(text).toLowerCase();
  const candidates = getLocaleCandidates(locale);

  for (const candidate of candidates) {
    const pattern = SINGULAR_PATTERNS[candidate];
    if (pattern && pattern.test(normalizedText)) {
      return true;
    }
  }

  return FALLBACK_PATTERN.test(normalizedText);
}

function extractFirstNumber(text) {
  const sanitized = normalizeWhitespace(text)
    .replace(/(?<=\d)[.,](?=\d)/g, '')
    .replace(/\u00A0/g, ' ');

  const match = sanitized.match(/\d+/);
  if (!match) {
    return null;
  }

  const value = parseInt(match[0], 10);
  return Number.isNaN(value) ? null : value;
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function getLocaleCandidates(locale) {
  if (!locale) {
    return [];
  }

  if (Array.isArray(locale)) {
    return locale
      .map((entry) => normalizeLocale(entry))
      .filter(Boolean);
  }

  const normalized = normalizeLocale(locale);
  return normalized ? [normalized] : [];
}

function normalizeLocale(locale) {
  if (!locale || typeof locale !== 'string') {
    return null;
  }

  const trimmed = locale.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (SINGULAR_PATTERNS[trimmed]) {
    return trimmed;
  }

  const [language] = trimmed.split(/[-_]/);
  return language && SINGULAR_PATTERNS[language] ? language : trimmed;
}

function buildLocalePatterns(localeMap) {
  return Object.entries(localeMap).reduce((patterns, [locale, words]) => {
    if (Array.isArray(words) && words.length > 0) {
      patterns[locale] = new RegExp(`\\b(?:${words.map(escapeRegExp).join('|')})\\b`, 'i');
    }
    return patterns;
  }, {});
}

function buildFallbackPattern(localeMap) {
  const words = new Set();
  for (const localeWords of Object.values(localeMap)) {
    for (const word of localeWords) {
      words.add(word);
    }
  }

  if (!words.size) {
    return /\b\B/; // never matches
  }

  return new RegExp(`\\b(?:${Array.from(words).map(escapeRegExp).join('|')})\\b`, 'i');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  normalizeHelpful,
  // Exposed for testing purposes
  _internals: {
    SINGULAR_PATTERNS,
    FALLBACK_PATTERN,
    extractFirstNumber,
    matchesSingularWord,
  },
=======
const { loadRegionConfig } = require("../config");
const logger = require("../utils/logger");

let cheerioInstance;

function getCheerio() {
  if (!cheerioInstance) {
    // eslint-disable-next-line global-require
    cheerioInstance = require("cheerio");
  }
  return cheerioInstance;
}

const TEXTUAL_HELPFUL_PATTERNS = [
  { regex: /\bone\b/i, value: 1 },
  { regex: /\bsingle\b/i, value: 1 },
  { regex: /\beine\b/i, value: 1 },
  { regex: /\bein\b/i, value: 1 },
  { regex: /\beins\b/i, value: 1 },
];

function normalizeHelpful(text) {
  if (!text) return 0;
  const cleaned = text.replace(/[^0-9]/g, "").trim();
  const value = Number.parseInt(cleaned, 10);
  if (!Number.isNaN(value) && value > 0) {
    return value;
  }

  const normalized = text.toLowerCase();
  for (const pattern of TEXTUAL_HELPFUL_PATTERNS) {
    if (pattern.regex.test(normalized)) {
      return pattern.value;
    }
  }

  return 0;
}

function extractReviewsFromHtml(html) {
  const $ = getCheerio().load(html);
  const results = [];
  $("[data-hook='review']").each((_, element) => {
    const container = $(element);
    const ratingText = container.find("[data-hook='review-star-rating'] span").first().text().trim();
    const ratingMatch = ratingText.match(/([0-9.]+)/);
    const rating = ratingMatch ? Number.parseFloat(ratingMatch[1]) : 0;

    const text = container.find("[data-hook='review-body'] span").map((__, span) => $(span).text()).get().join(" ").replace(/\s+/g, " ").trim();

    const helpfulText = container
      .find("[data-hook='helpful-vote-statement'], [data-hook='helpful-vote-statement-section'] span")
      .first()
      .text();
    const helpful = normalizeHelpful(helpfulText);

    results.push({
      text,
      rating,
      helpful,
    });
  });
  return results;
}

function buildReviewUrl(base, asin, pageNumber) {
  const url = new URL(`${base}${asin}`);
  url.searchParams.set("reviewerType", "all_reviews");
  url.searchParams.set("sortBy", "recent");
  url.searchParams.set("pageNumber", String(pageNumber));
  return url.toString();
}

async function fetchReviews(region, asin, { limit = 20, maxPages = 10 } = {}) {
  const regionConfig = loadRegionConfig(region);
  const collected = [];
  let emptyPageCount = 0;

  for (let page = 1; page <= maxPages && collected.length < limit; page += 1) {
    const url = buildReviewUrl(regionConfig.review_url, asin, page);
    logger.info("Fetching reviews", { region, asin, url, page });

    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AMAReviewBot/1.0)",
        accept: "text/html",
        "accept-language": regionConfig.language === "ja" ? "ja,en;q=0.9" : "en-US,en;q=0.9",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch reviews (${response.status})`);
    }

    const html = await response.text();
    const pageReviews = extractReviewsFromHtml(html)
      .filter((review) => review.rating >= 4 && review.text.length >= 200 && review.helpful >= 1);

    if (pageReviews.length === 0) {
      emptyPageCount += 1;
    } else {
      emptyPageCount = 0;
    }

    pageReviews.forEach((review) => {
      if (collected.length < limit) {
        collected.push(review);
      }
    });

    if (emptyPageCount >= 2) {
      logger.info("No further qualifying reviews found, stopping early", { region, asin, page });
      break;
    }
  }

  logger.info("Review fetch complete", { region, asin, count: collected.length });
  return collected.slice(0, limit);
}

module.exports = {
  fetchReviews,
  buildReviewUrl,
  extractReviewsFromHtml,
  normalizeHelpful,
};
