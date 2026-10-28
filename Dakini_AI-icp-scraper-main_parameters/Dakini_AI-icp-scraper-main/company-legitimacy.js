const GENERIC_IDENTITY_TOKENS = new Set([
  "agency", "agencies", "and", "company", "creative", "digital", "group", "growth", "india",
  "inc", "incorporated", "limited", "llc", "llp", "ltd", "media", "marketing", "online", "private", "pvt",
  "services", "solution", "solutions", "technologies", "technology", "the",
  "web", "website"
]);
const LEGAL_IDENTITY_TOKENS = new Set([
  "inc", "incorporated", "limited", "llc", "llp", "ltd", "private", "pvt"
]);

const LEGITIMATE_BUSINESS_SIGNAL = /\bdigital marketing\b|\bmarketing agenc(?:y|ies)\b|\bseo\b|\bsearch engine optimization\b|\bperformance marketing\b|\bpaid media\b|\bsocial media marketing\b|\bcontent marketing\b|\bbranding\b|\blead generation\b/i;
const COMPANY_PROFILE_SIGNAL = /\babout us\b|\bour team\b|\bcontact us\b|\bprivacy policy\b|\bterms and conditions\b|\b(?:private limited|pvt\.?\s*ltd\.?|limited liability partnership|llp|incorporated)\b|\bregistered office\b|\bcorporate office\b/i;
const CONTACT_SIGNAL = /\bcontact us\b|\bget in touch\b|\bemail us\b|\bphone(?: number)?\b|\bcall us\b|\baddress\b|mailto:|tel:/i;

function normalizedTokens(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
}

function hasIdentityMatch(companyName, domain, homepageTitle, homepageText) {
  const companyTokens = [...new Set(normalizedTokens(companyName)
    .filter(token => token.length > 1 && !GENERIC_IDENTITY_TOKENS.has(token)))];
  if (!companyTokens.length) return false;

  const domainTokens = normalizedTokens(domain);
  const titleTokens = normalizedTokens(homepageTitle);
  const bodyText = homepageTitle
    ? homepageText.replace(homepageTitle, "")
    : homepageText;
  const introductionTokens = normalizedTokens(bodyText.slice(0, 1200));
  const matchesCount = tokens => companyTokens.filter(token => tokens.includes(token)).length;
  const brandTokens = normalizedTokens(companyName)
    .filter(token => !LEGAL_IDENTITY_TOKENS.has(token));
  const compactBrand = brandTokens.join("");
  const compactBrandWithTechnologyAbbreviation = brandTokens
    .map(token => token === "technology" || token === "technologies" ? "tech" : token)
    .join("");
  const domainLabels = String(domain || "").toLowerCase().split(".").filter(Boolean);
  const exactDomainBrandMatch = [compactBrand, compactBrandWithTechnologyAbbreviation]
    .some(brand => brand.length >= 4 &&
      domainLabels.some(label => label.replace(/[^a-z0-9]/g, "") === brand));

  if (exactDomainBrandMatch &&
      (matchesCount(titleTokens) > 0 || matchesCount(introductionTokens) > 0)) {
    return true;
  }

  if (companyTokens.length === 1) {
    const titleMatches = matchesCount(titleTokens) > 0;
    const introductionMatches = matchesCount(introductionTokens) > 0;
    const domainMatches = matchesCount(domainTokens) > 0;
    return domainMatches && (titleMatches || introductionMatches);
  }

  const titleMatches = matchesCount(titleTokens);
  const introductionMatches = matchesCount(introductionTokens);
  return introductionMatches >= 2 || (titleMatches >= 2 && introductionMatches >= 1);
}

function findFirstPartyIdentityPage(companyName, domain, pages) {
  return pages.find(page => hasIdentityMatch(
    companyName,
    domain,
    page.title || "",
    page.text || ""
  )) || null;
}

function refreshStoredLegitimacy(company) {
  const legitimacy = company.legitimacy;
  if (!legitimacy || legitimacy.identityMatch ||
      !legitimacy.components || typeof legitimacy.components !== "object") {
    return false;
  }
  const domain = String(company.domain || company.id || "")
    .toLowerCase().replace(/^www\./, "");
  const identityPage = (company.pagesScanned || []).find(page => {
    if (page.sourceType !== "company website") return false;
    try {
      const hostname = new URL(page.url).hostname.toLowerCase().replace(/^www\./, "");
      return (hostname === domain || hostname.endsWith(`.${domain}`)) &&
        hasIdentityMatch(company.companyName, domain, page.title || "", page.title || "");
    } catch {
      return false;
    }
  });
  if (!identityPage) return false;

  legitimacy.identityMatch = true;
  legitimacy.homepageIdentityEvidence = identityPage.url === company.sourceUrl;
  legitimacy.firstPartyIdentityEvidence = true;
  legitimacy.identityEvidenceSourceUrl = identityPage.url;
  legitimacy.components.companyIdentityMatch = 30;
  legitimacy.score = Math.min(100,
    Object.values(legitimacy.components).reduce((total, value) => total + value, 0)
  );
  legitimacy.reasons = (legitimacy.reasons || []).filter(reason =>
    !/company name could not be corroborated/i.test(reason)
  );
  const components = legitimacy.components;
  const strongEvidence = Boolean(
    components.firstPartyWebsite &&
    components.companyIdentityMatch &&
    components.marketingBusinessEvidence &&
    components.publicContactEvidence &&
    components.companyProfileEvidence &&
    components.multipleFirstPartyPages &&
    legitimacy.firstPartyPagesScanned >= 2
  );
  legitimacy.status = strongEvidence
    ? "strong_evidence"
    : legitimacy.score >= 45 ? "review" : "unverified";
  legitimacy.canAutoQualify = strongEvidence;
  return true;
}

