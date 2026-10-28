const dns = require("node:dns/promises");
const net = require("node:net");
const { Agent } = require("undici");

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15000;

function isPublicIPv4(address) {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }
  const [first, second, third] = octets;
  return !(
    first === 0 || first === 10 || first === 127 || first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19 || second === 51 && third === 100)) ||
    (first === 203 && second === 0 && third === 113) ||
    first === 255
  );
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isPublicIPv4(address);
  if (family !== 6) return false;

  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) {
    const mappedAddress = normalized.slice("::ffff:".length);
    if (net.isIP(mappedAddress) === 4) return isPublicIPv4(mappedAddress);
    const mappedGroups = mappedAddress.split(":");
    if (mappedGroups.length === 2 && mappedGroups.every(group => /^[\da-f]{1,4}$/.test(group))) {
      const high = parseInt(mappedGroups[0], 16);
      const low = parseInt(mappedGroups[1], 16);
      return isPublicIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return false;
  }

  const firstGroup = parseInt(normalized.split(":")[0] || "0", 16);
  if (firstGroup < 0x2000 || firstGroup > 0x3fff) return false;
  if (normalized.startsWith("2002:")) return false;
  if (normalized.startsWith("2001:db8:")) return false;
  const secondGroup = parseInt(normalized.split(":")[1] || "0", 16);
  if (firstGroup === 0x2001 && secondGroup <= 0x01ff) return false;
  return true;
}

async function resolvePublicHostname(hostname, lookup = dns.lookup) {
  const unwrappedHostname = hostname.replace(/^\[|\]$/g, "");
  if (["localhost", "localhost.localdomain"].includes(unwrappedHostname.toLowerCase()) ||
      /\.(?:localhost|local|internal|test)$/i.test(unwrappedHostname)) {
    throw new Error("Private or local hosts are blocked.");
  }

  if (net.isIP(unwrappedHostname)) {
    if (!isPublicAddress(unwrappedHostname)) throw new Error("Private or local hosts are blocked.");
    return [{ address: unwrappedHostname, family: net.isIP(unwrappedHostname) }];
  }

  const addresses = await lookup(unwrappedHostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(record => !isPublicAddress(record.address))) {
    throw new Error("Private or local hosts are blocked.");
  }
  return addresses;
}

async function validatePublicUrl(value, lookup = dns.lookup) {
  if (typeof value !== "string" || value.length > 2048) {
    throw new Error("URL is missing or too long.");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("Only public HTTP/HTTPS URLs without embedded credentials are allowed.");
  }
  if (parsed.port && parsed.port !== "80" && parsed.port !== "443") {
    throw new Error("Only standard HTTP/HTTPS ports are allowed.");
  }
  await resolvePublicHostname(parsed.hostname, lookup);
  parsed.hash = "";
  return parsed;
}

async function fetchPublicPage(value, options = {}) {
  const lookup = options.lookup || dns.lookup;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let currentUrl = value;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const parsed = await validatePublicUrl(currentUrl, lookup);
    const addresses = await resolvePublicHostname(parsed.hostname, lookup);
    const dispatcher = new Agent({
      connect: {
        lookup(hostname, lookupOptions, callback) {
          if (lookupOptions?.all) callback(null, addresses);
          else callback(null, addresses[0].address, addresses[0].family);
        }
      }
    });

    try {
      const response = await fetchImpl(parsed.href, {
        dispatcher,
        redirect: "manual",
        signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
          "User-Agent": "Dakini-Research/1.0"
        }
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("Website returned a redirect without a destination.");
        if (redirectCount >= MAX_REDIRECTS) throw new Error("Website exceeded the redirect limit.");
        currentUrl = new URL(location, parsed).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (contentType && !/^(text\/html|application\/xhtml\+xml|text\/plain)(?:\s*;|$)/i.test(contentType)) {
        await response.body?.cancel();
        throw new Error("Website returned an unsupported content type.");
      }
      if (!response.body) return "";

      const reader = response.body.getReader();
      const chunks = [];
      let totalBytes = 0;
      try {
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          totalBytes += chunk.byteLength;
          if (totalBytes > MAX_RESPONSE_BYTES) {
            await reader.cancel();
            throw new Error("Website response exceeded the 5 MB limit.");
          }
          chunks.push(Buffer.from(chunk));
        }
      } finally {
        reader.releaseLock();
      }
      return Buffer.concat(chunks, totalBytes).toString("utf8");
    } finally {
      await dispatcher.close();
    }
  }
}

module.exports = { isPublicAddress, resolvePublicHostname, validatePublicUrl, fetchPublicPage };
