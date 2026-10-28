const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 15;

function isSearchResultsUrl(value) {
  try {
    const url = new URL(value);
    return /(^|\.)bing\.com$/i.test(url.hostname) && url.pathname.toLowerCase() === "/search";
  } catch {
    return false;
  }
}

let activeIcpId;
let allCompanies = [];
let currentPage = 1;
let googleConnected = false;
let spreadsheetUrl = "";
let crawlPollTimer;
let discoveryPollTimer;
let sourceDiscoveryPollTimer;
let sourceRetrievalPollTimer;
let engineStatusPollTimer;
let engineEventSource;
let lowerFitResearchPollTimer;
let engineEventIds = new Set();
let currentEngineEnabled = false;
let selectedStates = ["India"];
let selectedAreas = [];
let stateOptions = [];
let areaOptions = [];

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  let data;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}.`);
    }
    throw new Error("The server returned an invalid response. Please retry or contact support.");
  }
  if (!response.ok) {
    const message = typeof data?.error === "string"
      ? data.error
      : `Request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return data;
}

function commaSeparatedValues(value) {
  return value.split(",").map(item => item.trim()).filter(Boolean);
}

function renderLocationButtons(container, locations, selected, group) {
  const fragment = document.createDocumentFragment();
  for (const location of locations) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `location-button${selected.some(value =>
      value.toLowerCase() === location.toLowerCase()
    ) ? " selected" : ""}`;
    button.dataset.locationGroup = group;
    button.dataset.location = location;
    button.setAttribute("aria-pressed", String(selected.some(value =>
      value.toLowerCase() === location.toLowerCase()
    )));
    button.textContent = location;
    fragment.append(button);
  }
  container.replaceChildren(fragment);
}

function renderSelectedAreas() {
  const container = $("selectedAreas");
  const fragment = document.createDocumentFragment();
  for (const area of selectedAreas) {
    const chip = document.createElement("span");
    chip.className = "selected-location-chip";
    chip.append(document.createTextNode(area));
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-location-button";
    removeButton.dataset.removeArea = area;
    removeButton.setAttribute("aria-label", `Remove ${area}`);
    removeButton.textContent = "×";
    chip.append(removeButton);
    fragment.append(chip);
  }
  container.replaceChildren(fragment);
  renderLocationButtons($("areaButtons"), areaOptions, selectedAreas, "area");
}

function addSelectedArea(value) {
  const area = value.trim().replace(/\s+/g, " ");
  if (!area || selectedAreas.some(item => item.toLowerCase() === area.toLowerCase())) return;
  selectedAreas.push(area);
  selectedAreas.sort((first, second) => first.localeCompare(second));
  renderSelectedAreas();
}

function renderLocationPickers(config) {
  stateOptions = config.targetStates || [];
  areaOptions = config.targetAreas || [];
  renderLocationButtons($("stateButtons"), stateOptions, selectedStates, "state");
  renderSelectedAreas();
}

$("stateButtons").addEventListener("click", event => {
  const button = event.target.closest("button[data-location]");
  if (!button) return;
  const location = button.dataset.location;
  const isCountry = location.toLowerCase() === "india";
  if (isCountry) {
    selectedStates = selectedStates.some(value => value.toLowerCase() === "india")
      ? []
      : ["India"];
  } else {
    selectedStates = selectedStates.filter(value => value.toLowerCase() !== "india");
    selectedStates = selectedStates.some(value => value.toLowerCase() === location.toLowerCase())
      ? selectedStates.filter(value => value.toLowerCase() !== location.toLowerCase())
      : [...selectedStates, location];
  }
  renderLocationButtons($("stateButtons"), stateOptions, selectedStates, "state");
});

$("areaButtons").addEventListener("click", event => {
  const button = event.target.closest("button[data-location]");
  if (!button) return;
  const location = button.dataset.location;
  if (selectedAreas.some(area => area.toLowerCase() === location.toLowerCase())) {
    selectedAreas = selectedAreas.filter(area => area.toLowerCase() !== location.toLowerCase());
    renderSelectedAreas();
  } else {
    addSelectedArea(location);
  }
});

$("selectedAreas").addEventListener("click", event => {
  const button = event.target.closest("button[data-remove-area]");
  if (!button) return;
  selectedAreas = selectedAreas.filter(area =>
    area.toLowerCase() !== button.dataset.removeArea.toLowerCase()
  );
  renderSelectedAreas();
});

$("addAreaBtn").addEventListener("click", () => {
  addSelectedArea($("customArea").value);
  $("customArea").value = "";
  $("customArea").focus();
});

$("customArea").addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  $("addAreaBtn").click();
});

function updateLocationMode() {
  const anyLocation = $("anyLocation").checked;
  for (const fieldset of document.querySelectorAll("#icpForm .location-picker")) {
    fieldset.disabled = anyLocation;
  }
  $("locationModeNote").textContent = anyLocation
    ? "Location filters are disabled; industry discovery covers any location."
    : "Discovery and ICP scoring will use the selected regions.";
}

$("anyLocation").addEventListener("change", updateLocationMode);
updateLocationMode();

$("icpForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const anyLocation = $("anyLocation").checked;
    if (!anyLocation && !selectedStates.length) {
      $("icpResult").textContent = "Select India or at least one state/union territory.";
      return;
    }
    const data = await api("/api/icps", {
      method: "POST",
      body: JSON.stringify({
        name: $("icpName").value,
        industries: commaSeparatedValues($("industries").value),
        locations: anyLocation ? [] : [...new Set([...selectedStates, ...selectedAreas])],
        anyLocation,
        areas: anyLocation ? [] : selectedAreas,
        useCases: commaSeparatedValues($("useCases").value)
      })
    });
    activeIcpId = data.id;
    $("icpResult").textContent = `Target profile saved: ${data.name}`;
  } catch (error) {
    $("icpResult").textContent = error.message;
  }
});

$("sourceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const data = await api("/api/sources", {
      method: "POST",
      body: JSON.stringify({
        name: $("sourceName").value,
        url: $("sourceUrl").value,
        approved: $("approved").checked
      })
    });
    $("sourceResult").textContent = `Approved source added: ${data.name} (${data.domain})`;
  } catch (error) {
    $("sourceResult").textContent = error.message;
  }
});

$("publicSourceList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-source-id]");
  if (!button) return;
  button.disabled = true;
  $("publicSourceResult").textContent = "Adding official source...";
  try {
    const source = await api(`/api/public-sources/${encodeURIComponent(button.dataset.sourceId)}`, {
      method: "POST"
    });
    $("publicSourceResult").textContent = source.alreadyAdded
      ? `${source.name} is already in your approved sources.`
      : `Added ${source.name} as an approved source.`;
    await loadAll();
  } catch (error) {
    $("publicSourceResult").textContent = error.message;
    button.disabled = false;
  }
});

$("approvedDirectoryList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-source-action]");
  if (!button) return;
  const action = button.dataset.sourceAction;
  button.disabled = true;

  try {
    if (action === "remove-all") {
      $("publicSourceResult").textContent = "Removing all approved directory sources...";
      const result = await api("/api/sources", { method: "DELETE" });
      $("publicSourceResult").textContent = result.removedCount
        ? `Removed ${result.removedCount} approved directory sources.`
        : "No approved directory sources to remove.";
    } else if (action === "remove") {
      $("publicSourceResult").textContent = `Removing ${button.dataset.sourceName || "source"}...`;
      const source = await api(`/api/sources/${encodeURIComponent(button.dataset.sourceId)}`, {
        method: "DELETE"
      });
      $("publicSourceResult").textContent = `${source.name} was removed from your approved directory sources.`;
    }
    await loadAll();
  } catch (error) {
    $("publicSourceResult").textContent = error.message;
    button.disabled = false;
  }
});

