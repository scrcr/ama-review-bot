const levels = ["debug", "info", "warn", "error"];

function timestamp() {
  return new Date().toISOString();
}

function log(level, message, meta = {}) {
  if (!levels.includes(level)) {
    level = "info";
  }
  const payload = {
    level,
    time: timestamp(),
    msg: message,
    ...meta,
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

module.exports = {
  debug: (message, meta) => log("debug", message, meta),
  info: (message, meta) => log("info", message, meta),
  warn: (message, meta) => log("warn", message, meta),
  error: (message, meta) => log("error", message, meta),
};
