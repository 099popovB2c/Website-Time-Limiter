(() => {
  const $ = id => document.getElementById(id);

  function setStatus(text) {
    const node = $("status");
    if (node) node.textContent = text;
  }

  $("exportRules")?.addEventListener("click", async () => {
    const stored = await chrome.storage.sync.get({ enabled: true, rules: [] });
    const payload = {
      app: "Website Time Limiter",
      version: 1,
      exportedAt: new Date().toISOString(),
      enabled: stored.enabled !== false,
      rules: Array.isArray(stored.rules) ? stored.rules : []
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `website-time-limiter-rules-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Exported ${payload.rules.length} rule(s).`);
  });

  $("importRulesButton")?.addEventListener("click", () => {
    $("importRulesFile")?.click();
  });

  $("importRulesFile")?.addEventListener("change", async event => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : parsed.rules;
      if (!Array.isArray(incoming)) throw new Error("No rules array found.");

      const rules = incoming
        .filter(rule => rule && typeof rule === "object" && typeof rule.host === "string")
        .map(rule => ({
          host: String(rule.host).trim().toLowerCase().replace(/^www\./, ""),
          minutes: Math.max(1, Math.min(1440, Number(rule.minutes) || 30)),
          enabled: rule.enabled !== false,
          includeSubdomains: Boolean(rule.includeSubdomains)
        }))
        .filter(rule => rule.host);

      if (!rules.length) throw new Error("No valid rules found.");

      const replace = confirm(`Import ${rules.length} website rule(s)?\n\nOK = replace current rules\nCancel = merge`);
      if (replace) {
        await chrome.storage.sync.set({ rules });
      } else {
        const current = await chrome.storage.sync.get({ rules: [] });
        const merged = new Map((current.rules || []).map(rule => [rule.host, rule]));
        for (const rule of rules) merged.set(rule.host, rule);
        await chrome.storage.sync.set({ rules: [...merged.values()] });
      }

      setStatus(`Imported ${rules.length} rule(s). Reopen the popup to refresh the list.`);
    } catch (error) {
      setStatus(`Import failed: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  });
})();