$("findSourcesBtn").addEventListener("click", async () => {
  const button = $("findSourcesBtn");
  button.disabled = true;
  $("sourceDiscoveryStatus").textContent = "Searching for Indian digital-marketing directories across target regions...";
  try {
    await api("/api/source-discovery/run-now", { method: "POST" });
    pollSourceDiscovery();
  } catch (error) {
    $("sourceDiscoveryStatus").textContent = error.message;
    button.disabled = false;
  }
});

$("retrieveSourcesBtn").addEventListener("click", async () => {
  const button = $("retrieveSourcesBtn");
  button.disabled = true;
  $("publicSourceResult").textContent = "Retrieving newly listed companies from approved directories...";
  try {
    await api("/api/source-retrieval/run-now", {
      method: "POST",
      body: JSON.stringify({
        includeCuratedSources: $("includeCuratedSources").checked
      })
    });
    pollSourceRetrieval();
  } catch (error) {
    $("publicSourceResult").textContent = error.message;
    button.disabled = false;
  }
});

$("sourceCandidateList").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-source-action]");
  if (!button) return;
  button.disabled = true;
  const candidateId = encodeURIComponent(button.dataset.candidateId);
  const action = button.dataset.sourceAction;
  try {
    await api(`/api/source-candidates/${candidateId}/${action}`, { method: "POST" });
    $("sourceDiscoveryStatus").textContent = action === "approve"
      ? "Source approved. Scheduled and on-demand retrieval will score its listings against the matched ICP."
      : "Source dismissed; it will no longer appear in the candidate queue.";
    await loadAll();
  } catch (error) {
    $("sourceDiscoveryStatus").textContent = error.message;
    button.disabled = false;
  }
});

$("crawlBtn").addEventListener("click", async () => {
  const button = $("crawlBtn");
  button.disabled = true;
  $("jobResult").textContent = "Starting crawl...";
  try {
    const sourceList = await api("/api/sources");
    const approvedSources = sourceList.filter(source => source.approved);
    if (!approvedSources.length) {
      $("jobResult").textContent = "Add at least one approved source first.";
      button.disabled = false;
      return;
    }

    const job = await api("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        sourceIds: approvedSources.map(source => source.id),
        maxPagesPerCompany: 8,
        ...(activeIcpId ? { icpId: activeIcpId } : {})
      })
    });
    pollJob(job.id);
  } catch (error) {
    $("jobResult").textContent = error.message;
  }
});

$("runDiscoveryBtn").addEventListener("click", async () => {
  const button = $("runDiscoveryBtn");
  button.disabled = true;
  $("discoveryStatus").textContent = "Starting an autonomous research cycle...";
  try {
    await api("/api/engine/run-now", { method: "POST" });
    await refreshEngineStatus();
  } catch (error) {
    $("discoveryStatus").textContent = error.message;
    button.disabled = false;
  }
});

$("geographicDiscoveryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("geographicDiscoveryBtn");
  button.disabled = true;
  $("geographicDiscoveryStatus").textContent = "Starting geographic business discovery...";
  try {
    const job = await api("/api/geographic-discovery/run-now", {
      method: "POST",
      body: JSON.stringify({
        city: $("geographicCity").value,
        state: $("geographicState").value,
        country: $("geographicCountry").value,
        category: $("geographicCategory").value || "all",
        limit: Number($("geographicLimit").value)
      })
    });
    $("geographicDiscoveryStatus").textContent = `Geographic discovery started for ${[$("geographicCity").value, $("geographicState").value, $("geographicCountry").value].filter(Boolean).join(", ")}.`;
    pollDiscovery(job.id, true);
  } catch (error) {
    $("geographicDiscoveryStatus").textContent = error.message;
    button.disabled = false;
  }
});

$("researchLowerFitBtn").addEventListener("click", async () => {
  const lowerFitCompanies = allCompanies.filter(company => company.score?.tier === "Low fit");
  if (!lowerFitCompanies.length) {
    $("lowerFitResearchStatus").textContent = "No Lower fit prospects are available.";
    return;
  }
  if (!window.confirm(
    `Re-research ${lowerFitCompanies.length} Lower fit prospects? This may take hours. Sites that disallow crawling will be skipped.`
  )) return;

  const button = $("researchLowerFitBtn");
  button.disabled = true;
  $("lowerFitResearchStatus").textContent = `Queueing ${lowerFitCompanies.length} prospects after active research finishes...`;
  try {
    const job = await api("/api/companies/research-lower-fit", { method: "POST" });
    pollLowerFitResearchJob(job.id);
  } catch (error) {
    $("lowerFitResearchStatus").textContent = error.message;
    button.disabled = false;
  }
});

$("researchStaleBtn").addEventListener("click", async () => {
  const staleDays = 90;
  if (!window.confirm(
    `Recheck saved company records not revisited in the last ${staleDays} days? Records without a research timestamp are included. This may take hours.`
  )) return;

  const button = $("researchStaleBtn");
  button.disabled = true;
  $("staleResearchStatus").textContent = "Queueing stale company records...";
  try {
    const job = await api("/api/companies/research-stale", {
      method: "POST",
      body: JSON.stringify({ staleAfterDays: staleDays })
    });
    $("staleResearchStatus").textContent =
      `Queued ${job.totalTargets} saved leads for refresh (${job.staleAfterDays}+ days old).`;
    pollLowerFitResearchJob(job.id);
  } catch (error) {
    $("staleResearchStatus").textContent = error.message;
    button.disabled = false;
  }
});

