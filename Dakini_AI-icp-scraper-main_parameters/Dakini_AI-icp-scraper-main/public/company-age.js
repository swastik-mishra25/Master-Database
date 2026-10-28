(function (root) {
  function validFoundedYear(value, currentYear = new Date().getFullYear()) {
    const year = Number(value);
    return Number.isInteger(year) && year >= 1800 && year <= currentYear ? year : null;
  }

  function getCompanyAgeYears(foundedYear, asOf = new Date()) {
    const year = validFoundedYear(foundedYear, asOf.getFullYear());
    return year === null ? null : asOf.getFullYear() - year;
  }

  function findCompanyStartYear(pages, currentYear = new Date().getFullYear()) {
    const patterns = [
      /\b(?:founded|established|incorporated|formed)\s+(?:in\s+)?((?:18|19|20)\d{2})\b/i,
      /\bbegan\s+operating\b.{0,80}?\bin\s+((?:18|19|20)\d{2})\b/i
    ];

    for (const page of Array.isArray(pages) ? pages : []) {
      if (page.sourceType !== "company website" || typeof page.text !== "string") continue;
      for (const pattern of patterns) {
        const match = pattern.exec(page.text);
        if (!match) continue;
        const startYear = validFoundedYear(match[1], currentYear);
        if (startYear === null) continue;
        const start = Math.max(0, match.index - 70);
        const end = Math.min(page.text.length, match.index + match[0].length + 70);
        return {
          startYear,
          quote: page.text.slice(start, end).replace(/\s+/g, " ").trim(),
          sourceUrl: page.url
        };
      }
    }

    return null;
  }

  root.getCompanyAgeYears = getCompanyAgeYears;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { findCompanyStartYear, getCompanyAgeYears };
  }
})(globalThis);
