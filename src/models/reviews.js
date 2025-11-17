const { withConnection } = require("../db/pool");

async function insertProcessedReview(region, asin, payload) {
  const {
    reviewText,
    highlightText,
    summaryText,
    sentimentScore,
    helpfulVotes,
    language,
  } = payload;

  return withConnection(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO reviews_processed
        (asin, region, review_text, highlight_text, summary_text, sentiment_score, helpful_votes, language)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        asin,
        region,
        reviewText,
        highlightText,
        summaryText,
        sentimentScore,
        helpfulVotes || 0,
        language,
      ]
    );
    return result.insertId;
  });
}

async function listTopReviews(region, limit = 3) {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(
      `SELECT asin, highlight_text, summary_text, sentiment_score, language
         FROM reviews_processed
        WHERE region = ?
        ORDER BY sentiment_score DESC, id DESC
        LIMIT ?`,
      [region, limit]
    );
    return rows;
  });
}

module.exports = {
  insertProcessedReview,
  listTopReviews,
};
