const INDIA_STATES_AND_UNION_TERRITORIES = [
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry"
];

const INDIA_DISCOVERY_LOCATIONS = ["India", ...INDIA_STATES_AND_UNION_TERRITORIES];

const INDIA_CITIES = [
  "Bengaluru", "Bangalore", "Mumbai", "New Delhi", "Chennai", "Hyderabad",
  "Pune", "Kolkata", "Ahmedabad", "Jaipur", "Kochi", "Lucknow", "Indore",
  "Surat", "Nagpur", "Coimbatore", "Gurugram", "Gurgaon", "Noida",
  "Thiruvananthapuram", "Visakhapatnam", "Vadodara", "Bhopal", "Patna"
];

const INDIA_TARGET_LOCATIONS = new Set([
  ...INDIA_DISCOVERY_LOCATIONS,
  ...INDIA_CITIES
].map(location => location.toLowerCase()));
const INDIA_LOCATION_PATTERNS = [...new Set([
  ...INDIA_DISCOVERY_LOCATIONS,
  ...INDIA_CITIES
])].map(location => [
  location,
  new RegExp(`\\b${location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
]);

const INDIA_GEOGRAPHIC_SIGNAL = new RegExp(
  `\\b(?:India|Indian|INR|${[...INDIA_STATES_AND_UNION_TERRITORIES, ...INDIA_CITIES]
    .map(location => location.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})\\b|₹`,
  "i"
);

function isIndiaTargetLocation(location) {
  return typeof location === "string" && INDIA_TARGET_LOCATIONS.has(location.trim().toLowerCase());
}

function hasIndiaGeographicSignal(text) {
  return INDIA_GEOGRAPHIC_SIGNAL.test(typeof text === "string" ? text : "");
}

function findIndiaLocations(text) {
  if (typeof text !== "string") return [];
  return INDIA_LOCATION_PATTERNS
    .filter(([, pattern]) => pattern.test(text))
    .map(([location]) => location);
}

module.exports = {
  INDIA_CITIES,
  INDIA_DISCOVERY_LOCATIONS,
  INDIA_GEOGRAPHIC_SIGNAL,
  INDIA_STATES_AND_UNION_TERRITORIES,
  findIndiaLocations,
  hasIndiaGeographicSignal,
  isIndiaTargetLocation
};
