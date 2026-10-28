const DAKINI_CORE_WORKFLOWS = new Set([
  "customer support",
  "lead qualification",
  "sales follow-up",
  "knowledge and FAQs",
  "product recommendations"
]);

const WORKFLOW_ALIASES = [
  {
    key: "customer support",
    pattern: /\bcustomer support\b|\bcustomer service\b|\bcustomer care\b|\bcomplaint handling\b|\bcustomer quer(?:y|ies)\b|\bcustomer inquiries\b|\bcustomer enquiries\b/i
  },
  {
    key: "lead qualification",
    pattern: /\blead qualification\b|\bqualify leads\b|\bsales enquiries\b|\bsales inquiries\b|\blead generation\b|\bprospect qualification\b/i
  },
  {
    key: "sales follow-up",
    pattern: /\bsales follow.?up\b|\bfollow.?up calls\b|\bschedule demos?\b|\bdemo booking\b|\bsales agent\b|\bsales calls\b/i
  },
  {
    key: "knowledge and FAQs",
    pattern: /\bknowledge (?:and )?faqs?\b|\bknowledge agent\b|\bfrequently asked questions\b|\bfaqs?\b|\bself.service\b|\bpolicy questions\b|\bprocess questions\b/i
  },
  {
    key: "product recommendations",
    pattern: /\bproduct recommendations?\b|\bpersonalized shopping\b|\bproduct discovery\b|\bshopping assistant\b/i
  }
];

const INDUSTRY_ALIASES = [
  {
    key: "banking and financial services",
    pattern: /\bbfsi\b|\bbank(?:ing)?\b|\bfinancial services\b|\bfintech\b|\binsurance\b|\binsurer\b|\bcredit union\b/i
  },
  {
    key: "healthcare",
    pattern: /\bhealthcare\b|\bclinics?\b|\bhospitals?\b|\bmedical\b|\bpatient care\b/i
  },
  {
    key: "digital marketing",
    pattern: /\bdigital marketing\b|\bseo agency\b|\bperformance marketing\b|\bmarketing agency\b/i
  },
  {
    key: "education",
    pattern: /\beducation\b|\bschools?\b|\buniversit(?:y|ies)\b|\bcolleges?\b|\blearning cent(?:er|re)s?\b/i
  },
  {
    key: "real estate",
    pattern: /\breal estate\b|\bproperty management\b|\brealtors?\b/i
  },
  {
    key: "recruitment",
    pattern: /\brecruitment\b|\bstaffing\b|\btalent acquisition\b|\bplacement agenc(?:y|ies)\b/i
  },
  {
    key: "hospitality",
    pattern: /\bhospitality\b|\bhotels?\b|\btravel\b|\btourism\b|\bairlines?\b/i
  }
];

const SCORE_COMPONENT_MAXIMUMS = {
  serviceFit: 30,
  operatingScale: 25,
  indiaMarketFit: 5,
  integrationReadiness: 8,
  buyingSignals: 15,
  reachability: 5,
  firstPartyWorkflowFit: 12
};
const HIGH_POTENTIAL_SCORE_THRESHOLD = 90;

function normalizedText(value) {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    : "";
}

function matchingAlias(value, aliases) {
  const text = normalizedText(value);
  return text ? aliases.find(alias => alias.pattern.test(text))?.key || "" : "";
}

function workflowsMatch(left, right) {
  const leftText = normalizedText(left);
  const rightText = normalizedText(right);
  if (!leftText || !rightText) return false;
  const leftAlias = matchingAlias(left, WORKFLOW_ALIASES);
  const rightAlias = matchingAlias(right, WORKFLOW_ALIASES);
  return leftAlias && rightAlias
    ? leftAlias === rightAlias
    : leftText === rightText;
}

function industriesMatch(left, right) {
  const leftText = normalizedText(left);
  const rightText = normalizedText(right);
  if (!leftText || !rightText) return false;
  const leftAlias = matchingAlias(left, INDUSTRY_ALIASES);
  const rightAlias = matchingAlias(right, INDUSTRY_ALIASES);
  return leftAlias && rightAlias
    ? leftAlias === rightAlias
    : leftText === rightText ||
      leftText.includes(rightText) ||
      rightText.includes(leftText);
}

