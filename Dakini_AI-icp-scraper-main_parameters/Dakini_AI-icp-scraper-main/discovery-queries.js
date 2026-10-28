const {
  INDIA_DISCOVERY_LOCATIONS
} = require("./india-geography");

const DISCOVERY_INDUSTRIES = [
  "Banking & Financial Services",
  "Insurance",
  "Healthcare",
  "Clinics",
  "Retail",
  "E-commerce",
  "Education",
  "Education Centres",
  "Real Estate",
  "Real Estate Agencies",
  "Hospitality",
  "Hotels",
  "Recruitment Firms",
  "Logistics",
  "Telecom",
  "Professional Services",
  "Manufacturing",
  "Automotive",
  "Travel",
  "SaaS",
  "Digital Marketing Agency"
];

const DISCOVERY_QUERY_TEMPLATES = [
  "{location} {industry} company customer enquiries contact",
  "{location} {industry} company customer support contact",
  "{location} {industry} appointments consultations reservations bookings",
  "{location} {industry} online booking appointment consultation",
  "{location} {industry} careers hiring customer support receptionist telecaller",
  "{location} {industry} hiring appointment setter customer service jobs",
  "{location} {industry} multiple branches locations offices",
  "{location} {industry} company locations branches service centres",
  "{location} {industry} website enquiry form FAQs customer support",
  "{location} {industry} website contact booking support options",
  "{location} {industry} book an appointment online",
  "{location} {industry} schedule a consultation online",
  "{location} {industry} make a reservation or service booking",
  "{location} {industry} appointment availability phone contact",
  "{location} {industry} online booking customer enquiries",
  "{location} {industry} careers receptionist front desk jobs",
  "{location} {industry} customer service representative hiring",
  "{location} {industry} telecaller customer support vacancies",
  "{location} {industry} appointment setter jobs careers",
  "{location} {industry} call centre customer care recruitment",
  "{location} {industry} contact centre hiring customer service",
  "{location} {industry} branch list locations near me",
  "{location} {industry} multiple locations official website",
  "{location} {industry} offices and branches contact numbers",
  "{location} {industry} locations directory service centres",
  "{location} {industry} company expands new branches locations",
  "{location} {industry} FAQ frequently asked questions website",
  "{location} {industry} contact us enquiry form official website",
  "{location} {industry} customer care help support options website",
  "{location} {industry} online appointment request contact form",
  "{location} {industry} book consultation contact form FAQ",
  "{location} {industry} official website services contact phone",
  "{location} {industry} reservations enquiry customer support",
  "{location} {industry} reception desk enquiries booking",
  "{location} {industry} schedule service appointment online",
  "{location} {industry} request an appointment contact form",
  "{location} {industry} book a consultation or call",
  "{location} {industry} appointment enquiries phone number",
  "{location} {industry} reservation availability online",
  "{location} {industry} front office executive recruitment",
  "{location} {industry} receptionist vacancy careers page",
  "{location} {industry} call centre agent hiring jobs",
  "{location} {industry} customer care executive job opening",
  "{location} {industry} telecalling sales support hiring",
  "{location} {industry} reception and customer enquiries jobs",
  "{location} {industry} branch locator contact details",
  "{location} {industry} find our locations offices nationwide",
  "{location} {industry} branch locations customer support",
  "{location} {industry} list of locations and opening hours",
  "{location} {industry} offices contact details all locations",
  "{location} {industry} FAQ help centre contact page",
  "{location} {industry} customer service phone email contact",
  "{location} {industry} send an enquiry online form",
  "{location} {industry} website request callback form",
  "{location} {industry} online reservation booking contact",
  "{location} {industry} customer support opening hours FAQ",
  "{location} {industry} service enquiry appointments contact us"
];

