const { loadRegionConfig } = require("../config");
const logger = require("../utils/logger");

const DEFAULT_CONFIG = {
  missing_mode: "skip",
  similarity_threshold: 0.75,
};

const BRAND_WEIGHT = 0.2;
const CATEGORY_WEIGHT = 0.1;
const TITLE_WEIGHT = 1 - BRAND_WEIGHT - CATEGORY_WEIGHT;
const MAX_CANDIDATES = 10;
const MAX_FETCH_RETRIES = 3;

class NormalizationError extends Error {
  constructor(message, metadata = {}) {
    super(message);
    this.name = "NormalizationError";
    this.metadata = metadata;
  }
}

function normalizeInputPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new NormalizationError("Normalization payload must be an object");
  }
  const { source, target_region: targetRegion, config = {}, reviewText = "" } = payload;
  if (!source || typeof source !== "object") {
    throw new NormalizationError("Payload missing source product definition");
  }
  if (!source.asin || !source.title || !source.region) {
    throw new NormalizationError("Source product requires asin, title, and region");
  }
  if (!targetRegion) {
    throw new NormalizationError("target_region is required");
  }

  return {
    source,
    targetRegion,
    config: { ...DEFAULT_CONFIG, ...config },
    reviewText,
  };
}

function looksLikeCaptcha(html = "") {
  const lowered = html.toLowerCase();
  return lowered.includes("captcha") || lowered.includes("sorry") || lowered.includes("human");
}

function sanitizeTitle(rawTitle) {
  if (!rawTitle) return null;
  return rawTitle.replace(/\s+/g, " ").replace(/amazon\.[^:]+:?\s*/i, "").trim();
}

function defaultTranslateToEnglish(text) {
  if (!text) return text;
  return text;
}

function defaultExtractCoreKeywords(title) {
  if (!title) return [];
  return title
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/\b(black|white|blue|red|green|yellow|pink|small|medium|large|xl|xxl|set|pack|pcs|cm|mm|inch|inches|ml|l|liter|litre)\b/gi, " ")
    .split(/[^a-zA-Z0-9]+/)
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length >= 3)
    .slice(0, 6);
}

function defaultExtractFeaturesFromReview(reviewText = "") {
  const lowered = reviewText.toLowerCase();
  const purposes = [
    { key: "cleaning", terms: ["clean", "vacuum", "mop", "dust"] },
    { key: "storage", terms: ["organize", "storage", "box", "drawer"] },
    { key: "audio", terms: ["audio", "speaker", "sound", "headphone"] },
    { key: "kitchen", terms: ["cook", "kitchen", "knife", "pan"] },
  ];
  const attributes = [];
  ["quiet", "compact", "foldable", "wireless", "portable", "lightweight"].forEach((attr) => {
    if (lowered.includes(attr)) attributes.push(attr);
  });
  const purpose = purposes.find((entry) => entry.terms.some((term) => lowered.includes(term)))?.key;
  return { purpose, attributes };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function calculateLevenshtein(a = "", b = "") {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = Array.from({ length: b.length + 1 }, () => new Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      if (a[i - 1] === b[j - 1]) {
        matrix[j][i] = matrix[j - 1][i - 1];
      } else {
        const substitution = matrix[j - 1][i - 1] + 1;
        const insertion = matrix[j][i - 1] + 1;
        const deletion = matrix[j - 1][i] + 1;
        matrix[j][i] = Math.min(substitution, insertion, deletion);
      }
    }
  }
  return matrix[b.length][a.length];
}

function computeTitleSimilarity(baseTitle = "", candidateTitle = "") {
  const a = baseTitle.toLowerCase();
  const b = candidateTitle.toLowerCase();
  if (!a.length || !b.length) return 0;
  const distance = calculateLevenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 0 : 1 - distance / maxLength;
}

