(function (root) {
  function normalizePhoneNumber(value) {
    if (typeof value !== "string") return "";
    const cleaned = value.trim().replace(/^'+/, "");
    const hasLeadingPlus = cleaned.startsWith("+");
    const compact = cleaned.replace(/[^\d+]/g, "");
    if (compact.includes("+") && !compact.startsWith("+")) return "";

    const digits = compact.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15 || /(\d)\1{6,}/.test(digits)) return "";
    return hasLeadingPlus ? `+${digits}` : digits;
  }

  function normalizePhoneNumbers(values) {
    if (!Array.isArray(values)) return [];
    return [...new Set(values.map(normalizePhoneNumber).filter(Boolean))];
  }

  root.normalizePhoneNumber = normalizePhoneNumber;
  root.normalizePhoneNumbers = normalizePhoneNumbers;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { normalizePhoneNumber, normalizePhoneNumbers };
  }
})(globalThis);
