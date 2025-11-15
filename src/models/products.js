const { withConnection } = require("../db/pool");

async function insertProducts(region, products) {
  if (!products.length) return 0;
  const rows = products.map((product) => [
    product.asin,
    product.title,
    product.imageUrl || null,
    region,
  ]);

  return withConnection(async (conn) => {
    const [result] = await conn.query(
      `INSERT INTO products (asin, title, image_url, region)
       VALUES ?
       ON DUPLICATE KEY UPDATE title = VALUES(title), image_url = VALUES(image_url)`,
      [rows]
    );
    return result.affectedRows;
  });
}

async function listKnownAsins(region) {
  return withConnection(async (conn) => {
    const [rows] = await conn.query("SELECT asin FROM products WHERE region = ?", [region]);
    return rows.map((row) => row.asin);
  });
}

async function getProduct(region, asin) {
  return withConnection(async (conn) => {
    const [rows] = await conn.query(
      "SELECT asin, title, image_url AS imageUrl, region FROM products WHERE region = ? AND asin = ? LIMIT 1",
      [region, asin]
    );
    return rows[0] || null;
  });
}

async function listProducts(region, { excludeAsins = [], limit = 20 } = {}) {
  return withConnection(async (conn) => {
    const conditions = ["region = ?"];
    const params = [region];

    if (excludeAsins.length) {
      conditions.push(`asin NOT IN (${excludeAsins.map(() => "?").join(", ")})`);
      params.push(...excludeAsins);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const [rows] = await conn.query(
      `SELECT asin, title, image_url AS imageUrl, region
         FROM products
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT ?`,
      [...params, limit]
    );
    return rows;
  });
}

module.exports = {
  insertProducts,
  listKnownAsins,
  getProduct,
  listProducts,
};