function computeSimilarity(source, candidate) {
  const titles = [source.title, ...(source.alternateTitles || [])].filter(Boolean);
  const titleSim = titles.reduce(
    (max, current) => Math.max(max, computeTitleSimilarity(current, candidate.title || "")),
    0,
  );
  const brandSim = source.brand && candidate.brand
    ? source.brand.toLowerCase() === candidate.brand.toLowerCase() ? 1 : 0
    : 0;
  const categorySim = source.category && candidate.category
    ? source.category.toLowerCase() === candidate.category.toLowerCase() ? 1 : 0
    : 0;
  return titleSim * TITLE_WEIGHT + brandSim * BRAND_WEIGHT + categorySim * CATEGORY_WEIGHT;
}

function buildAffiliateUrl(regionConfig, asin) {
  const affiliate = regionConfig.affiliate_id ? `?tag=${regionConfig.affiliate_id}` : "";
  return `https://www.${regionConfig.domain}/dp/${asin}${affiliate}`;
}

async function tryExactMatch({ source, regionConfig }, deps) {
  if (!deps.fetchImpl) return null;
  const productUrl = `https://www.${regionConfig.domain}/dp/${source.asin}`;
  for (let attempt = 0; attempt < MAX_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await deps.fetchImpl(productUrl, { redirect: "follow" });
      if (response.status === 200) {
        const body = await response.text();
        if (looksLikeCaptcha(body)) {
          deps.logger.warn("Captcha encountered during exact match lookup", { asin: source.asin, region: regionConfig.domain });
          return { status: "skipped", reason: "captcha_blocked", asin: source.asin, url: productUrl };
        }
        const productTitle = sanitizeTitle(body.match(/<title>(.*?)<\/title>/i)?.[1]) || source.title;
        return {
          status: "ok",
          asin: source.asin,
          url: buildAffiliateUrl(regionConfig, source.asin),
          product_title: productTitle,
          reason: "exact_match",
        };
      }
      if (response.status === 404) {
        return null;
      }
      if (response.status >= 500) {
        await deps.backoff(attempt);
        continue;
      }
      return null;
    } catch (error) {
      deps.logger.warn("Exact match lookup failed", { error: error.message, attempt });
      if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
        return { status: "skipped", reason: "network_unavailable" };
      }
      await deps.backoff(attempt);
    }
  }
  return null;
}

async function collectCandidates({ source, targetRegion, regionConfig, translatedTitle }, deps) {
  const queries = new Set();
  queries.add(source.title);
  if (translatedTitle && translatedTitle !== source.title) {
    queries.add(translatedTitle);
  }
  if (source.brand) {
    queries.add(`${source.brand} ${source.title}`);
  }
  const keywords = deps.extractCoreKeywords(source.title);
  if (keywords.length) {
    queries.add(`${source.brand || ""} ${keywords.join(" ")}`.trim());
  }

  const candidates = new Map();
  for (const query of queries) {
    if (!query) continue;
    const results = await deps.searchProducts({ region: targetRegion, query, limit: MAX_CANDIDATES });
    (results || []).forEach((product) => {
      if (!product || !product.asin) return;
      if (!candidates.has(product.asin)) {
        candidates.set(product.asin, {
          ...product,
          url: product.url || `https://www.${regionConfig.domain}/dp/${product.asin}`,
        });
      }
    });
    if (candidates.size >= MAX_CANDIDATES) break;
  }

  return Array.from(candidates.values()).slice(0, MAX_CANDIDATES);
}

