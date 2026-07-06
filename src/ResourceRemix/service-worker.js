const STORAGE_KEY = "resourceRemixSettings";
const MATCH_LOG_KEY = "resourceRemixMatchLog";
const RULE_ID_BASE = 10000;
const MAX_MATCH_LOG = 50;
let syncQueue = Promise.resolve();

const RESOURCE_PRESETS = {
	common: ["main_frame", "sub_frame", "script", "stylesheet", "xmlhttprequest", "image", "font", "media", "other"],
	script: ["script"],
	stylesheet: ["stylesheet"],
	document: ["main_frame", "sub_frame"],
	all: ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket", "webtransport", "webbundle", "other"]
};

chrome.runtime.onInstalled.addListener(syncRules);
chrome.runtime.onStartup.addListener(syncRules);
chrome.action.onClicked.addListener(openOptionsTab);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message && message.action === "syncRules") {
		syncRules()
			.then((result) => sendResponse({ ok: true, result }))
			.catch((error) => sendResponse({ ok: false, error: error.message }));
		return true;
	}

	if (message && message.action === "clearMatchLog") {
		clearMatchLog()
			.then(() => sendResponse({ ok: true }))
			.catch((error) => sendResponse({ ok: false, error: error.message }));
		return true;
	}
});

if (chrome.declarativeNetRequest.onRuleMatchedDebug) {
	chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(recordMatch);
}

async function syncRules() {
	syncQueue = syncQueue.then(applyRules, applyRules);
	return syncQueue;
}

async function applyRules() {
	const settings = await getSettings();
	const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
	const removeRuleIds = existingRules
		.filter((rule) => rule.id >= RULE_ID_BASE)
		.map((rule) => rule.id);
	const addRules = settings.rules
		.map((rule, index) => rule.enabled === false ? null : toDnrRule(rule, index))
		.filter(Boolean);

	await chrome.declarativeNetRequest.updateDynamicRules({
		removeRuleIds,
		addRules
	});

	return {
		added: addRules.length,
		removed: removeRuleIds.length
	};
}

async function openOptionsTab() {
	const optionsUrl = chrome.runtime.getURL("options.html");
	const tabs = await chrome.tabs.query({});
	const existingTab = tabs.find((tab) => tab.url === optionsUrl);

	if (existingTab && existingTab.id) {
		await chrome.tabs.update(existingTab.id, { active: true });
		if (existingTab.windowId) {
			await chrome.windows.update(existingTab.windowId, { focused: true });
		}
		return;
	}

	await chrome.tabs.create({ url: optionsUrl });
}

async function getSettings() {
	const data = await chrome.storage.local.get(STORAGE_KEY);
	return normalizeSettings(data[STORAGE_KEY]);
}

function normalizeSettings(settings) {
	const normalized = settings && typeof settings === "object" ? settings : {};
	return {
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

async function recordMatch(info) {
	const data = await chrome.storage.local.get([MATCH_LOG_KEY, STORAGE_KEY]);
	const settings = normalizeSettings(data[STORAGE_KEY]);
	const matchLog = Array.isArray(data[MATCH_LOG_KEY]) ? data[MATCH_LOG_KEY] : [];
	const rule = settings.rules[info.rule.ruleId - RULE_ID_BASE - 1];

	matchLog.unshift({
		at: new Date().toISOString(),
		ruleId: info.rule.ruleId,
		ruleName: rule && rule.name ? rule.name : "",
		ruleSource: rule && rule.source ? rule.source : "",
		redirectUrl: rule && rule.target ? rule.target : "",
		requestUrl: info.request.url,
		resourceType: info.request.type,
		tabId: info.request.tabId
	});

	await chrome.storage.local.set({
		[MATCH_LOG_KEY]: matchLog.slice(0, MAX_MATCH_LOG)
	});

	await chrome.action.setBadgeText({ text: String(Math.min(matchLog.length + 1, 99)) });
	await chrome.action.setBadgeBackgroundColor({ color: "#0f789b" });
}

async function clearMatchLog() {
	await chrome.storage.local.set({ [MATCH_LOG_KEY]: [] });
	await chrome.action.setBadgeText({ text: "" });
}
