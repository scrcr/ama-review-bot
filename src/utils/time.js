const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const JST_TIMEZONE = "Asia/Tokyo";

function toDate(value) {
  if (value instanceof Date) return value;
  return new Date(value);
}

function toJst(input = new Date()) {
  const date = toDate(input);
  return new Date(date.getTime() + JST_OFFSET_MS);
}

function formatJstTime(input = new Date()) {
  const jst = toJst(input);
  const hours = String(jst.getUTCHours()).padStart(2, "0");
  const minutes = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function getJstDayRange(input = new Date()) {
  const jst = toJst(input);
  const startUtcMs = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate()) - JST_OFFSET_MS;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return { startUtc: new Date(startUtcMs), endUtc: new Date(endUtcMs) };
}

function getJstDateString(input = new Date()) {
  const jst = toJst(input);
  const year = jst.getUTCFullYear();
  const month = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

module.exports = {
  JST_OFFSET_MS,
  JST_TIMEZONE,
  toJst,
  formatJstTime,
  getJstDayRange,
  getJstDateString,
};
