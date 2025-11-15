const fs = require("fs");
const path = require("path");
let dotenv = null;
try {
  // eslint-disable-next-line global-require
  dotenv = require("dotenv");
} catch (error) {
  // optional dependency for environments without dotenv installed during smoke tests
  dotenv = null;
}

const logger = require("../utils/logger");

const regionsPath = path.resolve(__dirname, "../../config/regions.json");
const BASE_CATEGORIES = [
  "kitchen",
  "cleaning",
  "storage",
  "gadgets",
  "tools",
  "pets",
  "mobile",
  "stationery",
  "appliances",
  "daily_goods",
  "coffee",
  "home_improvement",
  "office",
  "kitchen_highend",
  "garden",
  "outdoor",
  "home_small",
];

const CATEGORY_SEARCH_TERMS = {
  kitchen: "kitchen gadgets",
  cleaning: "cleaning supplies",
  storage: "storage organizer",
  gadgets: "home gadgets",
  tools: "household tools",
  pets: "pet supplies",
  mobile: "mobile accessories",
  stationery: "stationery organizer",
  appliances: "home appliances",
  daily_goods: "daily essentials",
  coffee: "coffee tools",
  home_improvement: "home improvement tools",
  office: "home office supplies",
  kitchen_highend: "high end kitchen appliances",
  garden: "garden essentials",
  outdoor: "outdoor living gear",
  home_small: "compact home appliances",
};

let cachedRegions;
let envLoaded = false;

function loadEnv() {
  if (envLoaded) return;
  const envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath) && dotenv) {
    dotenv.config({ path: envPath });
    logger.info("Environment variables loaded", { envPath });
  }
  envLoaded = true;
}

function loadRegionConfig(region) {
  loadEnv();
  if (!cachedRegions) {
    const content = fs.readFileSync(regionsPath, "utf-8");
    cachedRegions = JSON.parse(content);
  }
  const config = cachedRegions[region];
  if (!config) {
    throw new Error(`Unsupported region: ${region}`);
  }
  return config;
}

function getSupportedRegions() {
  if (!cachedRegions) {
    const content = fs.readFileSync(regionsPath, "utf-8");
    cachedRegions = JSON.parse(content);
  }
  return Object.keys(cachedRegions);
}

function getActiveRegions() {
  loadEnv();
  const supported = getSupportedRegions();
  const override = process.env.ACTIVE_REGIONS;

  if (!override || !override.trim()) {
    return supported;
  }

  const requested = [...new Set(override.split(",").map((value) => value.trim()).filter(Boolean))];
  if (!requested.length) {
    return supported;
  }

  const unknown = requested.filter((region) => !supported.includes(region));
  if (unknown.length) {
    throw new Error(`Unsupported regions in ACTIVE_REGIONS: ${unknown.join(", ")}`);
  }

  return requested;
}

function getDatabaseConfig() {
  loadEnv();
  return {
    host: process.env.DATABASE_HOST || "127.0.0.1",
    port: Number(process.env.DATABASE_PORT || 3306),
    user: process.env.DATABASE_USER || "ama_bot",
    password: process.env.DATABASE_PASSWORD || "",
    database: process.env.DATABASE_NAME || "ama_bot",
  };
}

function getCategories() {
  if (!cachedRegions) {
    const content = fs.readFileSync(regionsPath, "utf-8");
    cachedRegions = JSON.parse(content);
  }

  const weightedCategories = Object.values(cachedRegions || {}).flatMap((config) =>
    Object.keys(config.category_weights || {}),
  );

  return [...new Set([...BASE_CATEGORIES, ...weightedCategories])];
}

function getCategorySearchTerm(category) {
  const term = CATEGORY_SEARCH_TERMS[category];
  if (!term) {
    throw new Error(`Unsupported category: ${category}`);
  }
  return term;
}

function getCategoryUrl(region, category) {
  loadEnv();
  const upperRegion = region.toUpperCase();
  if (category) {
    const upperCategory = category.toUpperCase();
    const override = process.env[`CATEGORY_URL_${upperRegion}_${upperCategory}`];
    if (override) return override;
  }
  const regionWideOverride = process.env[`CATEGORY_URL_${upperRegion}`];
  if (regionWideOverride) return regionWideOverride;

  if (!category) {
    throw new Error(`Category must be provided for region ${region}`);
  }

  const regionConfig = loadRegionConfig(region);
  const term = getCategorySearchTerm(category);
  const normalizedTerm = term.trim().replace(/\s+/g, "+");
  return `https://www.${regionConfig.domain}/s?k=${normalizedTerm}`;
}

function getTwitterCredentials(region) {
  loadEnv();
  const upper = region.toUpperCase();
  return {
    appKey: process.env[`TWITTER_APP_KEY_${upper}`],
    appSecret: process.env[`TWITTER_APP_SECRET_${upper}`],
    accessToken: process.env[`TWITTER_ACCESS_TOKEN_${upper}`],
    accessSecret: process.env[`TWITTER_ACCESS_SECRET_${upper}`],
  };
}

function getOpenAIKey() {
  loadEnv();
  return process.env.OPENAI_API_KEY;
}

module.exports = {
  loadRegionConfig,
  getSupportedRegions,
  getActiveRegions,
  getDatabaseConfig,
  getCategoryUrl,
  getCategories,
  getTwitterCredentials,
  getOpenAIKey,
};