$("engineToggleBtn").addEventListener("click", async () => {
  const button = $("engineToggleBtn");
  button.disabled = true;
  try {
    const action = currentEngineEnabled ? "pause" : "start";
    await api(`/api/engine/${action}`, { method: "POST" });
    await refreshEngineStatus();
  } catch (error) {
    $("discoveryStatus").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("engineModeSelect").addEventListener("change", async () => {
  const mode = $("engineModeSelect").value;
  const configuration = mode === "hourly"
    ? { mode: "interval", intervalMinutes: 60 }
    : mode === "interval"
      ? { mode, intervalMinutes: 15 }
      : { mode };
  $("engineModeSelect").disabled = true;
  try {
    await api("/api/engine/configure", {
      method: "POST",
      body: JSON.stringify(configuration)
    });
    await loadAll();
  } catch (error) {
    $("discoveryStatus").textContent = error.message;
    await refreshEngineStatus();
  } finally {
    $("engineModeSelect").disabled = false;
  }
});

$("googleSheetsBtn").addEventListener("click", async () => {
  if (!googleConnected) {
    window.location.assign("/auth/google");
    return;
  }

  const button = $("googleSheetsBtn");
  button.disabled = true;
  $("googleStatus").textContent = "Syncing prospects to Google Sheets...";
  try {
    const result = await api("/api/google/sheets", { method: "POST" });
    spreadsheetUrl = result.spreadsheetUrl;
    showGoogleStatus(`Synced ${result.rows} prospects.`, spreadsheetUrl);
  } catch (error) {
    $("googleStatus").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("companySearch").addEventListener("input", () => {
  currentPage = 1;
  renderCompanies();
});
$("tierFilter").addEventListener("change", () => {
  currentPage = 1;
  renderCompanies();
});
$("industryFilter").addEventListener("change", () => {
  currentPage = 1;
  renderCompanies();
});
$("legitimacyFilter").addEventListener("change", () => {
  currentPage = 1;
  renderCompanies();
});
$("downloadCsvBtn").addEventListener("click", async () => {
  const companies = getFilteredCompanies();
  if (!companies.length) return;
  const button = $("downloadCsvBtn");
  button.disabled = true;
  const csv = createProspectCsv(companies);
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `dakini-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  try {
    const result = await api("/api/companies/clear-exported", {
      method: "POST",
      body: JSON.stringify({ companyIds: companies.map(company => company.id) })
    });
    $("downloadStatus").textContent = `Downloaded ${result.removed} prospects. The list is clear; previously scraped companies will be skipped in future runs.`;
    await loadAll();
  } catch (error) {
    $("downloadStatus").textContent = `The CSV was downloaded, but the prospect list could not be cleared: ${error.message}`;
  } finally {
    button.disabled = false;
  }
});
$("clearScrapedDataBtn").addEventListener("click", async () => {
  const button = $("clearScrapedDataBtn");
  button.disabled = true;
  try {
    const result = await api("/api/companies", { method: "DELETE" });
    $("downloadStatus").textContent = `Cleared ${result.removed} scraped company records. Discovery will start fresh for your target industries.`;
    await loadAll();
  } catch (error) {
    $("downloadStatus").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$("prevPage").addEventListener("click", () => {
  currentPage = Math.max(1, currentPage - 1);
  renderCompanies();
});
$("nextPage").addEventListener("click", () => {
  currentPage += 1;
  renderCompanies();
});
$("setupNav").addEventListener("click", () => {
  $("setup").open = true;
});

function showGoogleStatus(message, link) {
  $("googleStatus").replaceChildren(document.createTextNode(`${message} `));
  if (link) {
    const anchor = document.createElement("a");
    anchor.href = link;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = "Open spreadsheet";
    $("googleStatus").append(anchor);
  }
}

function updateEngineStatus(status, busy = false) {
  const engine = status.engine;
  if (!engine) return;
  currentEngineEnabled = Boolean(engine.enabled);
  const running = engine.status === "running";
  const mode = engine.mode === "interval" && Number(engine.intervalMinutes) >= 60
    ? "hourly"
    : engine.mode;

  $("engineModeSelect").value = mode;
  $("engineCyclesCount").textContent = String(engine.cycleCount || 0);
  $("engineStateLabel").textContent = running
    ? currentEngineEnabled ? "Running" : "Finishing current cycle · paused"
    : currentEngineEnabled ? "Scheduled" : "Paused";
  $("engineToggleBtn").textContent = currentEngineEnabled ? "⏸ Pause Engine" : "▶ Start Engine";
  $("engineBadge").classList.toggle("paused", !currentEngineEnabled);
  $("engineBadgeText").textContent = currentEngineEnabled
    ? "AUTONOMOUS ENGINE ENABLED"
    : "AUTONOMOUS ENGINE PAUSED";
  $("runDiscoveryBtn").disabled = busy || running;
  if (running || !currentEngineEnabled) {
    $("discoveryStatus").textContent = engine.currentActivity ||
      (currentEngineEnabled ? "Autonomous cycle running." : "Engine paused by operator.");
  }
}

function appendEngineEvent(event) {
  if (!event || typeof event.message !== "string") return;
  if (event.id && engineEventIds.has(event.id)) return;
  if (event.id) {
    engineEventIds.add(event.id);
    if (engineEventIds.size > 200) {
      engineEventIds = new Set([...engineEventIds].slice(-100));
    }
  }
  const line = document.createElement("div");
  line.className = "terminal-line";
  const timestamp = event.timestamp ? new Date(event.timestamp) : null;
  const clock = timestamp && !Number.isNaN(timestamp.getTime())
    ? new Intl.DateTimeFormat(undefined, { timeStyle: "medium" }).format(timestamp)
    : "Engine";
  line.textContent = `[${clock}] ${event.message}`;
  const consoleElement = $("engineLiveConsole");
  consoleElement.append(line);
  while (consoleElement.children.length > 80) {
    consoleElement.firstElementChild.remove();
  }
  consoleElement.scrollTop = consoleElement.scrollHeight;
}

async function refreshEngineStatus() {
  const status = await api("/api/engine/status");
  updateEngineStatus(status, Boolean(status.busy || status.activeJob));
  for (const event of status.recentEvents || []) appendEngineEvent(event);
  return status;
}

async function pollEngineStatus() {
  engineStatusPollTimer = null;
  try {
    await refreshEngineStatus();
  } catch (error) {
    $("discoveryStatus").textContent = `Engine status unavailable: ${error.message}`;
  } finally {
    engineStatusPollTimer = setTimeout(pollEngineStatus, 5000);
  }
}

function connectEngineEventStream() {
  if (!window.EventSource) return;
  engineEventSource = new EventSource("/api/engine/stream");
  engineEventSource.onopen = () => {
    $("terminalStatusBadge").textContent = "LIVE STREAM CONNECTED";
  };
  engineEventSource.onmessage = message => {
    try {
      const event = JSON.parse(message.data);
      if (event.type === "init") {
        updateEngineStatus({ engine: event.engine }, Boolean(event.busy));
        for (const recentEvent of event.recentEvents || []) appendEngineEvent(recentEvent);
        return;
      }
      appendEngineEvent(event);
    } catch (error) {
      $("terminalStatusBadge").textContent = `STREAM ERROR: ${error.message}`;
    }
  };
  engineEventSource.onerror = () => {
    $("terminalStatusBadge").textContent = "RECONNECTING";
  };
}

function showContact(company) {
  const emails = company.contactEmails.slice(0, 3)
    .map(email => `<span>Email: <a href="mailto:${encodeURIComponent(email)}">${escapeHtml(email)}</a></span>`);
  const phones = company.contactPhones.slice(0, 2)
    .map(phone => {
      const phoneNumber = normalizePhoneNumber(phone);
      return phoneNumber
        ? `<span>Phone number: <a href="tel:${escapeHtml(phoneNumber)}">${escapeHtml(phoneNumber)}</a></span>`
        : "";
    })
    .filter(Boolean);
  const contacts = [...emails, ...phones];
  if (company.contactPages[0]) {
    contacts.push(`<a href="${escapeHtml(company.contactPages[0])}" target="_blank" rel="noopener noreferrer">Contact page</a>`);
  }
  return contacts.length ? contacts.join("<br>") : '<span class="muted">Not found</span>';
}

function renderPublicSources(publicSources) {
  const list = $("publicSourceList");
  list.replaceChildren();
  $("includeCuratedSources").disabled = publicSources.length === 0;
  if (!publicSources.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No verified curated directories are configured. Use Find data sources to discover directories for review.";
    list.append(empty);
    return;
  }
  for (const source of publicSources) {
    const item = document.createElement("div");
    item.className = "public-source-item";
    const details = document.createElement("div");
    const name = document.createElement("a");
    name.href = source.url;
    name.target = "_blank";
    name.rel = "noopener noreferrer";
    name.className = "public-source-name";
    name.textContent = source.name;
    const description = document.createElement("span");
    const scanSummary = source.lastRetrievedAt
      ? ` Last scan ${formatDate(source.lastRetrievedAt)} · ${source.lastCompanyLinksFound ?? 0} listed · ${source.lastNewCompaniesFound ?? 0} new.`
      : "";
    description.textContent = `${source.description}${scanSummary}${source.lastRetrievalError ? ` Last scan note: ${source.lastRetrievalError}` : ""}`;
    details.append(name, description);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary-button";
    button.dataset.sourceId = source.id;
    button.disabled = source.added;
    button.textContent = source.added ? "Added" : "Add source";
    item.append(details, button);
    list.append(item);
  }
}

function renderApprovedDirectorySources(approvedSources) {
  const list = $("approvedDirectoryList");
  list.replaceChildren();
  if (!approvedSources.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No directories approved yet. Find and review public directory candidates before retrieval.";
    list.append(empty);
    return;
  }

  const bulkActions = document.createElement("div");
  bulkActions.className = "source-candidate-actions";
  const removeAllButton = document.createElement("button");
  removeAllButton.type = "button";
  removeAllButton.className = "secondary-button";
  removeAllButton.dataset.sourceAction = "remove-all";
  removeAllButton.textContent = "Remove all";
  bulkActions.append(removeAllButton);
  list.append(bulkActions);

  for (const source of approvedSources) {
    const item = document.createElement("div");
    item.className = "public-source-item";
    const details = document.createElement("div");
    const name = document.createElement("a");
    name.href = source.url;
    name.target = "_blank";
    name.rel = "noopener noreferrer";
    name.className = "public-source-name";
    name.textContent = source.name;
    const description = document.createElement("span");
    const scanSummary = source.lastRetrievedAt
      ? ` Last scan ${formatDate(source.lastRetrievedAt)} · ${source.lastCompanyLinksFound ?? 0} listed · ${source.lastNewCompaniesFound ?? 0} new.`
      : " Not scanned yet.";
    description.textContent = `${source.directoryMode === "generic" ? "Discovered directory" : "Curated directory"}${scanSummary}${source.lastRetrievalError ? ` Last scan note: ${source.lastRetrievalError}` : ""}`;
    details.append(name, description);

    const actions = document.createElement("div");
    actions.className = "source-candidate-actions";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "secondary-button";
    removeButton.dataset.sourceId = source.id;
    removeButton.dataset.sourceAction = "remove";
    removeButton.dataset.sourceName = source.name;
    removeButton.textContent = "Remove";
    actions.append(removeButton);

    item.append(details, actions);
    list.append(item);
  }
}

function renderSourceCandidates(candidates) {
  const list = $("sourceCandidateList");
  list.replaceChildren();
  const pending = candidates.filter(candidate => candidate.status === "pending");
  if (!pending.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No pending sources. Run a search or wait for the daily source scan.";
    list.append(empty);
    return;
  }
  for (const candidate of pending) {
    const item = document.createElement("article");
    item.className = "public-source-item source-candidate";
    const details = document.createElement("div");
    const name = document.createElement("a");
    name.href = candidate.url;
    name.target = "_blank";
    name.rel = "noopener noreferrer";
    name.className = "public-source-name";
    name.textContent = candidate.name;
    const description = document.createElement("span");
    const target = [candidate.targetIndustry, candidate.targetLocation].filter(Boolean).join(" · ");
    description.textContent = `${candidate.authorityDomain} · ${candidate.listedCompanyLinks} linked company sites · ${candidate.confidence}% confidence${target ? ` · ${target}` : ""}`;
    const evidence = document.createElement("small");
    evidence.textContent = `${candidate.description || "Public company directory validated."} Approval authorizes repeated retrieval of current and future public listings from this directory; it does not request separate approval for each company.`;
    details.append(name, description, evidence);
    const actions = document.createElement("div");
    actions.className = "source-candidate-actions";
    for (const [action, label] of [["approve", "Approve"], ["dismiss", "Dismiss"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action === "approve" ? "secondary-button" : "secondary-button";
      button.dataset.sourceAction = action;
      button.dataset.candidateId = candidate.id;
      button.textContent = label;
      actions.append(button);
    }
    item.append(details, actions);
    list.append(item);
  }
}

function renderCompanies() {
  const industries = [...new Set(allCompanies
    .map(company => company.industry)
    .filter(industry => industry && industry !== "Unknown"))]
    .sort((a, b) => a.localeCompare(b));
  const selectedIndustry = $("industryFilter").value;
  $("industryFilter").replaceChildren(new Option("All industries", "all"));
  for (const industry of industries) {
    $("industryFilter").add(new Option(industry, industry));
  }
  if (industries.includes(selectedIndustry)) {
    $("industryFilter").value = selectedIndustry;
  }

  const filtered = getFilteredCompanies();
  $("downloadCsvBtn").disabled = filtered.length === 0;
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount);
  const start = (currentPage - 1) * PAGE_SIZE;
  const pageCompanies = filtered.slice(start, start + PAGE_SIZE);
  $("resultCount").textContent = filtered.length
    ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, filtered.length)} of ${filtered.length} prospects`
    : "No prospects match these filters.";
  $("pageLabel").textContent = `Page ${currentPage} of ${pageCount}`;
  $("prevPage").disabled = currentPage <= 1;
  $("nextPage").disabled = currentPage >= pageCount;

  const scoreLabelsByVersion = {
    8: [
      ["Service fit", "serviceFit", 30],
      ["Operating scale", "operatingScale", 25],
      ["India/language fit", "indiaMarketFit", 5],
      ["Integration readiness", "integrationReadiness", 8],
      ["Buying/growth signals", "buyingSignals", 15],
      ["Public contactability", "reachability", 5],
      ["First-party workflow evidence", "firstPartyWorkflowFit", 12]
    ],
    7: [
      ["Service fit", "serviceFit", 30],
      ["Operating scale", "operatingScale", 25],
      ["India/language fit", "indiaMarketFit", 5],
      ["Integration readiness", "integrationReadiness", 8],
      ["Buying/growth signals", "buyingSignals", 15],
      ["Public contactability", "reachability", 5],
      ["First-party workflow evidence", "firstPartyWorkflowFit", 12]
    ],
    6: [
      ["Service fit", "serviceFit", 35],
      ["Operating scale", "operatingScale", 25],
      ["India/language fit", "indiaMarketFit", 10],
      ["Integration readiness", "integrationReadiness", 10],
      ["Buying signals", "buyingSignals", 15],
      ["Contactability", "reachability", 5]
    ],
    5: [
      ["Service fit", "serviceFit", 35],
      ["Operating scale", "operatingScale", 25],
      ["India/language fit", "indiaMarketFit", 10],
      ["Integration readiness", "integrationReadiness", 10],
      ["Buying signals", "buyingSignals", 15],
      ["Contactability", "reachability", 5]
    ],
    4: [
      ["Service fit", "serviceFit", 35],
      ["Operating scale", "operatingScale", 20],
      ["India/language fit", "indiaMarketFit", 15],
      ["Integration readiness", "integrationReadiness", 10],
      ["Buying signals", "buyingSignals", 15],
      ["Contactability", "reachability", 5]
    ]
  };
  $("companies").innerHTML = pageCompanies.map((company, index) => {
    const scoreLabels = scoreLabelsByVersion[company.scoreVersion] || scoreLabelsByVersion[4];
    const componentBreakdown = scoreLabels
      .map(([label, key, maximum]) => `${label}: ${company.score.components?.[key] || 0}/${maximum}`)
      .join(" · ");
    const vendorExclusion = company.score.components?.aiVendorExclusion || 0;
    const breakdown = vendorExclusion
      ? `${componentBreakdown} · AI vendor exclusion: ${vendorExclusion}`
      : componentBreakdown;
    const evidence = (company.evidence || [])
      .filter(item => item.quote && item.field !== "roleEmail" && item.field !== "phone")
      .slice(0, 8)
      .map(item => `<li><strong>${escapeHtml(item.field.replace(/([A-Z])/g, " $1"))}:</strong> ${escapeHtml(item.quote)} ${item.source_url ? `<a href="${escapeHtml(item.source_url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ""}</li>`)
      .join("");
    const pagesScanned = company.pagesScanned || [];
    const legitimacy = company.legitimacy || {
      status: pagesScanned.some(page => page.sourceType === "public directory listing")
        ? "directory_only"
        : "not_assessed",
      score: null,
      reasons: ["This saved prospect predates the first-party website legitimacy assessment."]
    };
    const legitimacyLabels = {
      strong_evidence: "Strong website evidence",
      review: "Needs legitimacy review",
      unverified: "Unverified",
      directory_only: "Directory only",
      not_assessed: "Not assessed"
    };
    const evidenceCount = (company.evidence || [])
      .filter(item => item.quote && item.field !== "roleEmail" && item.field !== "phone")
      .length;
    const directoryOnly = pagesScanned.length > 0 &&
      pagesScanned.every(page => page.sourceType === "public directory listing");
    const evidenceBasis = directoryOnly
      ? "Directory listing only — company operations have not been independently checked."
      : evidenceCount
        ? `${evidenceCount} quoted signal${evidenceCount === 1 ? "" : "s"}; source statements are not independently verified.`
        : "Limited cited evidence — review the source pages before relying on this assessment.";
    const discoverySource = company.directoryUrl || company.sourceUrl;
    const searchResultsSource = isSearchResultsUrl(discoverySource);
    const checkedAt = company.capturedAt && Number.isFinite(Date.parse(company.capturedAt))
      ? new Date(company.capturedAt).toLocaleString()
      : "Not recorded";
    const contextPreparation = company.contextPreparation;
    const workflowLabels = {
      enquiryForm: "Enquiry form",
      bookingWorkflow: "Appointment or booking flow",
      faqs: "FAQs",
      customerSupport: "Customer support options"
    };
    const workflowAudit = company.websiteWorkflowAudit;
    const websiteWorkflowDetails = workflowAudit
      ? `<details><summary>Public website workflow check</summary>
          <p>Checked ${escapeHtml(workflowAudit.scannedPages)} first-party page${workflowAudit.scannedPages === 1 ? "" : "s"}.</p>
          <ul>${Object.entries(workflowLabels).map(([signal, label]) =>
            `<li>${escapeHtml(label)}: ${workflowAudit.workflows?.[signal] === "found" ? "Found" : "Not detected in scanned pages"}</li>`
          ).join("")}</ul>
          <small>Not detected is not proof of a business problem; pages may be incomplete, dynamic, or outside the crawl.</small>
        </details>`
      : "";
    const preparationDetails = contextPreparation
      ? `<details><summary>Preprocessing context</summary>
          <p>Selected ${contextPreparation.selectedSegments} of ${contextPreparation.candidateSegments} text segments from ${contextPreparation.sourcePages} pages; ${contextPreparation.contextReductionPercent}% fewer text characters were passed to evidence extraction.</p>
          ${contextPreparation.signals?.length ? `<p><strong>Ranked signals:</strong> ${escapeHtml(contextPreparation.signals.join(", "))}</p>` : ""}
          ${contextPreparation.fallbackUsed ? `<p>${escapeHtml(contextPreparation.fallbackReason)}</p>` : ""}
          ${contextPreparation.sources?.length ? `<ul>${contextPreparation.sources.map(source => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.url)}</a> — ${escapeHtml([...(source.selectionReasons || []), ...(source.signals || [])].join(", ") || "fallback context")}</li>`).join("")}</ul>` : ""}
          <small>Deterministic relevance ranking; this app currently uses rule-based extraction, not LLM inference.</small>
        </details>`
      : "";
    return `
    <tr>
      <td>${start + index + 1}</td>
      <td>
        <strong>${escapeHtml(company.companyName)}</strong>
        <span class="industry-tag">${escapeHtml(company.industry)}</span>
        <span class="industry-tag">${escapeHtml(legitimacyLabels[legitimacy.status] || "Not assessed")}${legitimacy.score === null ? "" : ` · ${escapeHtml(legitimacy.score)}/100`}</span>
      </td>
      <td>${company.companyStartYear ? `${escapeHtml(company.companyStartYear)} · ${escapeHtml(getCompanyAgeYears(company.companyStartYear))} yrs*` : "Not stated"}${company.companyStartYear ? '<br><small>*Calendar-year estimate</small>' : ""}</td>
      <td>${escapeHtml(company.location || "Not listed")}</td>
      <td><span class="badge ${company.score.tier === "Priority" ? "priority" : ""}">${company.score.score}/100</span><br><small>Heuristic · ${company.score.tier === "Priority" ? "High potential" : company.score.tier === "Review" ? "Research" : "Lower fit"}</small></td>
      <td>${escapeHtml(company.score.matchedUseCases.join(", ") || company.detectedUseCases.join(", ") || "Opportunity not clear")}</td>
      <td>${showContact(company)}</td>
      <td>
        <details class="lead-details">
          <summary>View</summary>
          <div class="detail-content">
            <p><strong>Evidence basis:</strong> ${escapeHtml(evidenceBasis)}</p>
            <p><strong>Data checked:</strong> ${escapeHtml(checkedAt)} · ${pagesScanned.length} page${pagesScanned.length === 1 ? "" : "s"} scanned</p>
            <p><strong>Business age:</strong> ${company.companyStartYear ? `${escapeHtml(getCompanyAgeYears(company.companyStartYear))} years (estimated by calendar year from the stated start year ${escapeHtml(company.companyStartYear)}).` : "Not stated in the scanned first-party pages."} ${company.companyStartYear ? (company.evidence?.find(item => item.field === "companyStartYear")?.source_url ? `<a href="${escapeHtml(company.evidence.find(item => item.field === "companyStartYear").source_url)}" target="_blank" rel="noopener noreferrer">View start-year source</a>` : "") : ""}</p>
            <p><strong>Company legitimacy evidence:</strong> ${escapeHtml(legitimacyLabels[legitimacy.status] || "Not assessed")}${legitimacy.score === null ? "" : ` (${escapeHtml(legitimacy.score)}/100)`}. This is an evidence-quality check, not legal or registry verification.</p>
            ${legitimacy.reasons?.length ? `<ul>${legitimacy.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul>` : ""}
            <p><strong>What scanned pages say (extracted summary):</strong> ${escapeHtml(company.companyActivities.join(" ") || "Not clear from scanned pages.")}</p>
            <p><strong>Potential Dakini fit (suggested, not confirmed):</strong> ${escapeHtml(company.dakiniRecommendations.join(" ") || "Review company operations to identify a suitable workflow.")}</p>
            ${company.qualificationNote ? `<p><strong>Data note:</strong> ${escapeHtml(company.qualificationNote)}</p>` : ""}
            ${company.score.exclusionReason ? `<p><strong>Qualification note:</strong> ${escapeHtml(company.score.exclusionReason)}</p>` : ""}
            <p><strong>Heuristic score breakdown (not a purchase probability):</strong> ${escapeHtml(breakdown)}</p>
            ${company.score.dakiniWorkflowMatches?.length ? `<p><strong>Matched Dakini workflows:</strong> ${escapeHtml(company.score.dakiniWorkflowMatches.join(", "))}</p>` : ""}
            ${websiteWorkflowDetails}
            ${evidence ? `<details><summary>Source excerpts behind the score</summary><p class="muted">These excerpts support rule-based signals; they do not establish buying intent.</p><ul>${evidence}</ul></details>` : ""}
            ${preparationDetails}
            <p><a href="${escapeHtml(company.sourceUrl)}" target="_blank" rel="noopener noreferrer">Company website</a> · <a href="${escapeHtml(discoverySource)}" target="_blank" rel="noopener noreferrer">${searchResultsSource ? "Search-results reference (not a direct company listing)" : "Discovery/source listing"}</a></p>
          </div>
        </details>
      </td>
    </tr>
  `;
  }).join("");
}

function getFilteredCompanies() {
  const search = $("companySearch").value.trim().toLowerCase();
  const tier = $("tierFilter").value;
  const industry = $("industryFilter").value;
  const legitimacyFilter = $("legitimacyFilter").value;
  return allCompanies.filter(company => {
    if (tier !== "all" && company.score.tier !== tier) return false;
    if (industry !== "all" && company.industry !== industry) return false;
    const legitimacyStatus = company.legitimacy?.status ||
      (company.pagesScanned?.some(page => page.sourceType === "public directory listing")
        ? "directory_only"
        : "not_assessed");
    if (legitimacyFilter !== "all" && legitimacyStatus !== legitimacyFilter) return false;
    const searchable = [
      company.companyName,
      company.industry,
      company.location,
      company.companyActivities.join(" "),
      company.score.tier,
      company.detectedUseCases.join(" "),
      company.dakiniRecommendations.join(" "),
      company.contactEmails.join(" "),
      company.contactPhones.join(" "),
      legitimacyStatus,
      ...(company.legitimacy?.reasons || [])
    ].join(" ").toLowerCase();
    return searchable.includes(search);
  });
}

async function pollJob(jobId) {
  try {
    const jobs = await api("/api/jobs");
    const job = jobs.find(item => item.id === jobId);
    if (!job) throw new Error("Crawl job was not found.");
    $("jobResult").textContent = `Status: ${job.status}\nCompanies discovered: ${job.discoveredCompanies.length}\nCompanies visited: ${job.companiesVisited}\nPages scanned: ${job.pages}\nFetch errors: ${job.errors.length}`;
    if (job.status === "running" || job.status === "queued") {
      $("crawlBtn").disabled = true;
      crawlPollTimer = setTimeout(() => pollJob(jobId), 2500);
      return;
    }
    $("crawlBtn").disabled = false;
    await loadAll();
  } catch (error) {
    $("crawlBtn").disabled = false;
    $("jobResult").textContent = error.message;
  }
}

async function pollDiscovery(jobId, geographic = false) {
  discoveryPollTimer = null;
  try {
    const status = await api("/api/discovery/status");
    const job = status.activeJob;
    if (!job || job.id !== jobId) {
      const completedJob = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (completedJob.kind === "manual_geographic_discovery") {
        $("geographicDiscoveryStatus").textContent = completedJob.status === "failed"
          ? `Geographic discovery failed: ${completedJob.error || "Unknown error"}`
          : `Geographic discovery ${completedJob.status}: ${completedJob.geographicCandidatesFound} company websites found · ${completedJob.companiesVisited} crawled · ${completedJob.errors} errors · ${formatGeographicSourceStats(completedJob.geographicSourceStats)}${completedJob.geographicSourceNotes?.length ? ` · Notes: ${completedJob.geographicSourceNotes.join("; ")}` : ""}`;
      }
      $("runDiscoveryBtn").disabled = false;
      $("geographicDiscoveryBtn").disabled = false;
      await loadAll();
      return;
    }
    if (job.kind === "manual_geographic_discovery") {
      $("geographicDiscoveryStatus").textContent = job.geographicCandidatesFound
        ? `Geographic discovery: ${job.geographicCandidatesFound} company websites found · ${job.companiesVisited || 0} crawled · ${job.pages || 0} pages scanned · ${job.errors || 0} errors · ${formatGeographicSourceStats(job.geographicSourceStats)}${job.geographicSourceNotes?.length ? ` · Notes: ${job.geographicSourceNotes.join("; ")}` : ""}`
        : `${job.currentActivity || "Searching geographic sources"} · ${job.errors || 0} errors`;
      discoveryPollTimer = setTimeout(() => pollDiscovery(jobId, geographic), 4000);
      return;
    }
    const dailyTarget = job.dailyTargetEnabled
      ? ` · ${job.dailyQualifiedProspects || 0}/${job.dailyQualifiedProspectsTarget} qualified today · batch ${job.searchBatches || 1}`
      : "";
    $("discoveryStatus").textContent = `Searching ${job.searchesCompleted}/${status.dailySearchQueries} queries · ${job.qualifiedProspectsAdded || 0} qualified prospects added${dailyTarget} · ${job.companiesVisited} sites visited · ${job.pages} pages scanned · ${job.errors} errors${job.rateLimited ? " · provider rate limit reached" : ""}`;
    discoveryPollTimer = setTimeout(() => pollDiscovery(jobId, geographic), 4000);
  } catch (error) {
    $(geographic ? "geographicDiscoveryStatus" : "discoveryStatus").textContent =
      `Discovery status error: ${error.message}`;
    $("runDiscoveryBtn").disabled = false;
    $("geographicDiscoveryBtn").disabled = false;
  }
}

function formatGeographicSourceStats(sourceStats = {}) {
  return Object.entries(sourceStats)
    .map(([source, stats]) =>
      `${source}: ${stats.unique || 0} found (${stats.status}${stats.error ? `, ${stats.error}` : ""})`
    )
    .join(" · ");
}

async function pollSourceDiscovery() {
  sourceDiscoveryPollTimer = null;
  try {
    const [status, candidates] = await Promise.all([
      api("/api/discovery/status"),
      api("/api/source-candidates")
    ]);
    renderSourceCandidates(candidates);
    const job = status.activeSourceDiscovery;
    if (!job) {
      $("findSourcesBtn").disabled = false;
      const summary = status.lastSourceDiscoverySummary;
      $("sourceDiscoveryStatus").textContent = summary
        ? `Source search complete: ${summary.candidatesDiscovered} candidates found across ${summary.searchesCompleted} searches.${status.lastSourceDiscoveryError ? ` ${status.lastSourceDiscoveryError}` : ""}`
        : "Source search complete.";
      return;
    }
    $("sourceDiscoveryStatus").textContent = `Searching ${job.searchesCompleted}/${job.totalSearchQueries} queries · ${job.candidatesChecked} possible directories checked · ${job.candidatesDiscovered} candidates validated · ${job.errors} errors`;
    sourceDiscoveryPollTimer = setTimeout(pollSourceDiscovery, 3000);
  } catch (error) {
    $("sourceDiscoveryStatus").textContent = error.message;
    $("findSourcesBtn").disabled = false;
  }
}

async function pollSourceRetrieval() {
  sourceRetrievalPollTimer = null;
  try {
    const status = await api("/api/discovery/status");
    const job = status.activePublicDirectoryRetrieval;
    if (!job) {
      $("retrieveSourcesBtn").disabled = !status.approvedDirectorySources.length;
      const summary = status.lastPublicDirectoryRetrievalSummary;
      $("publicSourceResult").textContent = summary
        ? `Last retrieval: ${summary.qualifiedProspectsAdded} qualified prospects from ${summary.companiesVisited} companies across ${summary.companiesDiscovered} new directory listings.${status.lastPublicDirectoryRetrievalError ? ` ${status.lastPublicDirectoryRetrievalError}` : ""}`
        : "No directory retrieval has run yet.";
      await loadAll();
      return;
    }
    $("retrieveSourcesBtn").disabled = true;
    $("publicSourceResult").textContent = `Retrieving approved directories · ${job.companiesCompleted || 0}/${job.companiesDiscovered} companies completed · ${job.pages} pages · ${job.errors} errors`;
    sourceRetrievalPollTimer = setTimeout(pollSourceRetrieval, 3000);
  } catch (error) {
    $("publicSourceResult").textContent = error.message;
    $("retrieveSourcesBtn").disabled = false;
  }
}

async function pollLowerFitResearchJob(jobId) {
  clearTimeout(lowerFitResearchPollTimer);
  try {
    const job = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
    const stale = job.kind === "stale_lead_research";
    const finished = !["queued", "running"].includes(job.status);
    const activity = job.status === "queued"
      ? "Queued"
      : job.status === "failed"
        ? "Failed"
        : job.status === "completed_with_errors"
          ? stale ? "Refresh complete with errors" : "Research complete with errors"
          : finished
            ? stale ? "Refresh complete" : "Research complete"
            : stale ? "Refreshing" : "Re-researching";
    const status = `${activity} ${job.completedTargets}/${job.totalTargets} · ${job.researchedCompanies} sites refreshed · ${job.errors} errors${job.error ? ` · ${job.error}` : ""}`;
    $("lowerFitResearchStatus").textContent = stale ? "" : status;
    $("staleResearchStatus").textContent = stale ? status : "";
    $("researchLowerFitBtn").disabled = !finished;
    $("researchStaleBtn").disabled = !finished;
    if (finished) {
      await loadAll();
    } else {
      lowerFitResearchPollTimer = setTimeout(
        () => pollLowerFitResearchJob(jobId),
        10000
      );
    }
  } catch (error) {
    $("lowerFitResearchStatus").textContent = `Research status error: ${error.message}`;
    $("researchLowerFitBtn").disabled = false;
    $("researchStaleBtn").disabled = false;
  }
}

async function loadAll() {
  try {
    const [config, googleStatus, discoveryStatus, jobs, dashboard, companies, publicSources, sourceCandidates, engineStatus] = await Promise.all([
      api("/api/config"),
      api("/api/google/status"),
      api("/api/discovery/status"),
      api("/api/jobs"),
      api("/api/dashboard"),
      api("/api/companies"),
      api("/api/public-sources"),
      api("/api/source-candidates"),
      api("/api/engine/status")
    ]);
    renderPublicSources(publicSources);
    renderApprovedDirectorySources(discoveryStatus.approvedDirectorySources);
    renderSourceCandidates(sourceCandidates);
    renderLocationPickers(config);
    $("modeNotice").textContent = config.demoMode
      ? "DEMO MODE · Manual crawls use simulated data; daily web discovery (when configured) visits public company websites."
      : "LIVE MODE · Public approved websites are being used.";

    const activeCompanyCrawl = jobs.some(job =>
      ["running", "queued"].includes(job.status) &&
      job.kind !== "daily_web_discovery" &&
      job.kind !== "manual_web_discovery"
    );
    const lowerFitJob = [...jobs].reverse().find(job =>
      ["lower_fit_research", "stale_lead_research"].includes(job.kind) &&
      ["running", "queued"].includes(job.status)
    );
    $("researchLowerFitBtn").disabled = Boolean(lowerFitJob);
    $("researchStaleBtn").disabled = Boolean(lowerFitJob);
    if (lowerFitJob) {
      pollLowerFitResearchJob(lowerFitJob.id);
    } else if (!lowerFitResearchPollTimer) {
      $("lowerFitResearchStatus").textContent = "";
    }
    updateEngineStatus(engineStatus, Boolean(
      engineStatus.activeJob || engineStatus.engine.status === "running" ||
      discoveryStatus.activeSourceDiscovery || discoveryStatus.activePublicDirectoryRetrieval ||
      activeCompanyCrawl || !discoveryStatus.configured
    ));
    $("runDiscoveryBtn").disabled = !discoveryStatus.configured ||
      Boolean(discoveryStatus.activeJob || discoveryStatus.activePublicDirectoryRetrieval || activeCompanyCrawl);
    $("geographicDiscoveryBtn").disabled = Boolean(
      discoveryStatus.activeJob || discoveryStatus.activePublicDirectoryRetrieval || activeCompanyCrawl
    );
    $("findSourcesBtn").disabled = Boolean(
      discoveryStatus.activeSourceDiscovery || discoveryStatus.activeJob ||
      discoveryStatus.activePublicDirectoryRetrieval || activeCompanyCrawl
    );
    $("retrieveSourcesBtn").disabled = !discoveryStatus.approvedDirectorySources.length ||
      Boolean(discoveryStatus.activeSourceDiscovery || discoveryStatus.activeJob ||
        discoveryStatus.activePublicDirectoryRetrieval || activeCompanyCrawl);
    if (discoveryStatus.activeSourceDiscovery) {
      const job = discoveryStatus.activeSourceDiscovery;
      $("sourceDiscoveryStatus").textContent = `Searching ${job.searchesCompleted}/${job.totalSearchQueries} queries · ${job.candidatesChecked} possible directories checked · ${job.candidatesDiscovered} candidates validated · ${job.errors} errors`;
      if (!sourceDiscoveryPollTimer) sourceDiscoveryPollTimer = setTimeout(pollSourceDiscovery, 3000);
    } else if (discoveryStatus.lastSourceDiscoveryAt) {
      const summary = discoveryStatus.lastSourceDiscoverySummary;
      $("sourceDiscoveryStatus").textContent = `Last source search: ${formatDate(discoveryStatus.lastSourceDiscoveryAt)} · ${summary?.candidatesDiscovered || 0} candidates from ${summary?.searchesCompleted || 0} searches.${discoveryStatus.lastSourceDiscoveryError ? ` ${discoveryStatus.lastSourceDiscoveryError}` : ""}`;
    } else {
      $("sourceDiscoveryStatus").textContent = "No source search has run yet. Candidates require approval before crawling.";
    }
    if (discoveryStatus.activePublicDirectoryRetrieval && !sourceRetrievalPollTimer) {
      sourceRetrievalPollTimer = setTimeout(pollSourceRetrieval, 3000);
    }
    if (!discoveryStatus.configured) {
      $("discoveryStatus").textContent = "Web search is temporarily unavailable. Retry shortly.";
      $("discoverySetupStatus").textContent = "The free keyless search provider may be rate-limited. Search coverage is broad, not the entire internet.";
    } else if (discoveryStatus.activePublicDirectoryRetrieval) {
      const job = discoveryStatus.activePublicDirectoryRetrieval;
      $("discoveryStatus").textContent = `Retrieving official public directories · ${job.companiesVisited}/${job.companiesDiscovered} companies visited · ${job.qualifiedProspectsAdded || 0} qualified prospects added · ${job.pages} pages · ${job.errors} errors`;
      $("discoverySetupStatus").textContent = `The scheduled retrieval is processing approved public directories ahead of broad web discovery. Previously captured companies are skipped; only Priority and Research-tier candidates are retained.`;
      $("runDiscoveryBtn").disabled = true;
    } else if (discoveryStatus.activeJob?.kind === "manual_geographic_discovery") {
      const job = discoveryStatus.activeJob;
      $("discoveryStatus").textContent = "Geographic business discovery is running.";
      $("geographicDiscoveryStatus").textContent = job.geographicCandidatesFound
        ? `Geographic discovery: ${job.geographicCandidatesFound} company websites found · ${job.companiesVisited || 0} crawled · ${job.pages || 0} pages scanned · ${job.errors || 0} errors · ${formatGeographicSourceStats(job.geographicSourceStats)}${job.geographicSourceNotes?.length ? ` · Notes: ${job.geographicSourceNotes.join("; ")}` : ""}`
        : `${job.currentActivity || "Searching geographic sources"} · ${job.errors || 0} errors`;
      $("discoverySetupStatus").textContent = "Geographic candidates are checked through the existing permitted website crawl and evidence pipeline.";
      $("runDiscoveryBtn").disabled = true;
      if (!discoveryPollTimer) {
        discoveryPollTimer = setTimeout(() => pollDiscovery(job.id, true), 4000);
      }
    } else if (discoveryStatus.activeJob) {
      const job = discoveryStatus.activeJob;
      const providerPlan = discoveryStatus.authenticatedSearchConfigured
        ? "Authenticated search is configured; provider quotas still apply."
        : "Keyless search has lower rate limits; add a Firecrawl or Brave API key for higher provider limits.";
      const directorySources = discoveryStatus.publicDirectorySources
        .filter(source => source.approved)
        .map(source => source.name);
      const directorySchedule = directorySources.length
        ? ` Approved public directories are retrieved before daily web discovery: ${directorySources.join(", ")}.`
        : " Add an official directory in Configuration to include it in daily retrieval.";
      const dailyTarget = job.dailyTargetEnabled
        ? ` · ${job.dailyQualifiedProspects || discoveryStatus.dailyQualifiedProspects}/${job.dailyQualifiedProspectsTarget} qualified today · batch ${job.searchBatches || 1} · ${job.totalSearchesCompleted || 0} searches completed`
        : "";
      $("discoveryStatus").textContent = `Searching with ${discoveryStatus.provider} · ${job.searchesCompleted}/${job.totalSearchQueries || discoveryStatus.dailySearchQueries} queries · ${job.qualifiedProspectsAdded || 0} qualified prospects added${dailyTarget} · ${job.companiesVisited}/${job.companiesDiscovered} sites visited · ${job.pages} pages${job.rateLimited ? " · provider rate limit reached" : ""}`;
      $("discoverySetupStatus").textContent = job.dailyTargetEnabled
        ? `Structured daily flow: search industry and buying-signal queries, deduplicate company domains, crawl first-party sites, verify legitimacy and ICP fit, and count only newly captured 90+ Priority prospects that pass the legitimacy gate. Target: ${job.dailyQualifiedProspectsTarget} high-potential prospects today; ${Math.max(0, job.dailyQualifiedProspectsTarget - (job.dailyQualifiedProspects || discoveryStatus.dailyQualifiedProspects))} remaining. It continues with rotated query batches until the target is reached or the next scheduled window begins. Search coverage, provider quotas, crawl permissions, and fit criteria can prevent reaching the target. ${directorySchedule} ${providerPlan} Schedule: ${discoveryStatus.schedule}.`
        : `The system runs ${job.totalSearchQueries || discoveryStatus.dailySearchQueries} searches and requests up to ${discoveryStatus.resultsPerQuery} results per query, subject to provider quotas and search coverage. It checks company homepages and up to ${discoveryStatus.maxPagesPerCompany} relevant pages per site, with up to ${discoveryStatus.crawlConcurrency} company sites in parallel; previously saved domains are not added again.${directorySchedule} ${providerPlan} Schedule: ${discoveryStatus.schedule}. Next run: ${formatDate(discoveryStatus.nextRunAt)}.`;
      $("runDiscoveryBtn").disabled = true;
      if (!discoveryPollTimer) discoveryPollTimer = setTimeout(() => pollDiscovery(job.id, false), 4000);
    } else {
      const lastSummary = discoveryStatus.lastRunSummary
        ? ` Last run: ${discoveryStatus.lastRunSummary.qualifiedProspectsAdded || 0} qualified prospects added from ${discoveryStatus.lastRunSummary.sitesVisited} sites.${discoveryStatus.lastRunSummary.dailyTarget ? ` Daily total ${discoveryStatus.lastRunSummary.dailyQualifiedProspects}/${discoveryStatus.lastRunSummary.dailyTarget} (${discoveryStatus.lastRunSummary.dailyTargetMet ? "target reached" : "shortfall"}).` : ""}`
        : "";
      const lastRun = discoveryStatus.lastRunAt ? `Last run: ${formatDate(discoveryStatus.lastRunAt)}. ` : "No daily discovery run has completed yet. ";
      const lastError = discoveryStatus.lastError ? ` Latest issue: ${discoveryStatus.lastError}` : "";
      const directorySummary = discoveryStatus.lastPublicDirectoryRetrievalAt
        ? ` Latest public-directory retrieval: ${discoveryStatus.lastPublicDirectoryRetrievalSummary?.companiesVisited || 0} companies checked, ${discoveryStatus.lastPublicDirectoryRetrievalSummary?.qualifiedProspectsAdded || 0} qualified prospects added, ${discoveryStatus.lastPublicDirectoryRetrievalSummary?.errors || 0} errors.`
        : " Official public directories will be retrieved after the next scheduled web-discovery run.";
      const directoryError = discoveryStatus.lastPublicDirectoryRetrievalError
        ? ` Directory retrieval issue: ${discoveryStatus.lastPublicDirectoryRetrievalError}`
        : "";
      const providerPlan = discoveryStatus.authenticatedSearchConfigured
        ? "Authenticated search is configured; provider quotas still apply."
        : "Keyless search has lower rate limits; configure FIRECRAWL_API_KEY or BRAVE_SEARCH_API_KEY for higher provider limits.";
      $("discoveryStatus").textContent = `${discoveryStatus.provider} · ${lastRun}${lastSummary} Next search: ${formatDate(discoveryStatus.nextRunAt)} · ${discoveryStatus.schedule}.${lastError}${directoryError}`;
      $("discoverySetupStatus").textContent = `Daily target: ${discoveryStatus.dailyQualifiedProspects}/${discoveryStatus.dailyQualifiedProspectsTarget} newly captured, legitimacy-qualified High-potential prospects only (90+ score). Scheduled discovery rotates query batches and continues until the target is reached or the next daily window starts. Search-provider quotas, public index coverage, crawl permissions, and qualification criteria can cause a shortfall; 300 is a goal, not a guaranteed count. Each batch searches up to ${discoveryStatus.dailySearchQueries} queries and requests up to ${discoveryStatus.resultsPerQuery} results per query. Previously saved domains are not added again.${directorySummary}${directoryError} ${providerPlan} The server must remain running for scheduled discovery.${lastError}`;
    }

    googleConnected = googleStatus.connected;
    spreadsheetUrl = googleStatus.spreadsheetUrl || "";
    $("googleSheetsBtn").disabled = !googleStatus.configured;
    $("googleSheetsBtn").textContent = !googleStatus.configured
      ? "Google Sheets setup required"
      : googleConnected ? "Sync to Google Sheets" : "Connect Google Sheets";
    if (!googleStatus.configured) {
      $("googleStatus").textContent = "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Sheets sync.";
      $("googleSetupHelp").innerHTML = `Create a Google OAuth Web application client in <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Google Cloud Credentials</a>, add <code>http://localhost:3000/auth/google/callback</code> as a redirect URI, save the client ID and secret in this app's private <code>.env</code>, then restart the server. See the README for setup steps.`;
    } else if (googleConnected && spreadsheetUrl) {
      showGoogleStatus("Google connected.", spreadsheetUrl);
      $("googleSetupHelp").textContent = "Google Sheets is connected. Sync creates or updates your Dakini AI prospects spreadsheet.";
    } else if (googleConnected) {
      $("googleStatus").textContent = "Google connected. Sync to create your prospect sheet.";
      $("googleSetupHelp").textContent = "Google Sheets is connected. Sync to create your Dakini AI prospects spreadsheet.";
    } else {
      $("googleSetupHelp").textContent = "Connect your Google account, then sync to create a spreadsheet with company name, fit score, opportunities, and public contacts.";
    }

    const dashboardLabels = {
      companies: "Potential clients",
      priority: "High potential",
      review: "Research",
      lowFit: "Lower fit",
      jobs: "Crawls"
    };
    $("dashboard").innerHTML = Object.entries(dashboard)
      .map(([key, value]) => `<div class="stat"><strong>${dashboardLabels[key] || escapeHtml(key)}</strong><br><span>${value}</span></div>`)
      .join("");

    allCompanies = companies.sort((a, b) => b.score.score - a.score.score);
    renderCompanies();

    const activeJob = jobs.slice().reverse().find(job =>
      (job.status === "running" || job.status === "queued") && job.kind !== "daily_web_discovery" && job.kind !== "manual_web_discovery"
    );
    if (activeJob) {
      $("crawlBtn").disabled = true;
      $("jobResult").textContent = `Status: ${activeJob.status}\nCompanies discovered: ${activeJob.discoveredCompanies.length}\nCompanies visited: ${activeJob.companiesVisited}\nPages scanned: ${activeJob.pages}\nFetch errors: ${activeJob.errors.length}`;
      if (!crawlPollTimer) crawlPollTimer = setTimeout(() => pollJob(activeJob.id), 2500);
    } else if (!jobs.length) {
      $("jobResult").textContent = "No crawl running.";
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "connected") {
      showGoogleStatus("Google account connected. Sync to create your prospect sheet.", spreadsheetUrl);
      window.history.replaceState({}, "", window.location.pathname);
    } else if (params.has("googleError")) {
      $("googleStatus").textContent = params.get("googleError");
      window.history.replaceState({}, "", window.location.pathname);
    }
  } catch (error) {
    $("modeNotice").textContent = `App connection error: ${error.message}`;
  }
}

function formatDate(value) {
  if (!value) return "not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadAll();
connectEngineEventStream();
engineStatusPollTimer = setTimeout(pollEngineStatus, 5000);