const DISCOVERY_BUYING_SIGNAL_QUERIES = [
  '"appointment booking" OR reservations {industry} {location}',
  '"consultations appointments online booking" {industry} {location}',
  '"hiring receptionist" OR telecaller OR "customer support" {industry} {location}',
  '"customer service appointment setter jobs" {industry} {location}',
  '"multiple branches" OR locations OR offices {industry} {location}',
  '"website enquiry form" OR FAQ OR "customer support" {industry} {location}',
  '"AI voice agent" OR "voice AI" {industry} {location}',
  '"customer support automation" RFP OR pilot {industry} {location}',
  '"new branch" OR "branch opening" OR "new location" OR acquisition OR "new service" {industry} {location}',
  'partners OR consultants OR agencies serving {industry} {location} customer support integration',
  '"uses" Freshdesk OR Zendesk OR Intercom OR Salesforce {industry} {location}',
  '"order status" OR delivery OR returns OR refunds customer service {industry} {location}',
  'government company registry OR industry association directory {industry} {location}',
  '"support email" OR "contact number" OR enquiry form OR booking link {industry} {location}',
  'CRM OR helpdesk OR booking software OR customer communication technology {industry} {location}',
  'business news expansion OR new product OR new customers OR customer service initiative {industry} {location}',
  'franchise network OR franchise operators OR franchise locations {industry} {location}',
  'Tamil OR Hindi OR English multilingual customer support {industry} {location}'
];

const DAILY_DISCOVERY_QUERIES_PER_RUN = 100;
const DISCOVERY_INDUSTRY_QUERIES_PER_RUN =
  DAILY_DISCOVERY_QUERIES_PER_RUN - DISCOVERY_BUYING_SIGNAL_QUERIES.length;
const DISCOVERY_RELEVANCE_SIGNAL =
  /\b(?:banking|financial services|insurance|healthcare|clinic|medical|retail|e-?commerce|education|school|college|real estate|property|hospitality|hotel|recruitment|staffing|logistics|telecom|professional services|manufacturing|automotive|travel|saas|marketing|seo|paid media|appointment|consultation|reservation|booking|receptionist|telecaller|customer support|customer service|multiple branches|branch(?:es| locations)?|locations?|offices?|enquir(?:y|ies)|inquir(?:y|ies)|faq|help|contact|voice ai|voice agent|expansion|acquisition|new service|new product|partner|consultant|agency|order status|delivery|returns|refunds|registry|association|support email|CRM|helpdesk|booking software|business news|franchise|Tamil|Hindi|English|Freshdesk|Zendesk|Intercom|Salesforce)\b/i;
const MARKETING_SEARCH_SIGNAL =
  /\b(?:digital marketing|marketing (?:agenc(?:y|ies)|company|automation)|seo agency|search engine optimization|performance marketing|paid media|social media (?:marketing|agenc(?:y|ies))|content marketing|lead generation|growth marketing)\b/i;

function hasRelevantDiscoveryEvidence(evidence) {
  return Array.isArray(evidence) && evidence.some(item => {
    const snippets = `${item?.title || ""} ${item?.description || ""}`;
    const queries = [
      item?.query,
      ...(Array.isArray(item?.queries) ? item.queries : [])
    ].filter(value => typeof value === "string").join(" ");
    return DISCOVERY_RELEVANCE_SIGNAL.test(`${snippets} ${queries}`);
  });
}

function hasMarketingDiscoveryEvidence(evidence) {
  return Array.isArray(evidence) && evidence.some(item => {
    const snippets = `${item?.title || ""} ${item?.description || ""}`;
    const queries = [
      item?.query,
      ...(Array.isArray(item?.queries) ? item.queries : [])
    ].filter(value => typeof value === "string").join(" ");
    return MARKETING_SEARCH_SIGNAL.test(snippets) || MARKETING_SEARCH_SIGNAL.test(queries);
  });
}

