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

function normalizeHost(urlOrHost) {
  const raw = String(urlOrHost || "").trim().toLowerCase();

  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).hostname.toLowerCase().replace(/^www\./, "") || null;
    }
  } catch {
    return null;
  }

  return raw.replace(/^www\./, "") || null;
}

function isTrackableUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

function ruleMatchesHost(rule, host) {
  if (!rule || rule.enabled === false || !host) return false;

  const ruleHost = normalizeHost(rule.host);
  const currentHost = normalizeHost(host);

  if (!ruleHost || !currentHost) return false;
  if (currentHost === ruleHost) return true;

  return Boolean(rule.includeSubdomains) &&
    currentHost.endsWith(`.${ruleHost}`);
}

async function getSettings() {
  const stored = await chrome.storage.sync.get({
    enabled: true,
    rules: []
  });

  return {
    enabled: stored.enabled !== false,
    rules: Array.isArray(stored.rules) ? stored.rules : []
  };
}

async function getRuleForHost(host) {
  const settings = await getSettings();
  if (!settings.enabled) return null;

  return settings.rules.find(rule => ruleMatchesHost(rule, host)) || null;
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
    const elapsedSeconds = Math.max(
      0,
      Math.floor((now - started) / 1000)
    );

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

async function getActiveTrackingKey() {
  const settings = await getSettings();
  if (!settings.enabled) return null;

  const idleState = await chrome.idle.queryState(IDLE_SECONDS);
  if (idleState !== "active") return null;

  const windows = await chrome.windows.getAll({ populate: true });
  const focused = windows.find(windowInfo => windowInfo.focused);
  if (!focused) return null;

  const activeTab = (focused.tabs || []).find(tab => tab.active);
  if (!activeTab || !isTrackableUrl(activeTab.url)) return null;

  const actualHost = normalizeHost(activeTab.url);
  if (!actualHost) return null;

  const rule = settings.rules.find(item => ruleMatchesHost(item, actualHost));
  return rule ? normalizeHost(rule.host) : null;
}

async function refreshTracker() {
  await ensureToday();
  const host = await getActiveTrackingKey();

  const stored = await chrome.storage.local.get({
    trackerHost: null
  });

  if (stored.trackerHost === host) return;
  await setTracker(host);
}

async function notifyAllTabs() {
  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (!tab.id || !isTrackableUrl(tab.url)) continue;

    chrome.tabs.sendMessage(
      tab.id,
      { type: "WTL_REFRESH_BLOCK" }
    ).catch(() => {});
  }
}

async function notifyTabsForRule(rule) {
  if (!rule) return;

  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (!tab.id || !isTrackableUrl(tab.url)) continue;

    const host = normalizeHost(tab.url);
    if (!ruleMatchesHost(rule, host)) continue;

    chrome.tabs.sendMessage(
      tab.id,
      { type: "WTL_REFRESH_BLOCK" }
    ).catch(() => {});
  }
}

async function getHostStatus(actualHost) {
  const settings = await getSettings();

  if (!settings.enabled) {
    return {
      enabled: false,
      tracked: false,
      host: actualHost,
      blocked: false,
      usedSeconds: 0,
      limitSeconds: 0
    };
  }

  const rule = settings.rules.find(
    item => ruleMatchesHost(item, actualHost)
  );

  const state = await ensureToday();

  if (!rule) {
    return {
      enabled: true,
      tracked: false,
      host: actualHost,
      blocked: false,
      usedSeconds: 0,
      limitSeconds: 0
    };
  }

  const usageHost = normalizeHost(rule.host);
  let usedSeconds = Number(
    (state.usageSecondsByHost || {})[usageHost] || 0
  );

  const tracker = await chrome.storage.local.get({
    trackerHost: null,
    trackerStartedAt: null
  });

  if (
    tracker.trackerHost === usageHost &&
    tracker.trackerStartedAt
  ) {
    usedSeconds += Math.max(
      0,
      Math.floor(
        (Date.now() - Number(tracker.trackerStartedAt)) / 1000
      )
    );
  }

  const limitSeconds =
    Math.max(1, Number(rule.minutes || 1)) * 60;

  const unlockUntil = Number(
    (state.unlockUntilByHost || {})[usageHost] || 0
  );

  return {
    enabled: true,
    tracked: true,
    host: actualHost,
    ruleHost: usageHost,
    includeSubdomains: Boolean(rule.includeSubdomains),
    blocked:
      usedSeconds >= limitSeconds &&
      unlockUntil <= Date.now(),
    usedSeconds,
    limitSeconds,
    unlockUntil
  };
}

async function grantTemporaryAccess(actualHost, minutes = 5) {
  const rule = await getRuleForHost(actualHost);
  if (!rule) return;

  const usageHost = normalizeHost(rule.host);
  const state = await ensureToday();
  const unlocks = { ...(state.unlockUntilByHost || {}) };

  unlocks[usageHost] =
    Date.now() +
    Math.max(1, Number(minutes || 5)) * 60 * 1000;

  await chrome.storage.local.set({
    unlockUntilByHost: unlocks
  });

  await notifyTabsForRule(rule);
}

async function closeSenderTab(sender) {
  const tabId = sender?.tab?.id;
  if (!tabId) return false;

  await chrome.tabs.remove(tabId);
  return true;
}

async function ensureAlarm() {
  const existing = await chrome.alarms.get(TICK_ALARM);

  if (!existing) {
    await chrome.alarms.create(TICK_ALARM, {
      periodInMinutes: 1
    });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await refreshTracker();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await refreshTracker();
});

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== TICK_ALARM) return;

  await flushTracker();
  await refreshTracker();
  await notifyAllTabs();
});

chrome.tabs.onActivated.addListener(() => {
  refreshTracker().catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    refreshTracker().catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(() => {
  refreshTracker().catch(() => {});
});

chrome.windows.onFocusChanged.addListener(() => {
  refreshTracker().catch(() => {});
});

chrome.idle.onStateChanged.addListener(() => {
  refreshTracker().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (
    area === "sync" &&
    (changes.rules || changes.enabled)
  ) {
    (async () => {
      await flushTracker();
      await refreshTracker();
      await notifyAllTabs();
    })().catch(() => {});
  }
});

chrome.runtime.onMessage.addListener(
  (message, sender, sendResponse) => {
    if (message?.type === "WTL_GET_STATUS") {
      getHostStatus(message.host)
        .then(sendResponse)
        .catch(error =>
          sendResponse({ error: String(error) })
        );
      return true;
    }

    if (message?.type === "WTL_GRANT_TEMP_ACCESS") {
      grantTemporaryAccess(
        message.host,
        message.minutes || 5
      )
        .then(() => sendResponse({ ok: true }))
        .catch(error =>
          sendResponse({
            ok: false,
            error: String(error)
          })
        );
      return true;
    }

    if (message?.type === "WTL_CLOSE_TAB") {
      closeSenderTab(sender)
        .then(closed => sendResponse({ ok: closed }))
        .catch(error =>
          sendResponse({
            ok: false,
            error: String(error)
          })
        );
      return true;
    }

    if (message?.type === "WTL_FORCE_REFRESH_TRACKER") {
      refreshTracker()
        .then(() => sendResponse({ ok: true }))
        .catch(error =>
          sendResponse({
            ok: false,
            error: String(error)
          })
        );
      return true;
    }
  }
);

ensureAlarm().catch(() => {});
refreshTracker().catch(() => {});