function scoreLead(data, icp) {
  const industries = Array.isArray(icp.industries) ? icp.industries : [];
  const locations = Array.isArray(icp.locations) ? icp.locations : [];
  const useCases = Array.isArray(icp.useCases) ? icp.useCases : [];
  const detectedUseCases = Array.isArray(data.detectedUseCases)
    ? data.detectedUseCases
    : [];
  const industry = data.industry || "Unknown";
  const sourceText = typeof data.sourceText === "string" ? data.sourceText : "";
  const industryMatches = industries.some(target => industriesMatch(industry, target));
  const useCaseMatches = useCases.filter(target =>
    detectedUseCases.some(found => workflowsMatch(found, target))
  );
  const locationMatches = Boolean(icp.anyLocation) || locations.some(target =>
    target.toLowerCase() === "india"
      ? Boolean(data.indiaMarketSignal) ||
        /\b(?:India|Indian|INR|rupees?)\b/i.test(sourceText)
      : (Array.isArray(data.locations) &&
          data.locations.some(found => normalizedText(found) === normalizedText(target))) ||
        sourceText.toLowerCase().includes(target.toLowerCase())
  );
  const dakiniWorkflowMatches = [...new Set(detectedUseCases
    .map(useCase =>
      [...DAKINI_CORE_WORKFLOWS].find(workflow => workflowsMatch(useCase, workflow))
    )
    .filter(Boolean))];
  const callingTeam = Boolean(data.callingTeam);
  const branches = Number(data.branches) || 0;
  const highCallVolume = Boolean(data.highCallVolume);
  const extendedHours = Boolean(data.extendedHours);
  const voiceHiringSignal = Boolean(data.voiceHiringSignal);
  const telephonyOrCrm = Boolean(data.telephonyOrCrm);
  const systemIntegrationSignal = Boolean(data.systemIntegrationSignal);
  const automationIntent = Boolean(data.automationIntent);
  const expansionSignal = Boolean(data.expansionSignal);
  const indiaMarketSignal = Boolean(data.indiaMarketSignal);
  const multilingualSignal = Boolean(data.multilingualSignal);
  const websiteWorkflowSignals = data.websiteWorkflowSignals || {};
  const firstPartyWorkflowFit =
    (websiteWorkflowSignals.customerSupport === "found" ? 4 : 0) +
    (websiteWorkflowSignals.enquiryForm === "found" ? 3 : 0) +
    (websiteWorkflowSignals.faqs === "found" ? 3 : 0) +
    (websiteWorkflowSignals.bookingWorkflow === "found" ? 2 : 0);
  const hasOperatingScaleSignal = callingTeam ||
    branches >= 2 ||
    highCallVolume ||
    extendedHours ||
    voiceHiringSignal;
  const components = {
    serviceFit: dakiniWorkflowMatches.length
      ? Math.min(30, 15 + (dakiniWorkflowMatches.length - 1) * 10)
      : 0,
    operatingScale: Math.min(25,
      (callingTeam ? 5 : 0) +
      (branches >= 2 ? 4 : 0) +
      (highCallVolume ? 8 : 0) +
      (extendedHours ? 4 : 0) +
      (voiceHiringSignal ? 4 : 0)
    ),
    indiaMarketFit:
      (indiaMarketSignal ? 3 : 0) +
      (multilingualSignal ? 2 : 0),
    integrationReadiness:
      (telephonyOrCrm ? 5 : 0) +
      (systemIntegrationSignal ? 3 : 0),
    buyingSignals:
      (automationIntent ? 12 : 0) +
      (expansionSignal ? 3 : 0),
    reachability: (data.roleEmail ? 3 : 0) + (data.phone ? 2 : 0),
    firstPartyWorkflowFit
  };
  const rawScore = Object.keys(SCORE_COMPONENT_MAXIMUMS)
    .reduce((total, key) => total + components[key], 0);
  const aiSolutionProvider = Boolean(data.aiSolutionProvider);
  components.aiVendorExclusion = aiSolutionProvider ? -Math.max(0, rawScore - 20) : 0;
  const score = +(rawScore + components.aiVendorExclusion).toFixed(1);
  const strongIcpMatch = (!industries.length || industryMatches) &&
    (!useCases.length || useCaseMatches.length > 0) &&
    (!locations.length || locationMatches);
  const hasCoreWorkflow = dakiniWorkflowMatches.length > 0;
  const tier = !aiSolutionProvider &&
    score >= HIGH_POTENTIAL_SCORE_THRESHOLD &&
    strongIcpMatch &&
    hasCoreWorkflow &&
    Boolean(data.buyingSignal)
    ? "Priority"
    : !aiSolutionProvider &&
      score >= 45 &&
      strongIcpMatch &&
      hasCoreWorkflow &&
      (hasOperatingScaleSignal || components.integrationReadiness > 0)
      ? "Review"
      : "Low fit";

  return {
    score,
    tier,
    strongIcpMatch,
    buyingSignal: Boolean(data.buyingSignal),
    matchedUseCases: useCaseMatches,
    dakiniWorkflowMatches,
    scoreComponentMaximums: SCORE_COMPONENT_MAXIMUMS,
    exclusionReason: aiSolutionProvider
      ? "This company appears to sell AI, voice-agent, or contact-center software rather than primarily operate as a potential customer."
      : "",
    components
  };
}

module.exports = { HIGH_POTENTIAL_SCORE_THRESHOLD, scoreLead };