function selectDailyDiscoveryQueries(
  now = new Date(),
  locations = INDIA_DISCOVERY_LOCATIONS,
  industries = DISCOVERY_INDUSTRIES,
  anyLocation = false,
  batchIndex = 0
) {
  const dayNumber = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000);
  const targetLocations = [...new Set(
    (Array.isArray(locations) ? locations : [])
      .filter(location => typeof location === "string")
      .map(location => location.trim())
      .filter(Boolean)
  )];
  const regions = anyLocation
    ? [""]
    : targetLocations.length ? targetLocations : INDIA_DISCOVERY_LOCATIONS;
  const targetIndustries = [...new Set(
    (Array.isArray(industries) ? industries : [])
      .filter(industry => typeof industry === "string")
      .map(industry => industry.trim())
      .filter(Boolean)
  )];
  const allIndustriesSelected = targetIndustries.some(industry =>
    /^(?:all(?:\s+(?:industr(?:y|ies)|sectors?))?|any\s+industry)$/i.test(industry)
  );
  const sectors = !targetIndustries.length || allIndustriesSelected
    ? DISCOVERY_INDUSTRIES
    : targetIndustries;
  const industryQueriesByRegion = regions.map((location, regionIndex) => {
    const queries = [];
    const seenQueries = new Set();
    for (let industryVisit = 0; industryVisit < sectors.length; industryVisit += 1) {
      const industry = sectors[(dayNumber + regionIndex + industryVisit) % sectors.length];
      for (let templateVisit = 0; templateVisit < DISCOVERY_QUERY_TEMPLATES.length; templateVisit += 1) {
        const template = DISCOVERY_QUERY_TEMPLATES[
          (dayNumber + regionIndex + templateVisit) % DISCOVERY_QUERY_TEMPLATES.length
        ];
        const query = template.replace("{location}", location).replace("{industry}", industry);
        const key = query.toLowerCase();
        if (seenQueries.has(key)) continue;
        seenQueries.add(key);
        queries.push(query);
      }
    }
    return queries;
  });
  const rotatedRegions = [
    ...industryQueriesByRegion.slice(dayNumber % regions.length),
    ...industryQueriesByRegion.slice(0, dayNumber % regions.length)
  ];
  const industryQueryPool = [];
  const maxQueriesPerRegion = Math.max(0, ...rotatedRegions.map(group => group.length));
  for (let visit = 0; visit < maxQueriesPerRegion; visit += 1) {
    for (const regionQueries of rotatedRegions) {
      if (regionQueries[visit]) industryQueryPool.push(regionQueries[visit]);
    }
  }
  const queryCount = Math.min(DISCOVERY_INDUSTRY_QUERIES_PER_RUN, industryQueryPool.length);
  const batchOffset = Math.max(0, Math.floor(batchIndex)) * queryCount;
  const queryOffset = industryQueryPool.length
    ? batchOffset % industryQueryPool.length
    : 0;
  const industryQueries = Array.from({ length: queryCount }, (_, index) =>
    industryQueryPool[(queryOffset + index) % industryQueryPool.length]
  );

  const buyingQueryStart = (dayNumber * 2 + Math.max(0, batchIndex) * 2) %
    DISCOVERY_BUYING_SIGNAL_QUERIES.length;
  const buyingQueries = Array.from({ length: DISCOVERY_BUYING_SIGNAL_QUERIES.length }, (_, index) => {
    const industry = sectors[(dayNumber + batchIndex + index) % sectors.length];
    return DISCOVERY_BUYING_SIGNAL_QUERIES[
      (buyingQueryStart + index) % DISCOVERY_BUYING_SIGNAL_QUERIES.length
    ]
      .replaceAll("{location}", regions[(dayNumber + (index + batchIndex) * 4) % regions.length])
      .replaceAll("{industry}", industry);
  });

  return [...new Set([...industryQueries, ...buyingQueries].map(query => query.trim()))];
}

module.exports = {
  DISCOVERY_INDUSTRIES,
  DAILY_DISCOVERY_QUERIES_PER_RUN,
  INDIA_DISCOVERY_LOCATIONS,
  hasRelevantDiscoveryEvidence,
  hasMarketingDiscoveryEvidence,
  selectDailyDiscoveryQueries
};
