const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  assessCompanyLegitimacy,
  refreshStoredLegitimacy
} = require("../company-legitimacy");

const homepageText = [
  "Acme Growth is a digital marketing agency helping businesses with search engine optimization and performance marketing.",
  "Our team delivers paid media, content marketing, social media marketing, and lead generation services.",
  "We publish our company information and welcome prospective customers to contact our team for a consultation."
].join(" ");

test("marks a named first-party marketing company with contact and profile evidence as strong", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Acme Growth Pvt Ltd",
    domain: "acmegrowth.in",
    pages: [
      {
        url: "https://acmegrowth.in/",
        title: "Acme Growth | Digital Marketing Agency",
        text: homepageText,
        sourceType: "company website"
      },
      {
        url: "https://acmegrowth.in/contact",
        title: "Contact Acme Growth",
        text: "Contact us at hello@acmegrowth.in or call our team.",
        sourceType: "company website"
      }
    ],
    contactEmails: ["hello@acmegrowth.in"],
    contactPhones: []
  });

  assert.equal(result.status, "strong_evidence");
  assert.equal(result.canAutoQualify, true);
  assert.equal(result.identityMatch, true);
  assert.equal(result.businessEvidence, true);
  assert.ok(result.score >= 70);
});

test("does not treat search snippets or directory listings as first-party legitimacy evidence", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Acme Growth",
    domain: "acmegrowth.in",
    pages: [
      {
        url: "https://directory.example/acme",
        title: "Acme Growth",
        text: homepageText,
        sourceType: "public directory listing"
      },
      {
        url: "https://search.example/acme",
        title: "Acme Growth",
        text: homepageText,
        sourceType: "web search"
      }
    ]
  });

  assert.equal(result.status, "unverified");
  assert.equal(result.canAutoQualify, false);
  assert.equal(result.firstPartyPagesScanned, 0);
  assert.ok(result.reasons.some(reason => /first-party/i.test(reason)));
});

test("does not count pages hosted on unrelated third-party domains", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Acme Growth Pvt Ltd",
    domain: "acmegrowth.in",
    pages: [
      {
        url: "https://acmegrowth.in/",
        title: "Acme Growth",
        text: "Acme Growth",
        sourceType: "company website"
      },
      {
        url: "https://portfolio.example/about",
        title: "Acme Growth company profile",
        text: homepageText,
        sourceType: "company website"
      }
    ],
    contactEmails: ["hello@acmegrowth.in"]
  });

  assert.equal(result.firstPartyPagesScanned, 1);
  assert.equal(result.status, "unverified");
  assert.equal(result.canAutoQualify, false);
});

test("holds a company with mismatched website identity for review", () => {
  const unrelatedHomepageText = homepageText.replaceAll("Acme Growth", "Unrelated Example");
  const result = assessCompanyLegitimacy({
    companyName: "Acme Growth",
    domain: "unrelated-example.in",
    pages: [{
      url: "https://unrelated-example.in/",
      title: "Unrelated Example",
      text: unrelatedHomepageText,
      sourceType: "company website"
    }],
    contactEmails: ["info@unrelated-example.in"]
  });

  assert.equal(result.status, "unverified");
  assert.equal(result.canAutoQualify, false);
  assert.equal(result.identityMatch, false);
});

test("does not accept a single overlapping word for a multi-word company identity", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Acme Northstar",
    domain: "acme-digital.in",
    pages: [
      {
        url: "https://acme-digital.in/",
        title: "Acme Digital Marketing",
        text: "Acme provides digital marketing services, SEO, and performance marketing.",
        sourceType: "company website"
      },
      {
        url: "https://acme-digital.in/about",
        title: "About Acme",
        text: "Acme is a marketing agency providing SEO and performance marketing.",
        sourceType: "company website"
      }
    ]
  });

  assert.equal(result.identityMatch, false);
  assert.equal(result.canAutoQualify, false);
  assert.ok(result.reasons.some(reason => /company name could not be corroborated/i.test(reason)));
});

