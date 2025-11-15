const { withConnection } = require("../db/pool");

async function insertProducts(region, products) {
  if (!products.length) return 0;
  const values = [];
  const placeholders = products.map((product, index) => {
    const baseIndex = index * 4;
    values.push(product.asin, product.title, product.imageUrl || null, region);
    return `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4})`;
  });

  return withConnection(async (conn) => {
    const result = await conn.query(
      `INSERT INTO products (asin, title, image_url, region)
       VALUES ${placeholders.join(", ")}
       ON CONFLICT (region, asin)
       DO UPDATE SET title = EXCLUDED.title, image_url = EXCLUDED.image_url`,
      values
    );
    return result.rowCount;
  });
}

async function listKnownAsins(region) {
  return withConnection(async (conn) => {
    const { rows } = await conn.query("SELECT asin FROM products WHERE region = $1", [region]);
    return rows.map((row) => row.asin);
  });
}

async function getProduct(region, asin) {
  return withConnection(async (conn) => {
    const { rows } = await conn.query(
      'SELECT asin, title, image_url AS "imageUrl", region FROM products WHERE region = $1 AND asin = $2 LIMIT 1',
      [region, asin]
    );
    return rows[0] || null;
  });
}

async function listProducts(region, { excludeAsins = [], limit = 20 } = {}) {
  return withConnection(async (conn) => {
    const conditions = ['region = $1'];
    const params = [region];
    let placeholderIndex = params.length;

    if (excludeAsins.length) {
      const placeholders = excludeAsins.map((asin, idx) => {
        const position = placeholderIndex + idx + 1;
        return `$${position}`;
      });
      conditions.push(`asin NOT IN (${placeholders.join(", ")})`);
      params.push(...excludeAsins);
      placeholderIndex += excludeAsins.length;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limitPlaceholder = `$${placeholderIndex + 1}`;
    params.push(limit);

    const { rows } = await conn.query(
      `SELECT asin, title, image_url AS "imageUrl", region
         FROM products
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT ${limitPlaceholder}`,
      params
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
