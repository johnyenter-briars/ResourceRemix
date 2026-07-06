const STORAGE_KEY = "resourceRemixSettings";

const form = {
  enabled: document.querySelector("#enabled"),
  editingId: document.querySelector("#editingId"),
  name: document.querySelector("#name"),
  matchType: document.querySelector("#matchType"),
  resourcePreset: document.querySelector("#resourcePreset"),
  source: document.querySelector("#source"),
  target: document.querySelector("#target"),
  initiators: document.querySelector("#initiators"),
  save: document.querySelector("#save"),
  cancelEdit: document.querySelector("#cancelEdit"),
  exportRules: document.querySelector("#exportRules"),
  importRules: document.querySelector("#importRules"),
  clearRules: document.querySelector("#clearRules"),
  jsonBox: document.querySelector("#jsonBox"),
  rules: document.querySelector("#rules"),
  status: document.querySelector("#status"),
  template: document.querySelector("#ruleTemplate")
};

let state = {
  enabled: true,
  rules: []
};

init();

async function init() {
  state = await loadSettings();
  form.enabled.checked = state.enabled;
  renderRules();
  resetEditor();

  form.enabled.addEventListener("change", async () => {
    state.enabled = form.enabled.checked;
    await saveSettings("Extension state saved.");
  });
  form.save.addEventListener("click", saveRule);
  form.cancelEdit.addEventListener("click", resetEditor);
  form.exportRules.addEventListener("click", exportRules);
  form.importRules.addEventListener("click", importRules);
  form.clearRules.addEventListener("click", clearRules);
}

async function loadSettings() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  const settings = data[STORAGE_KEY] || {};
  return {
    enabled: settings.enabled !== false,
    rules: Array.isArray(settings.rules) ? settings.rules : []
  };
}

async function saveSettings(message) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  const response = await chrome.runtime.sendMessage({ action: "syncRules" });
  if (!response || !response.ok) {
    const detail = response && response.error ? response.error : "Chrome rejected the rule update.";
    setStatus(detail, true);
    return;
  }
  renderRules();
  setStatus(message || `Synced ${response.result.added} active rule(s).`);
}

async function saveRule() {
  const rule = readEditor();
  const error = await validateRule(rule);
  if (error) {
    setStatus(error, true);
    return;
  }

  const editingId = form.editingId.value;
  if (editingId) {
    const index = state.rules.findIndex((item) => item.id === editingId);
    if (index >= 0) {
      state.rules[index] = { ...state.rules[index], ...rule };
    }
  } else {
    state.rules.push({
      id: crypto.randomUUID(),
      enabled: true,
      ...rule
    });
  }

  resetEditor();
  await saveSettings("Rule saved.");
}

function readEditor() {
  return {
    name: form.name.value.trim(),
    matchType: form.matchType.value,
    resourcePreset: form.resourcePreset.value,
    source: form.source.value.trim(),
    target: form.target.value.trim(),
    initiators: form.initiators.value.trim()
  };
}

async function validateRule(rule) {
  if (!rule.source) {
    return "Request URL stub is required.";
  }
  if (!rule.target) {
    return "Replacement URL is required.";
  }
  try {
    const targetUrl = new URL(rule.target);
    if (!["http:", "https:"].includes(targetUrl.protocol)) {
      return "Replacement URL must start with http:// or https://.";
    }
  } catch {
    return "Replacement URL must be a valid absolute URL.";
  }
  if (rule.matchType === "exact") {
    try {
      new URL(rule.source);
    } catch {
      return "Exact URL rules need a valid absolute request URL.";
    }
  } else if (rule.matchType === "regex") {
    const result = await chrome.declarativeNetRequest.isRegexSupported({
      regex: rule.source,
      requireCapturing: false
    });
    if (!result.isSupported) {
      return result.reason || "Chrome cannot use this regex in a redirect rule.";
    }
  }
  return "";
}

function renderRules() {
  form.rules.replaceChildren();

  if (state.rules.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No redirects configured.";
    form.rules.append(empty);
    return;
  }

  for (const rule of state.rules) {
    const node = form.template.content.firstElementChild.cloneNode(true);
    node.querySelector(".ruleName").textContent = rule.name || "(unnamed rule)";
    node.querySelector(".ruleSource").textContent = `${rule.matchType}: ${rule.source}`;
    node.querySelector(".ruleTarget").textContent = `-> ${rule.target}`;

    const enabled = node.querySelector(".ruleEnabled");
    enabled.checked = rule.enabled !== false;
    enabled.addEventListener("change", async () => {
      rule.enabled = enabled.checked;
      await saveSettings("Rule state saved.");
    });

    node.querySelector(".edit").addEventListener("click", () => editRule(rule));
    node.querySelector(".delete").addEventListener("click", async () => {
      state.rules = state.rules.filter((item) => item.id !== rule.id);
      await saveSettings("Rule deleted.");
    });

    form.rules.append(node);
  }
}

function editRule(rule) {
  form.editingId.value = rule.id;
  form.name.value = rule.name || "";
  form.matchType.value = rule.matchType || "exact";
  form.resourcePreset.value = rule.resourcePreset || "common";
  form.source.value = rule.source || "";
  form.target.value = rule.target || "";
  form.initiators.value = rule.initiators || "";
  form.save.textContent = "Update Rule";
}

function resetEditor() {
  form.editingId.value = "";
  form.name.value = "";
  form.matchType.value = "exact";
  form.resourcePreset.value = "common";
  form.source.value = "";
  form.target.value = "";
  form.initiators.value = "";
  form.save.textContent = "Save Rule";
}

function exportRules() {
  form.jsonBox.value = JSON.stringify(state, null, 2);
  setStatus("Rules exported.");
}

async function importRules() {
  let parsed;
  try {
    parsed = JSON.parse(form.jsonBox.value);
  } catch {
    setStatus("Import JSON is invalid.", true);
    return;
  }

  if (!parsed || !Array.isArray(parsed.rules)) {
    setStatus("Import JSON must contain a rules array.", true);
    return;
  }

  state = {
    enabled: parsed.enabled !== false,
    rules: parsed.rules.map((rule) => ({
      id: rule.id || crypto.randomUUID(),
      enabled: rule.enabled !== false,
      name: String(rule.name || ""),
      matchType: ["exact", "contains", "regex"].includes(rule.matchType) ? rule.matchType : "exact",
      resourcePreset: rule.resourcePreset || "common",
      source: String(rule.source || ""),
      target: String(rule.target || ""),
      initiators: String(rule.initiators || "")
    }))
  };

  form.enabled.checked = state.enabled;
  resetEditor();
  await saveSettings("Rules imported.");
}

async function clearRules() {
  state.rules = [];
  resetEditor();
  await saveSettings("Rules cleared.");
}

function setStatus(message, isError) {
  form.status.textContent = message;
  form.status.classList.toggle("error", Boolean(isError));
}