function rankCandidates(source, candidates) {
  return candidates
    .map((candidate) => ({
      ...candidate,
      similarity: computeSimilarity(source, candidate),
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

async function handleSuggestMode({ source, regionConfig, targetRegion, reviewText }, deps) {
  const { purpose, attributes } = deps.extractFeaturesFromReview(reviewText);
  const queries = [];
  if (purpose) {
    queries.push([purpose, ...(attributes || [])].join(" "));
  }
  if (!queries.length) {
    queries.push("best rated home gadget");
  }
  const pseudoSource = {
    title: queries[0],
    brand: null,
    category: purpose || source.category,
  };
  const candidates = await collectCandidates({ source: pseudoSource, targetRegion, regionConfig }, deps);
  if (!candidates.length) {
    return { status: "skipped", reason: "no_equivalent_product" };
  }
  const ranked = rankCandidates(pseudoSource, candidates);
  const best = ranked[0];
  return {
    status: "ok",
    asin: best.asin,
    url: buildAffiliateUrl(regionConfig, best.asin),
    product_title: best.title || pseudoSource.title,
    reason: "suggested_match",
    similarity: best.similarity,
  };
}

function handleMissing({ config, bestCandidate }) {
  switch (config.missing_mode) {
    case "skip":
      return { status: "skipped", reason: "no_equivalent_product" };
    case "similar":
      if (bestCandidate) {
        return {
          status: "ok",
          asin: bestCandidate.asin,
          url: bestCandidate.url,
          product_title: bestCandidate.title,
          reason: "forced_similar",
          similarity: bestCandidate.similarity,
        };
      }
      return { status: "skipped", reason: "no_equivalent_product" };
    case "nolink":
      return { status: "no_match", asin: null, url: null, product_title: null, reason: "nolink" };
    case "suggest":
      return null;
    default:
      throw new NormalizationError(`Unsupported missing_mode: ${config.missing_mode}`);
  }
}

async function normalizeProduct(payload, options = {}) {
  const normalized = normalizeInputPayload(payload);
  const { source, targetRegion, config, reviewText } = normalized;
  const regionConfig = loadRegionConfig(targetRegion);
  const deps = {
    fetchImpl: globalThis.fetch ? (...args) => globalThis.fetch(...args) : null,
    searchProducts: async () => [],
    translateToEnglish: defaultTranslateToEnglish,
    extractCoreKeywords: defaultExtractCoreKeywords,
    extractFeaturesFromReview: defaultExtractFeaturesFromReview,
    backoff: async (attempt) => sleep(250 * 2 ** attempt),
    logger,
    ...options.dependencies,
  };

  let translatedTitle = null;
  if (["jp", "de"].includes(source.region)) {
    translatedTitle = await deps.translateToEnglish(source.title, source.region);
  }
  const enrichedSource = {
    ...source,
    alternateTitles:
      translatedTitle && translatedTitle !== source.title ? [translatedTitle] : source.alternateTitles || [],
  };

  const exactOutcome = await tryExactMatch({ source, regionConfig }, deps);
  if (exactOutcome) {
    if (exactOutcome.status === "ok") {
      return exactOutcome;
    }
    if (exactOutcome.status === "skipped") {
      return exactOutcome;
    }
  }

  const candidates = await collectCandidates({
    source: enrichedSource,
    targetRegion,
    regionConfig,
    translatedTitle,
  }, deps);
  const ranked = rankCandidates(enrichedSource, candidates);
  const bestCandidate = ranked[0];
  if (bestCandidate && bestCandidate.similarity >= config.similarity_threshold) {
    return {
      status: "ok",
      asin: bestCandidate.asin,
      url: bestCandidate.url,
      product_title: bestCandidate.title,
      reason: "similar_match",
      similarity: bestCandidate.similarity,
    };
  }

  const fallback = handleMissing({ config, bestCandidate });
  if (fallback) {
    if (fallback.reason === "forced_similar" && fallback.asin && !fallback.url) {
      fallback.url = buildAffiliateUrl(regionConfig, fallback.asin);
    }
    return fallback;
  }

  // Suggest mode
  const suggestion = await handleSuggestMode({ source, regionConfig, targetRegion, reviewText }, deps);
  return suggestion;
}

module.exports = {
  normalizeProduct,
  NormalizationError,
  computeTitleSimilarity,
  computeSimilarity,
  defaultExtractCoreKeywords,
  defaultExtractFeaturesFromReview,
};
