const { withConnection } = require("../db/pool");
const { getJstDateString } = require("../utils/time");

async function enqueuePost(region, asin, text, scheduledAt = null) {
  return withConnection(async (conn) => {
    const result = await conn.query(
      `INSERT INTO post_queue (asin, region, post_text, scheduled_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [asin, region, text, scheduledAt]
    );
    return result.rows[0].id;
  });
}

async function nextPendingPost(region) {
  return withConnection(async (conn) => {
    const { rows } = await conn.query(
      `SELECT id,
              asin,
              region,
              post_text AS "postText",
              status,
              scheduled_at AS "scheduledAt",
              created_at AS "createdAt"
         FROM post_queue
        WHERE region = $1 AND status = 'pending'
        ORDER BY (scheduled_at IS NULL) ASC, scheduled_at ASC NULLS FIRST, id ASC
        LIMIT 1`,
      [region]
    );
    return rows[0];
  });
}

async function markPostStatus(id, status) {
  return withConnection(async (conn) => {
    await conn.query(`UPDATE post_queue SET status = $1 WHERE id = $2`, [status, id]);
  });
}

async function recordPostedTweet(
  region,
  asin,
  text,
  affiliateUrl,
  postedAt = new Date(),
  tweetId = null,
) {
  const postedOnJst = getJstDateString(postedAt);
  return withConnection(async (conn) => {
    const result = await conn.query(
      `INSERT INTO posted_tweets (region, asin, tweet_text, affiliate_url, tweet_id, posted_at, posted_on_jst)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (region, posted_on_jst, asin)
       DO UPDATE SET
         tweet_text = EXCLUDED.tweet_text,
         affiliate_url = EXCLUDED.affiliate_url,
         tweet_id = EXCLUDED.tweet_id,
         posted_at = EXCLUDED.posted_at
       RETURNING id, posted_at AS "postedAt"`,
      [region, asin, text, affiliateUrl, tweetId, postedAt, postedOnJst]
    );
    return result.rows[0];
  });
}

async function listPostedTweets({ region, start, end, limit } = {}) {
  return withConnection(async (conn) => {
    const conditions = [];
    const params = [];
    let index = 0;

    if (region) {
      index += 1;
      conditions.push(`region = $${index}`);
      params.push(region);
    }

    if (start) {
      index += 1;
      conditions.push(`posted_at >= $${index}`);
      params.push(start);
    }

    if (end) {
      index += 1;
      conditions.push(`posted_at < $${index}`);
      params.push(end);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const parsedLimit = limit ? Number.parseInt(limit, 10) : null;

    const queryParts = [
      `SELECT id,
              asin,
              region,
              tweet_text AS "postText",
              affiliate_url AS "affiliateUrl",
              tweet_id AS "tweetId",
              posted_at AS "postedAt"`,
      "  FROM posted_tweets",
      `  ${whereClause}`,
      " ORDER BY posted_at DESC, id DESC",
    ];

    if (parsedLimit) {
      index += 1;
      queryParts.push(` LIMIT $${index}`);
      params.push(parsedLimit);
    }

    const { rows } = await conn.query(queryParts.join("\n"), params);
    return rows;
  });
}

async function getMostRecentPosted(region = null) {
  const [record] = await listPostedTweets({ region, limit: 1 });
  return record || null;
}

module.exports = {
  enqueuePost,
  nextPendingPost,
  markPostStatus,
  recordPostedTweet,
  listPostedTweets,
  getMostRecentPosted,
};
