const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  detectWebsiteWorkflowSignals,
  summarizeWebsiteWorkflowSignals
} = require("../website-workflow-signals");

test("detects enquiry, booking, FAQ, and customer-support options on public pages", () => {
  const signals = detectWebsiteWorkflowSignals(`
    <title>Clinic appointments and FAQs</title>
    <a href="/book-appointment">Book appointment</a>
    <a href="/faqs">Frequently asked questions</a>
    <a href="tel:+911234567890">Call customer support</a>
    <form action="/contact"><label>Send an enquiry</label><input name="email"></form>
  `);

  assert.deepEqual(signals, {
    enquiryForm: true,
    bookingWorkflow: true,
    faqs: true,
    customerSupport: true
  });
});

test("reports only detected features and does not treat their absence as proof of a gap", () => {
  const signals = detectWebsiteWorkflowSignals("<title>Company home</title><p>Our services</p>");
  const audit = summarizeWebsiteWorkflowSignals([{
    sourceType: "company website",
    websiteWorkflowSignals: signals
  }]);

  assert.deepEqual(audit, {
    scannedPages: 1,
    workflows: {
      enquiryForm: "not_detected",
      bookingWorkflow: "not_detected",
      faqs: "not_detected",
      customerSupport: "not_detected"
    }
  });
});

test("ignores search snippets when summarizing website workflow coverage", () => {
  const audit = summarizeWebsiteWorkflowSignals([{
    sourceType: "web search",
    websiteWorkflowSignals: {
      enquiryForm: true,
      bookingWorkflow: true,
      faqs: true,
      customerSupport: true
    }
  }]);

  assert.equal(audit.scannedPages, 0);
  assert.ok(Object.values(audit.workflows).every(status => status === "not_detected"));
});