function assessCompanyLegitimacy({
  companyName,
  domain,
  pages = []
}) {
  const firstPartyPages = pages.filter(page =>
    page.sourceType !== "web search" &&
    page.sourceType !== "public directory listing" &&
    typeof page.text === "string" &&
    page.text.trim() &&
    (() => {
      try {
        const hostname = new URL(page.url).hostname.toLowerCase().replace(/^www\./, "");
        const companyDomain = String(domain || "").toLowerCase().replace(/^www\./, "");
        return hostname === companyDomain || hostname.endsWith(`.${companyDomain}`);
      } catch {
        return false;
      }
    })()
  );
  const allText = firstPartyPages.map(page => page.text).join(" ");
  const homepage = firstPartyPages.find(page => {
    try {
      return new URL(page.url).pathname === "/";
    } catch {
      return false;
    }
  }) || firstPartyPages[0];
  const homepageTitle = homepage?.title || "";
  const homepageText = homepage?.text || "";
  const identityPage = findFirstPartyIdentityPage(companyName, domain, firstPartyPages);
  const identityMatch = Boolean(identityPage);
  const businessEvidence = LEGITIMATE_BUSINESS_SIGNAL.test(allText);
  const hasContactEvidence = firstPartyPages.some(page =>
    CONTACT_SIGNAL.test(page.text) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(page.text) ||
    /\/(?:contact(?:-us)?|support|customer-care|help)(?:\/|$)/i.test(new URL(page.url).pathname) &&
      /\b(?:email|message|submit|phone|address)\b/i.test(page.text)
  );
  const hasCompanyProfileEvidence = firstPartyPages.some(page =>
    /\/(?:about(?:-us)?|who-we-are|our-story|our-team|team|contact(?:-us)?|privacy(?:-policy)?|terms(?:-and-conditions)?|legal)(?:\/|$)/i.test(new URL(page.url).pathname) ||
    COMPANY_PROFILE_SIGNAL.test(page.text)
  );
  const hasSubstantiveContent = allText.length >= 300;
  const uniquePagePaths = new Set(firstPartyPages.map(page => {
    const url = new URL(page.url);
    const pathname = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    return `${url.hostname.toLowerCase()}${pathname}`;
  }));
  const multipleFirstPartyPages = uniquePagePaths.size >= 2;
  const components = {
    firstPartyWebsite: firstPartyPages.length && hasSubstantiveContent ? 15 : 0,
    companyIdentityMatch: identityMatch ? 30 : 0,
    marketingBusinessEvidence: businessEvidence ? 25 : 0,
    publicContactEvidence: hasContactEvidence ? 15 : 0,
    companyProfileEvidence: hasCompanyProfileEvidence ? 15 : 0,
    multipleFirstPartyPages: multipleFirstPartyPages ? 10 : 0
  };
  const score = Math.min(100, Object.values(components).reduce((total, value) => total + value, 0));
  const status = identityMatch &&
    businessEvidence &&
    hasContactEvidence &&
    hasCompanyProfileEvidence &&
    multipleFirstPartyPages &&
    score >= 75
    ? "strong_evidence"
    : identityMatch && score >= 45
      ? "review"
      : "unverified";
  const reasons = [];
  if (!firstPartyPages.length) reasons.push("No readable first-party company website pages were scanned.");
  if (!identityMatch) reasons.push("The company name could not be corroborated on its website or domain.");
  if (!businessEvidence) reasons.push("The scanned company pages do not clearly describe a marketing business.");
  if (!hasContactEvidence) reasons.push("No public company contact channel was found on the scanned pages.");
  if (!hasCompanyProfileEvidence) reasons.push("No company profile, about, legal, or contact-page evidence was found.");
  if (!hasSubstantiveContent) reasons.push("Very little first-party company content was available.");
  if (multipleFirstPartyPages) reasons.push("Company information was checked across multiple first-party pages.");
  if (!multipleFirstPartyPages) {
    reasons.push("At least two first-party pages are needed for strong evidence.");
  }
  return {
    score,
    status,
    components,
    reasons,
    firstPartyPagesScanned: firstPartyPages.length,
    identityMatch,
    homepageIdentityEvidence: Boolean(homepage && identityPage?.url === homepage.url),
    firstPartyIdentityEvidence: Boolean(identityPage),
    identityEvidenceSourceUrl: identityPage?.url || "",
    businessEvidence,
    canAutoQualify: status === "strong_evidence"
  };
}

module.exports = { assessCompanyLegitimacy, refreshStoredLegitimacy };
