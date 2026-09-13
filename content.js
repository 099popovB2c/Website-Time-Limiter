(() => {
  if (window.__websiteTimeLimiterLoaded) return;
  window.__websiteTimeLimiterLoaded = true;

  const host = location.hostname.toLowerCase().replace(/^www\./, "");
  let overlay = null;

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;

    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${r}s`;
    return `${r}s`;
  }

  function removeOverlay() {
    overlay?.remove();
    overlay = null;
    document.documentElement.classList.remove("wtl-blocked");
  }

  function showOverlay(status) {
    if (!status?.blocked) {
      removeOverlay();
      return;
    }

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "wtl-overlay";

      const card = document.createElement("div");
      card.className = "wtl-card";

      const title = document.createElement("h1");
      title.textContent = "Daily website limit reached";

      const body = document.createElement("p");
      body.id = "wtl-message";

      const secondary = document.createElement("p");
      secondary.className = "wtl-secondary";
      secondary.textContent =
        "This site will be available again tomorrow unless you change the limit.";

      const buttons = document.createElement("div");
      buttons.className = "wtl-actions";

      const five = document.createElement("button");
      five.textContent = "Allow 5 more minutes";
      five.addEventListener("click", async () => {
        await chrome.runtime.sendMessage({
          type: "WTL_GRANT_TEMP_ACCESS",
          host,
          minutes: 5
        });
        refresh();
      });

      const leave = document.createElement("button");
      leave.className = "wtl-secondary-button";
      leave.textContent = "Close this tab";
      leave.addEventListener("click", () => window.close());

      buttons.appendChild(five);
      buttons.appendChild(leave);

      card.appendChild(title);
      card.appendChild(body);
      card.appendChild(secondary);
      card.appendChild(buttons);
      overlay.appendChild(card);
      document.documentElement.appendChild(overlay);
    }

    document.documentElement.classList.add("wtl-blocked");

    const remaining = Math.max(0, status.limitSeconds - status.usedSeconds);
    const message = overlay.querySelector("#wtl-message");
    message.textContent =
      `${host}: ${formatTime(status.usedSeconds)} used today. ` +
      `Daily limit: ${formatTime(status.limitSeconds)}. ` +
      `Remaining: ${formatTime(remaining)}.`;
  }

  async function refresh() {
    try {
      const status = await chrome.runtime.sendMessage({
        type: "WTL_GET_STATUS",
        host
      });

      if (!status?.tracked) {
        removeOverlay();
        return;
      }

      showOverlay(status);
    } catch {
      removeOverlay();
    }
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "WTL_REFRESH_BLOCK") {
      refresh();
    }
  });

  window.addEventListener("focus", () => {
    chrome.runtime.sendMessage({ type: "WTL_FORCE_REFRESH_TRACKER" }).catch(() => {});
    refresh();
  });

  document.addEventListener("visibilitychange", () => {
    chrome.runtime.sendMessage({ type: "WTL_FORCE_REFRESH_TRACKER" }).catch(() => {});
    refresh();
  });

  refresh();
  setInterval(refresh, 15000);
})();