test("does not accept a title-only identity match without corroborating body text", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Acme Northstar",
    domain: "otherbrand.in",
    pages: [
      {
        url: "https://otherbrand.in/",
        title: "Acme Northstar Digital Marketing",
        text: "A digital marketing agency with SEO and performance marketing services.",
        sourceType: "company website"
      },
      {
        url: "https://otherbrand.in/contact",
        title: "Contact",
        text: "Contact us at hello@otherbrand.in for services.",
        sourceType: "company website"
      }
    ]
  });

  assert.equal(result.identityMatch, false);
  assert.equal(result.canAutoQualify, false);
});

test("accepts a brand-aligned domain with a corroborating homepage identity", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Acme Growth Pvt Ltd",
    domain: "acmegrowth.in",
    pages: [
      {
        url: "https://acmegrowth.in/",
        title: "Acme Growth | Digital Marketing Agency",
        text: homepageText,
        sourceType: "company website"
      },
      {
        url: "https://acmegrowth.in/contact",
        title: "Contact Acme Growth",
        text: "Contact us at hello@acmegrowth.in.",
        sourceType: "company website"
      }
    ]
  });

  assert.equal(result.identityMatch, true);
});

test("accepts a matching brand on an internal first-party page on its brand-aligned domain", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Anush Technology",
    domain: "anushtech.com",
    pages: [
      {
        url: "https://anushtech.com/",
        title: "Digital Marketing Services",
        text: homepageText,
        sourceType: "company website"
      },
      {
        url: "https://anushtech.com/products",
        title: "Credit Co-operative Society Management Software | Anush Technology",
        text: "Anush Technology provides software solutions to businesses.",
        sourceType: "company website"
      },
      {
        url: "https://anushtech.com/contact",
        title: "Contact",
        text: "Contact us at hello@anushtech.com.",
        sourceType: "company website"
      }
    ]
  });

  assert.equal(result.identityMatch, true);
  assert.equal(result.homepageIdentityEvidence, false);
  assert.equal(result.firstPartyIdentityEvidence, true);
  assert.equal(result.identityEvidenceSourceUrl, "https://anushtech.com/products");
});

test("does not accept a brand mention on an unrelated first-party domain", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Anush Technology",
    domain: "otherbrand.in",
    pages: [
      {
        url: "https://otherbrand.in/",
        title: "Customer stories",
        text: "This customer story mentions Anush Technology and their software.",
        sourceType: "company website"
      },
      {
        url: "https://otherbrand.in/about",
        title: "About Other Brand",
        text: "Other Brand is a software company.",
        sourceType: "company website"
      }
    ]
  });

  assert.equal(result.identityMatch, false);
  assert.equal(result.canAutoQualify, false);
});

test("refreshes stored legitimacy from a corroborating internal first-party page title", () => {
  const company = {
    id: "anushtech.com",
    companyName: "Anush Technology",
    domain: "anushtech.com",
    sourceUrl: "https://anushtech.com/",
    pagesScanned: [{
      url: "https://anushtech.com/products",
      title: "Credit Co-operative Society Management Software | Anush Technology",
      sourceType: "company website"
    }],
    legitimacy: {
      score: 80,
      status: "unverified",
      identityMatch: false,
      canAutoQualify: false,
      firstPartyPagesScanned: 8,
      reasons: ["The company name could not be corroborated on its website or domain."],
      components: {
        firstPartyWebsite: 15,
        companyIdentityMatch: 0,
        marketingBusinessEvidence: 25,
        publicContactEvidence: 15,
        companyProfileEvidence: 15,
        multipleFirstPartyPages: 10
      }
    }
  };

  assert.equal(refreshStoredLegitimacy(company), true);
  assert.equal(company.legitimacy.identityMatch, true);
  assert.equal(company.legitimacy.status, "strong_evidence");
  assert.equal(company.legitimacy.canAutoQualify, true);
  assert.equal(company.legitimacy.firstPartyIdentityEvidence, true);
  assert.equal(company.legitimacy.identityEvidenceSourceUrl, "https://anushtech.com/products");
  assert.equal(company.legitimacy.reasons.length, 0);
});

