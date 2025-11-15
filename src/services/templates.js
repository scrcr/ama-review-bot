function resolveAffiliateId(data) {
  return data.affiliateId || data.affid || "";
}

const templates = {
  en: ({ highlight, summary, domain, asin, ...rest }) => `This might be the most useful thing today.

💬 Highlight:
"${highlight}"

Why people love it:
${summary}

Amazon: https://www.${domain}/dp/${asin}?tag=${resolveAffiliateId(rest)}`,

  ja: ({ title, highlight, summary, domain, asin, ...rest }) => `【知られざる神商品】

「${title}」

▼ 刺さったレビュー
「${highlight}」

理由：${summary}

Amazon：https://www.${domain}/dp/${asin}?tag=${resolveAffiliateId(rest)}`,
};

function renderTemplate(language, data) {
  const template = templates[language];
  if (!template) {
    throw new Error(`Unsupported language template: ${language}`);
  }
  return template(data).trim();
}

module.exports = {
  renderTemplate,
};
