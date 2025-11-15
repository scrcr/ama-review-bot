const { getDatabaseConfig } = require("../config");
const logger = require("../utils/logger");

let pool;

async function getPool() {
  if (pool) return pool;
  let mysql;
  try {
    // Lazy require to keep smoke tests dependency-free
    // eslint-disable-next-line global-require
    mysql = require("mysql2/promise");
  } catch (error) {
    throw new Error(
      "mysql2 is not installed. Run `npm install` before executing database operations."
    );
  }

  const config = getDatabaseConfig();
  pool = mysql.createPool({
    ...config,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  logger.info("MySQL pool created", { host: config.host, database: config.database });
  return pool;
}

async function withConnection(fn) {
  const connection = await (await getPool()).getConnection();
  try {
    return await fn(connection);
  } finally {
    connection.release();
  }
}

module.exports = {
  getPool,
  withConnection,
};