test("does not refresh stored identity from unrelated or non-company page metadata", () => {
  const company = {
    id: "otherbrand.in",
    companyName: "Anush Technology",
    domain: "otherbrand.in",
    pagesScanned: [{
      url: "https://otherbrand.in/customer-story",
      title: "Customer story mentioning Anush Technology",
      sourceType: "company website"
    }, {
      url: "https://anushtech.com/",
      title: "Anush Technology",
      sourceType: "public directory listing"
    }],
    legitimacy: {
      identityMatch: false,
      canAutoQualify: false,
      components: { companyIdentityMatch: 0 }
    }
  };

  assert.equal(refreshStoredLegitimacy(company), false);
  assert.equal(company.legitimacy.identityMatch, false);
});

test("requires a public contact path before a candidate can auto-qualify", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Acme Growth Pvt Ltd",
    domain: "acmegrowth.in",
    pages: [{
      url: "https://acmegrowth.in/",
      title: "Acme Growth | Digital Marketing Agency",
      text: homepageText,
      sourceType: "company website"
    }]
  });

  assert.equal(result.status, "review");
  assert.equal(result.canAutoQualify, false);
  assert.ok(result.reasons.some(reason => /contact channel/i.test(reason)));
});

test("does not use contact details from search or directory evidence", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Acme Growth Pvt Ltd",
    domain: "acmegrowth.in",
    pages: [
      {
        url: "https://acmegrowth.in/",
        title: "Acme Growth | Digital Marketing Agency",
        text: homepageText,
        sourceType: "company website"
      },
      {
        url: "https://acmegrowth.in/about",
        title: "About Acme Growth",
        text: `${homepageText} We are a privately operated marketing business serving customers across India.`,
        sourceType: "company website"
      },
      {
        url: "https://directory.example/acme",
        title: "Contact Acme Growth",
        text: "Email hello@acmegrowth.in or call +91 98765 43210",
        sourceType: "public directory listing"
      }
    ],
    contactEmails: ["hello@acmegrowth.in"],
    contactPhones: ["+919876543210"]
  });

  assert.equal(result.status, "review");
  assert.equal(result.canAutoQualify, false);
  assert.ok(result.reasons.some(reason => /contact channel/i.test(reason)));
});

test("requires two distinct first-party page paths for strong evidence", () => {
  const result = assessCompanyLegitimacy({
    companyName: "Acme Growth Pvt Ltd",
    domain: "acmegrowth.in",
    pages: [
      {
        url: "https://acmegrowth.in/",
        title: "Acme Growth | Digital Marketing Agency",
        text: `${homepageText} Contact us at hello@acmegrowth.in.`,
        sourceType: "company website"
      },
      {
        url: "https://acmegrowth.in/?utm_source=directory",
        title: "Acme Growth | Digital Marketing Agency",
        text: `${homepageText} Contact us at hello@acmegrowth.in.`,
        sourceType: "company website"
      }
    ]
  });

  assert.equal(result.status, "review");
  assert.equal(result.canAutoQualify, false);
  assert.ok(result.reasons.some(reason => /at least two first-party pages/i.test(reason)));
});

test("does not treat profile-like words in a domain as profile-page evidence", () => {
  const text = "Acme is a digital marketing agency offering SEO and performance marketing services. ".repeat(5);
  const result = assessCompanyLegitimacy({
    companyName: "Acme",
    domain: "team-acme.in",
    pages: [
      {
        url: "https://team-acme.in/",
        title: "Acme Digital Marketing",
        text: `${text} Email hello@team-acme.in for service information.`,
        sourceType: "company website"
      },
      {
        url: "https://team-acme.in/services",
        title: "Acme Services",
        text,
        sourceType: "company website"
      }
    ]
  });

  assert.equal(result.status, "review");
  assert.equal(result.canAutoQualify, false);
  assert.ok(result.reasons.some(reason => /company profile/i.test(reason)));
});
