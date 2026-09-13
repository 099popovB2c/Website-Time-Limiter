const $ = id => document.getElementById(id);

function normalizeHost(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(seconds) {
  const value = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);

  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tab;
}

async function getRules() {
  const stored = await chrome.storage.sync.get({ rules: [] });
  return Array.isArray(stored.rules) ? stored.rules : [];
}

async function saveRules(rules) {
  await chrome.storage.sync.set({ rules });
  await render();
}

async function getUsage() {
  const stored = await chrome.storage.local.get({
    usageDate: "",
    usageSecondsByHost: {},
    trackerHost: null,
    trackerStartedAt: null
  });

  if (stored.usageDate !== todayKey()) {
    return {};
  }

  const usage = { ...(stored.usageSecondsByHost || {}) };

  if (stored.trackerHost && stored.trackerStartedAt) {
    usage[stored.trackerHost] =
      Number(usage[stored.trackerHost] || 0) +
      Math.max(0, Math.floor((Date.now() - Number(stored.trackerStartedAt)) / 1000));
  }

  return usage;
}

async function renderCurrentSite(rules, usage) {
  const tab = await activeTab();
  const host = normalizeHost(tab?.url || "");

  $("currentHost").textContent = host || "Not available";

  if (!host) {
    $("addCurrent").disabled = true;
    $("currentUsage").textContent = "Open a normal website first.";
    return;
  }

  $("addCurrent").disabled = false;

  const rule = rules.find(item => item.host === host);

  if (rule) {
    $("minutes").value = String(rule.minutes);
    $("currentUsage").textContent =
      `${formatTime(usage[host] || 0)} used today • ${rule.minutes} min limit`;
  } else {
    $("currentUsage").textContent =
      `${formatTime(usage[host] || 0)} used today • no limit yet`;
  }
}

function ruleRow(rule, usageSeconds) {
  const wrap = document.createElement("div");
  wrap.className = "rule-row";

  const text = document.createElement("div");
  text.className = "rule-text";

  const host = document.createElement("strong");
  host.textContent = rule.host;

  const meta = document.createElement("small");
  meta.textContent = `${formatTime(usageSeconds)} used • ${rule.minutes} min/day`;

  text.appendChild(host);
  text.appendChild(meta);

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "1440";
  input.value = String(rule.minutes);
  input.title = "Minutes per day";

  input.addEventListener("change", async () => {
    const rules = await getRules();
    const found = rules.find(item => item.host === rule.host);
    if (!found) return;

    found.minutes = Math.max(1, Math.min(1440, Number(input.value) || 30));
    input.value = String(found.minutes);
    await saveRules(rules);
  });

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Remove limit";
  remove.addEventListener("click", async () => {
    const rules = (await getRules()).filter(item => item.host !== rule.host);
    await saveRules(rules);
  });

  wrap.appendChild(text);
  wrap.appendChild(input);
  wrap.appendChild(remove);

  return wrap;
}

async function render() {
  const rules = await getRules();
  const usage = await getUsage();

  $("ruleCount").textContent = `${rules.length} site${rules.length === 1 ? "" : "s"}`;
  $("rules").replaceChildren();

  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No website limits yet.";
    $("rules").appendChild(empty);
  } else {
    for (const rule of [...rules].sort((a, b) => a.host.localeCompare(b.host))) {
      $("rules").appendChild(ruleRow(rule, Number(usage[rule.host] || 0)));
    }
  }

  await renderCurrentSite(rules, usage);
}

$("addCurrent").addEventListener("click", async () => {
  const tab = await activeTab();
  const host = normalizeHost(tab?.url || "");

  if (!host) {
    $("status").textContent = "Open a normal website first.";
    return;
  }

  const minutes = Math.max(
    1,
    Math.min(1440, Number($("minutes").value) || 30)
  );

  $("minutes").value = String(minutes);

  const rules = await getRules();
  const existing = rules.find(rule => rule.host === host);

  if (existing) {
    existing.minutes = minutes;
    existing.enabled = true;
  } else {
    rules.push({
      host,
      minutes,
      enabled: true
    });
  }

  await saveRules(rules);
  $("status").textContent = `${host}: ${minutes} min/day saved.`;
});

$("focusPreset").addEventListener("click", async () => {
  const preset = [
    { host: "x.com", minutes: 30, enabled: true },
    { host: "youtube.com", minutes: 60, enabled: true },
    { host: "reddit.com", minutes: 30, enabled: true },
    { host: "instagram.com", minutes: 30, enabled: true },
    { host: "facebook.com", minutes: 30, enabled: true }
  ];

  const ok = window.confirm(
    "Apply Focus preset?\n\nX: 30 min\nYouTube: 60 min\nReddit: 30 min\nInstagram: 30 min\nFacebook: 30 min"
  );

  if (!ok) return;

  await saveRules(preset);
  $("status").textContent = "Focus preset applied.";
});

$("resetUsage").addEventListener("click", async () => {
  const ok = window.confirm("Reset today's tracked time for all limited websites?");
  if (!ok) return;

  await chrome.storage.local.set({
    usageDate: todayKey(),
    usageSecondsByHost: {},
    unlockUntilByHost: {},
    trackerHost: null,
    trackerStartedAt: null
  });

  await chrome.runtime.sendMessage({ type: "WTL_FORCE_REFRESH_TRACKER" }).catch(() => {});
  await render();
  $("status").textContent = "Today's usage reset.";
});

render().catch(error => {
  $("status").textContent = String(error);
});

setInterval(() => {
  render().catch(() => {});
}, 5000);
