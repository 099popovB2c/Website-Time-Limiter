const $ = id => document.getElementById(id);

function normalizeHost(urlOrHost) {
  const raw = String(urlOrHost || "").trim().toLowerCase();

  try {
    if (/^https?:\/\//i.test(raw)) {
      return new URL(raw).hostname
        .toLowerCase()
        .replace(/^www\./, "") || null;
    }
  } catch {
    return null;
  }

  return raw.replace(/^www\./, "") || null;
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

function ruleMatchesHost(rule, host) {
  const ruleHost = normalizeHost(rule.host);
  const actualHost = normalizeHost(host);

  if (!ruleHost || !actualHost) return false;
  if (ruleHost === actualHost) return true;

  return Boolean(rule.includeSubdomains) &&
    actualHost.endsWith(`.${ruleHost}`);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

async function getSettings() {
  const stored = await chrome.storage.sync.get({
    enabled: true,
    rules: []
  });

  return {
    enabled: stored.enabled !== false,
    rules: Array.isArray(stored.rules)
      ? stored.rules
      : []
  };
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

  const usage = {
    ...(stored.usageSecondsByHost || {})
  };

  if (
    stored.trackerHost &&
    stored.trackerStartedAt
  ) {
    usage[stored.trackerHost] =
      Number(usage[stored.trackerHost] || 0) +
      Math.max(
        0,
        Math.floor(
          (Date.now() -
            Number(stored.trackerStartedAt)) / 1000
        )
      );
  }

  return usage;
}

async function renderCurrentSite(rules, usage) {
  const tab = await activeTab();
  const host = normalizeHost(tab?.url || "");

  $("currentHost").textContent =
    host || "Not available";

  if (!host) {
    $("addCurrent").disabled = true;
    $("currentUsage").textContent =
      "Open a normal website first.";
    return;
  }

  $("addCurrent").disabled = false;

  const rule = rules.find(item =>
    ruleMatchesHost(item, host)
  );

  if (rule) {
    const usageHost = normalizeHost(rule.host);

    $("minutes").value = String(rule.minutes);
    $("includeSubdomains").checked =
      Boolean(rule.includeSubdomains);

    $("currentUsage").textContent =
      `${formatTime(usage[usageHost] || 0)} used today • ` +
      `${rule.minutes} min limit` +
      (rule.includeSubdomains
        ? " • shared with subdomains"
        : "");
  } else {
    $("includeSubdomains").checked = false;
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
  meta.textContent =
    `${formatTime(usageSeconds)} used • ` +
    `${rule.minutes} min/day` +
    (rule.includeSubdomains
      ? " • + subdomains"
      : "");

  text.appendChild(host);
  text.appendChild(meta);

  const controls = document.createElement("div");
  controls.className = "rule-controls";

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "1440";
  input.value = String(rule.minutes);
  input.title = "Minutes per day";

  input.addEventListener("change", async () => {
    const { rules } = await getSettings();
    const found = rules.find(
      item => item.host === rule.host
    );

    if (!found) return;

    found.minutes = Math.max(
      1,
      Math.min(
        1440,
        Number(input.value) || 30
      )
    );

    input.value = String(found.minutes);
    await saveRules(rules);
  });

  const subdomains = document.createElement("label");
  subdomains.className = "mini-toggle";
  subdomains.title = "Include subdomains";

  const subCheckbox = document.createElement("input");
  subCheckbox.type = "checkbox";
  subCheckbox.checked =
    Boolean(rule.includeSubdomains);

  const subLabel = document.createElement("span");
  subLabel.textContent = "Sub";

  subCheckbox.addEventListener(
    "change",
    async () => {
      const { rules } = await getSettings();
      const found = rules.find(
        item => item.host === rule.host
      );

      if (!found) return;

      found.includeSubdomains =
        subCheckbox.checked;

      await saveRules(rules);
    }
  );

  subdomains.appendChild(subCheckbox);
  subdomains.appendChild(subLabel);

  controls.appendChild(input);
  controls.appendChild(subdomains);

  const remove = document.createElement("button");
  remove.className = "remove";
  remove.textContent = "×";
  remove.title = "Remove limit";

  remove.addEventListener("click", async () => {
    const { rules } = await getSettings();

    await saveRules(
      rules.filter(
        item => item.host !== rule.host
      )
    );
  });

  wrap.appendChild(text);
  wrap.appendChild(controls);
  wrap.appendChild(remove);

  return wrap;
}

async function render() {
  const settings = await getSettings();
  const rules = settings.rules;
  const usage = await getUsage();

  $("masterEnabled").checked =
    settings.enabled;

  document.body.classList.toggle(
    "wtl-paused",
    !settings.enabled
  );

  $("ruleCount").textContent =
    `${rules.length} site${rules.length === 1 ? "" : "s"}`;

  $("rules").replaceChildren();

  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No website limits yet.";
    $("rules").appendChild(empty);
  } else {
    for (
      const rule of [...rules].sort(
        (a, b) =>
          a.host.localeCompare(b.host)
      )
    ) {
      const usageHost =
        normalizeHost(rule.host);

      $("rules").appendChild(
        ruleRow(
          rule,
          Number(usage[usageHost] || 0)
        )
      );
    }
  }

  await renderCurrentSite(rules, usage);
}

$("masterEnabled").addEventListener(
  "change",
  async event => {
    await chrome.storage.sync.set({
      enabled: event.target.checked
    });

    await chrome.runtime.sendMessage({
      type: "WTL_FORCE_REFRESH_TRACKER"
    }).catch(() => {});

    await render();

    $("status").textContent =
      event.target.checked
        ? "Time limits enabled."
        : "Time limits paused.";
  }
);

$("addCurrent").addEventListener(
  "click",
  async () => {
    const tab = await activeTab();
    const host = normalizeHost(tab?.url || "");

    if (!host) {
      $("status").textContent =
        "Open a normal website first.";
      return;
    }

    const minutes = Math.max(
      1,
      Math.min(
        1440,
        Number($("minutes").value) || 30
      )
    );

    $("minutes").value = String(minutes);

    const settings = await getSettings();
    const rules = settings.rules;

    const exact = rules.find(
      rule => normalizeHost(rule.host) === host
    );

    if (exact) {
      exact.minutes = minutes;
      exact.enabled = true;
      exact.includeSubdomains =
        $("includeSubdomains").checked;
    } else {
      rules.push({
        host,
        minutes,
        enabled: true,
        includeSubdomains:
          $("includeSubdomains").checked
      });
    }

    await saveRules(rules);

    $("status").textContent =
      `${host}: ${minutes} min/day saved` +
      ($("includeSubdomains").checked
        ? " + subdomains."
        : ".");
  }
);

$("focusPreset").addEventListener(
  "click",
  async () => {
    const preset = [
      {
        host: "x.com",
        minutes: 30,
        enabled: true,
        includeSubdomains: true
      },
      {
        host: "youtube.com",
        minutes: 60,
        enabled: true,
        includeSubdomains: true
      },
      {
        host: "reddit.com",
        minutes: 30,
        enabled: true,
        includeSubdomains: true
      },
      {
        host: "instagram.com",
        minutes: 30,
        enabled: true,
        includeSubdomains: true
      },
      {
        host: "facebook.com",
        minutes: 30,
        enabled: true,
        includeSubdomains: true
      }
    ];

    const ok = window.confirm(
      "Apply Focus preset?\n\n" +
      "X: 30 min\n" +
      "YouTube: 60 min\n" +
      "Reddit: 30 min\n" +
      "Instagram: 30 min\n" +
      "Facebook: 30 min\n\n" +
      "Subdomains will share each site's budget."
    );

    if (!ok) return;

    await chrome.storage.sync.set({
      enabled: true,
      rules: preset
    });

    await render();
    $("status").textContent =
      "Focus preset applied.";
  }
);

$("resetUsage").addEventListener(
  "click",
  async () => {
    const ok = window.confirm(
      "Reset today's tracked time for all limited websites?"
    );

    if (!ok) return;

    await chrome.storage.local.set({
      usageDate: todayKey(),
      usageSecondsByHost: {},
      unlockUntilByHost: {},
      trackerHost: null,
      trackerStartedAt: null
    });

    await chrome.runtime.sendMessage({
      type: "WTL_FORCE_REFRESH_TRACKER"
    }).catch(() => {});

    await render();

    $("status").textContent =
      "Today's usage reset.";
  }
);

render().catch(error => {
  $("status").textContent = String(error);
});

setInterval(() => {
  render().catch(() => {});
}, 5000);
