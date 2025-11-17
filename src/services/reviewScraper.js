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
};
