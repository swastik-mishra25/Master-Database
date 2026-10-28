const cheerio = require("cheerio");

const WEBSITE_WORKFLOW_SIGNAL_PATTERNS = {
  enquiryForm: /\b(?:enquir(?:y|ies)|inquir(?:y|ies)|contact us|get in touch|request (?:a )?(?:call|demo|quote|consultation)|callback)\b/i,
  bookingWorkflow: /\b(?:book(?:ing)?|appointment|reservation|consultation|schedule (?:a |an )?(?:visit|call|demo))\b/i,
  faqs: /\b(?:faqs?|frequently asked questions|knowledge base)\b/i,
  customerSupport: /\b(?:customer support|customer service|help ?desk|support center|support centre|help center|help centre|customer care|contact us|live chat)\b/i
};

function elementTextAndAttributes($, selector) {
  return $(selector).map((_, element) => {
    const attributes = Object.values(element.attribs || {}).join(" ");
    return `${$(element).text()} ${attributes}`;
  }).get().join(" ");
}

function detectWebsiteWorkflowSignals(html) {
  const $ = cheerio.load(String(html || ""));
  const formContent = elementTextAndAttributes($, "form");
  const formControls = elementTextAndAttributes($, "form input, form textarea, form select, form button");
  const enquiryForm = Boolean(formContent) && (
    WEBSITE_WORKFLOW_SIGNAL_PATTERNS.enquiryForm.test(formContent) ||
    (/\b(?:email|phone|message|name)\b/i.test(formControls) && $("form button[type='submit'], form input[type='submit']").length > 0)
  );
  const bookingContent = elementTextAndAttributes($, "a, button, input, form");
  const pageHeadingsAndLinks = elementTextAndAttributes($, "title, h1, h2, h3, a, summary, button");
  const supportLinks = $("a[href^='mailto:' i], a[href^='tel:' i]").length > 0 ||
    /(?:intercom|zendesk|freshdesk|tawk|crisp|chat-widget)/i.test(
      elementTextAndAttributes($, "[id], [class], [data-testid], [aria-label]")
    );

  return {
    enquiryForm,
    bookingWorkflow: WEBSITE_WORKFLOW_SIGNAL_PATTERNS.bookingWorkflow.test(bookingContent),
    faqs: WEBSITE_WORKFLOW_SIGNAL_PATTERNS.faqs.test(pageHeadingsAndLinks),
    customerSupport: supportLinks ||
      WEBSITE_WORKFLOW_SIGNAL_PATTERNS.customerSupport.test(pageHeadingsAndLinks)
  };
}

function summarizeWebsiteWorkflowSignals(pages) {
  const signals = Object.keys(WEBSITE_WORKFLOW_SIGNAL_PATTERNS);
  const scannedPages = (Array.isArray(pages) ? pages : [])
    .filter(page => page?.sourceType !== "web search" && page?.websiteWorkflowSignals);
  return {
    scannedPages: scannedPages.length,
    workflows: Object.fromEntries(signals.map(signal => [
      signal,
      scannedPages.some(page => page.websiteWorkflowSignals[signal]) ? "found" : "not_detected"
    ]))
  };
}

module.exports = {
  detectWebsiteWorkflowSignals,
  summarizeWebsiteWorkflowSignals
};
