const { withConnection } = require("../db/pool");

async function enqueuePost(region, asin, text, scheduledAt = null) {
  return withConnection(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO post_queue (asin, region, post_text, scheduled_at)
       VALUES (?, ?, ?, ?)`,
      [asin, region, text, scheduledAt]
    );
    return result.insertId;
  });
}

async function nextPendingPost(region) {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(
      `SELECT * FROM post_queue
        WHERE region = ? AND status = 'pending'
        ORDER BY scheduled_at IS NULL, scheduled_at ASC, id ASC
        LIMIT 1`,
      [region]
    );
    return rows[0];
  });
}

async function markPostStatus(id, status) {
  return withConnection(async (conn) => {
    await conn.query(`UPDATE post_queue SET status = ?, scheduled_at = scheduled_at WHERE id = ?`, [status, id]);
  });
}

async function recordPostedTweet(region, asin, text, postedAt = new Date()) {
  return withConnection(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO post_queue (asin, region, post_text, status, scheduled_at)
       VALUES (?, ?, ?, 'posted', ?)`,
      [asin, region, text, postedAt]
    );
    return result.insertId;
  });
}

async function listPostedTweets({ region, start, end, limit } = {}) {
  return withConnection(async (conn) => {
    const conditions = ["status = 'posted'"];
    const params = [];

    if (region) {
      conditions.push("region = ?");
      params.push(region);
    }

    if (start) {
      conditions.push("created_at >= ?");
      params.push(start);
    }

    if (end) {
      conditions.push("created_at < ?");
      params.push(end);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const parsedLimit = limit ? Number.parseInt(limit, 10) : null;
    const limitClause = parsedLimit ? ` LIMIT ${parsedLimit}` : "";
    const [rows] = await conn.query(
      `SELECT id, asin, region, post_text AS postText, created_at AS createdAt
         FROM post_queue
         ${whereClause}
         ORDER BY created_at DESC, id DESC${limitClause}`,
      params,
    );
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
