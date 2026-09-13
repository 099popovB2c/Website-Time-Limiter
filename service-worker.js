const TICK_ALARM = "WTL_TICK";
const IDLE_SECONDS = 60;

chrome.idle.setDetectionInterval(IDLE_SECONDS);

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

function isTrackableUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

async function getRules() {
  const stored = await chrome.storage.sync.get({ rules: [] });
  return Array.isArray(stored.rules) ? stored.rules : [];
}

async function getRuleForHost(host) {
  const rules = await getRules();
  return rules.find(rule => rule.enabled !== false && rule.host === host) || null;
}

async function ensureToday() {
  const day = todayKey();
  const stored = await chrome.storage.local.get({
    usageDate: "",
    usageSecondsByHost: {},
    unlockUntilByHost: {}
  });

  if (stored.usageDate !== day) {
    await chrome.storage.local.set({
      usageDate: day,
      usageSecondsByHost: {},
      unlockUntilByHost: {},
      trackerHost: null,
      trackerStartedAt: null
    });
    return {
      usageDate: day,
      usageSecondsByHost: {},
      unlockUntilByHost: {}
    };
  }

  return stored;
}

async function addUsage(host, seconds) {
  if (!host || seconds <= 0) return;

  const state = await ensureToday();
  const usage = { ...(state.usageSecondsByHost || {}) };
  usage[host] = Number(usage[host] || 0) + seconds;

  await chrome.storage.local.set({
    usageSecondsByHost: usage
  });
}

async function flushTracker() {
  const now = Date.now();
  const stored = await chrome.storage.local.get({
    trackerHost: null,
    trackerStartedAt: null
  });

  const host = stored.trackerHost;
  const started = Number(stored.trackerStartedAt || 0);

  if (host && started > 0 && now > started) {
    const elapsedSeconds = Math.max(0, Math.floor((now - started) / 1000));
    if (elapsedSeconds > 0) {
      await addUsage(host, elapsedSeconds);
    }
  }

  await chrome.storage.local.set({
    trackerHost: null,
    trackerStartedAt: null
  });
}

async function setTracker(host) {
  await flushTracker();

  if (!host) return;

  await chrome.storage.local.set({
    trackerHost: host,
    trackerStartedAt: Date.now()
  });
}

async function getActiveTrackableHost() {
  const idleState = await chrome.idle.queryState(IDLE_SECONDS);
  if (idleState !== "active") return null;

  const windows = await chrome.windows.getAll({ populate: true });
  const focused = windows.find(w => w.focused);
  if (!focused) return null;

  const activeTab = (focused.tabs || []).find(tab => tab.active);
  if (!activeTab || !isTrackableUrl(activeTab.url)) return null;

  const host = normalizeHost(activeTab.url);
  if (!host) return null;

  const rule = await getRuleForHost(host);
  return rule ? host : null;
}

async function refreshTracker() {
  await ensureToday();
  const host = await getActiveTrackableHost();

  const stored = await chrome.storage.local.get({
    trackerHost: null
  });

  if (stored.trackerHost === host) return;
  await setTracker(host);
}

async function notifyTabsForHost(host) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || normalizeHost(tab.url) !== host) continue;
    chrome.tabs.sendMessage(tab.id, { type: "WTL_REFRESH_BLOCK" }).catch(() => {});
  }
}

async function getHostStatus(host) {
  const rule = await getRuleForHost(host);
  const state = await ensureToday();

  if (!rule) {
    return { tracked: false, host, blocked: false, usedSeconds: 0, limitSeconds: 0 };
  }

  let usedSeconds = Number((state.usageSecondsByHost || {})[host] || 0);

  const tracker = await chrome.storage.local.get({
    trackerHost: null,
    trackerStartedAt: null
  });

  if (tracker.trackerHost === host && tracker.trackerStartedAt) {
    usedSeconds += Math.max(
      0,
      Math.floor((Date.now() - Number(tracker.trackerStartedAt)) / 1000)
    );
  }

  const limitSeconds = Math.max(1, Number(rule.minutes || 1)) * 60;
  const unlockUntil = Number((state.unlockUntilByHost || {})[host] || 0);

  return {
    tracked: true,
    host,
    blocked: usedSeconds >= limitSeconds && unlockUntil <= Date.now(),
    usedSeconds,
    limitSeconds,
    unlockUntil
  };
}

async function grantTemporaryAccess(host, minutes = 5) {
  const state = await ensureToday();
  const unlocks = { ...(state.unlockUntilByHost || {}) };
  unlocks[host] = Date.now() + Math.max(1, Number(minutes || 5)) * 60 * 1000;

  await chrome.storage.local.set({
    unlockUntilByHost: unlocks
  });

  await notifyTabsForHost(host);
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  await refreshTracker();
});

chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
  await refreshTracker();
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== TICK_ALARM) return;
  await flushTracker();
  await refreshTracker();

  const rules = await getRules();
  for (const rule of rules) {
    if (rule.enabled === false) continue;
    await notifyTabsForHost(rule.host);
  }
});

chrome.tabs.onActivated.addListener(() => {
  refreshTracker().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    refreshTracker().catch(() => {});
  }
});

chrome.windows.onFocusChanged.addListener(() => {
  refreshTracker().catch(() => {});
});

chrome.idle.onStateChanged.addListener(() => {
  refreshTracker().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.rules) {
    refreshTracker().catch(() => {});
    chrome.tabs.query({}).then(tabs => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, { type: "WTL_REFRESH_BLOCK" }).catch(() => {});
        }
      }
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "WTL_GET_STATUS") {
    getHostStatus(message.host)
      .then(sendResponse)
      .catch(error => sendResponse({ error: String(error) }));
    return true;
  }

  if (message?.type === "WTL_GRANT_TEMP_ACCESS") {
    grantTemporaryAccess(message.host, message.minutes || 5)
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (message?.type === "WTL_FORCE_REFRESH_TRACKER") {
    refreshTracker()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

refreshTracker().catch(() => {});
