const { getDatabaseConfig } = require("../config");
const logger = require("../utils/logger");

let pool;

async function getPool() {
  if (pool) return pool;
  let Pool;
  try {
    // Lazy require to keep smoke tests dependency-light
    // eslint-disable-next-line global-require
    ({ Pool } = require("pg"));
  } catch (error) {
    throw new Error("pg is not installed. Run `npm install` before executing database operations.");
  }

  const config = getDatabaseConfig();
  pool = new Pool(config);
  logger.info("Postgres pool created", {
    connectionString: config.connectionString ? "(hidden)" : undefined,
    host: config.host,
    database: config.database,
  });
  return pool;
}

async function withConnection(fn) {
  const client = await (await getPool()).connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

module.exports = {
  getPool,
  withConnection,
};
