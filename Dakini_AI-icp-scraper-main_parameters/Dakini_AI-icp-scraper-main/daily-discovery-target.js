const DAILY_QUALIFIED_PROSPECT_TARGET = 300;

function dateKeyInTimeZone(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function countDailyQualifiedProspects(companies, now, timeZone) {
  const today = dateKeyInTimeZone(now, timeZone);
  if (!today) return 0;
  const records = companies instanceof Map ? companies.values() : companies;
  let count = 0;
  for (const company of records || []) {
    if (dateKeyInTimeZone(company?.capturedAt, timeZone) !== today) continue;
    if (!company.legitimacy?.canAutoQualify) continue;
    if (company.score?.tier !== "Priority" ||
        !Number.isFinite(company.score.score) ||
        company.score.score < 90) continue;
    count += 1;
  }
  return count;
}

module.exports = {
  DAILY_QUALIFIED_PROSPECT_TARGET,
  countDailyQualifiedProspects,
  dateKeyInTimeZone
};
