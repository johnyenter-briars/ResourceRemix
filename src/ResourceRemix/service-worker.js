const STORAGE_KEY = "resourceRemixSettings";
const RULE_ID_BASE = 10000;

const RESOURCE_PRESETS = {
  common: ["main_frame", "sub_frame", "script", "stylesheet", "xmlhttprequest", "fetch", "image", "font", "media", "other"],
  script: ["script"],
  stylesheet: ["stylesheet"],
  document: ["main_frame", "sub_frame"],
  all: ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other"]
};

chrome.runtime.onInstalled.addListener(syncRules);
chrome.runtime.onStartup.addListener(syncRules);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEY]) {
    syncRules();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.action === "syncRules") {
    syncRules()
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

async function syncRules() {
  const settings = await getSettings();
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules
    .filter((rule) => rule.id >= RULE_ID_BASE)
    .map((rule) => rule.id);
  const addRules = settings.enabled === false
    ? []
    : settings.rules.filter((rule) => rule.enabled !== false).map(toDnrRule);

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules
  });

  return {
    added: addRules.length,
    removed: removeRuleIds.length
  };
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return normalizeSettings(data[STORAGE_KEY]);
}

function normalizeSettings(settings) {
  const normalized = settings && typeof settings === "object" ? settings : {};
  return {
    enabled: normalized.enabled !== false,
    rules: Array.isArray(normalized.rules) ? normalized.rules : []
  };
}

function toDnrRule(rule, index) {
  const condition = {
    resourceTypes: RESOURCE_PRESETS[rule.resourcePreset] || RESOURCE_PRESETS.common
  };

  if (rule.matchType === "regex") {
    condition.regexFilter = rule.source;
  } else if (rule.matchType === "contains") {
    condition.urlFilter = rule.source;
  } else {
    condition.urlFilter = `|${rule.source}|`;
  }

  const initiatorDomains = parseDomains(rule.initiators);
  if (initiatorDomains.length > 0) {
    condition.initiatorDomains = initiatorDomains;
  }

  return {
    id: RULE_ID_BASE + index + 1,
    priority: Number(rule.priority) || 1,
    action: {
      type: "redirect",
      redirect: {
        url: rule.target
      }
    },
    condition
  };
}

function parseDomains(value) {
  if (!value || typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean)
    .map((domain) => domain.replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter((domain) => domain && !domain.includes(":"));
}
