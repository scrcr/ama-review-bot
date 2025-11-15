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
    const result = await conn.query(
      `INSERT INTO reviews_processed
        (asin, region, review_text, highlight_text, summary_text, sentiment_score, helpful_votes, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
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
    return result.rows[0].id;
  });
}

async function listTopReviews(region, limit = 3) {
  return withConnection(async (conn) => {
    const { rows } = await conn.query(
      `SELECT asin,
              highlight_text AS "highlightText",
              summary_text AS "summaryText",
              sentiment_score AS "sentimentScore",
              language
         FROM reviews_processed
        WHERE region = $1
        ORDER BY sentiment_score DESC, id DESC
        LIMIT $2`,
      [region, limit]
    );
    return rows;
  });
}

module.exports = {
  insertProcessedReview,
  listTopReviews,
};
