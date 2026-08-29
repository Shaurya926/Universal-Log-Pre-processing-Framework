(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const state = {
    currentView: "overview",
    lastEventId: localStorage.getItem("ulpf:lastEventId") || "",
    lastIngestResults: null,
    quarantine: [],
    analysis: null,
  };

  function pretty(value) {
    if (typeof value === "string") return value;
    try { return JSON.stringify(value ?? {}, null, 2); }
    catch { return String(value ?? ""); }
  }

  function first(obj, keys, fallback = undefined) {
    for (const key of keys) {
      if (obj && obj[key] !== undefined && obj[key] !== null) return obj[key];
    }
    return fallback;
  }

  function nested(obj, path, fallback = undefined) {
    try {
      const value = path.split(".").reduce((acc, key) => acc?.[key], obj);
      return value === undefined || value === null ? fallback : value;
    } catch { return fallback; }
  }

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function busy(button, yes, label = "Working…") {
    if (!button) return;
    if (yes) {
      button.dataset.originalLabel = button.innerHTML;
      button.innerHTML = label;
      button.disabled = true;
    } else {
      button.innerHTML = button.dataset.originalLabel || button.innerHTML;
      button.disabled = false;
    }
  }

  function showConnectionError(error) {
    const box = $("connectionError");
    if (!box) return;
    box.hidden = false;
    console.error(error);
  }

  function clearConnectionError() {
    const box = $("connectionError");
    if (box) box.hidden = true;
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...(options.headers || {}) },
    });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const payload = await response.json();
        detail = payload.detail || detail;
      } catch { /* no-op */ }
      throw new Error(detail);
    }
    clearConnectionError();
    const contentType = response.headers.get("content-type") || "";
    return contentType.includes("application/json") ? response.json() : response.text();
  }

  function setView(name, { updateHash = true } = {}) {
    if (!$("view-" + name)) name = "overview";
    state.currentView = name;
    $$(".view").forEach((view) => view.classList.toggle("is-visible", view.id === `view-${name}`));
    $$(".nav-item").forEach((item) => item.classList.toggle("is-active", item.dataset.view === name));
    $("sidebar")?.classList.remove("is-open");
    if (updateHash && location.hash !== `#${name}`) history.replaceState(null, "", `#${name}`);
    window.scrollTo({ top: 0, behavior: "instant" });
    loadView(name);
  }

  async function loadView(name) {
    try {
      if (name === "overview") await loadOverview();
      else if (name === "explorer") await loadEvents();
      else if (name === "inspector" && state.lastEventId) await loadInspector(state.lastEventId);
      else if (name === "registry") await loadRegistry();
      else if (name === "onboarding") await Promise.all([loadQuarantine(), loadDrafts()]);
    } catch (error) { showConnectionError(error); }
  }

  function distributionEntries(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value.map((item) => {
        if (typeof item === "string") return [item, 1];
        return [first(item, ["name", "vendor", "action", "key", "label"], "Other"), Number(first(item, ["count", "value", "events"], 0))];
      });
    }
    return Object.entries(value).map(([key, count]) => [key, Number(count || 0)]);
  }

  function renderDistribution(target, value) {
    const node = $(target);
    if (!node) return;
    const entries = distributionEntries(value).sort((a, b) => b[1] - a[1]);
    const max = Math.max(...entries.map(([, count]) => count), 1);
    if (!entries.length) {
      node.innerHTML = '<div class="queue-empty">No distribution has been recorded yet.</div>';
      return;
    }
    node.innerHTML = entries.slice(0, 8).map(([name, count]) => `
      <div class="dist-row">
        <span class="dist-name" title="${esc(name)}">${esc(name)}</span>
        <span class="dist-track"><span class="dist-fill" style="width:${Math.max(4, (count / max) * 100)}%"></span></span>
        <span class="dist-value">${count}</span>
      </div>`).join("");
  }

  async function loadOverview() {
    const data = await api("/api/v1/overview");
    const total = first(data, ["total_events", "total_raw_events", "raw_events", "events", "event_count"], 0);
    const parsed = first(data, ["parsed_events", "stored_events", "normalized_events", "normalized", "success_count"], 0);
    const unknown = first(data, ["unknown_events", "failed_events", "quarantine_count", "quarantined", "failures"], 0);
    const plugins = first(data, ["active_plugins", "plugin_count", "plugins"], 0);
    $("metricTotal").textContent = Number(total).toLocaleString();
    $("metricParsed").textContent = Number(parsed).toLocaleString();
    $("metricUnknown").textContent = Number(unknown).toLocaleString();
    $("metricPlugins").textContent = Number(plugins).toLocaleString();
    $("metricTotalFoot").textContent = total ? "Raw evidence retained before translation" : "Waiting for the first event";

    renderDistribution("vendorDistribution", first(data, ["vendor_distribution", "vendors", "by_vendor"], {}));
    renderDistribution("actionDistribution", first(data, ["action_distribution", "actions", "by_action"], {}));

    const published = data.published_benchmark || {};
    const throughput = first(data, ["events_per_sec", "throughput", "last_events_per_sec", "last_ingestion_events_per_sec"], published.events_per_sec);
    $("throughputValue").textContent = throughput == null ? "—" : Number(throughput).toLocaleString(undefined, { maximumFractionDigits: 1 });
    $("throughputCaption").textContent = first(data, ["throughput_label"], published.label || "Last measured local ingestion rate; not a production-scale claim.");
  }

  function setIngestMode(mode) {
    $$("[data-ingest-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.ingestMode === mode));
    $$("[data-ingest-pane]").forEach((pane) => pane.classList.toggle("is-visible", pane.dataset.ingestPane === mode));
  }

  function showIngestResult(result) {
    state.lastIngestResults = result;
    $("ingestResult").hidden = false;
    $("ingestResultCode").textContent = pretty(result);
    $("ingestResult").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function processPaste() {
    const payload = $("pastePayload").value.trim();
    if (!payload) return;
    const button = $("processPaste");
    busy(button, true, "Processing…");
    try {
      const result = await api("/api/v1/ingest/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }) });
      showIngestResult(result);
      const eventId = first(result, ["event_id"], nested(result, "event.event_id"));
      if (eventId) rememberEvent(eventId);
    } catch (error) { showConnectionError(error); }
    finally { busy(button, false); }
  }

  async function processBatch() {
    const payloads = $("batchPayload").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!payloads.length) return;
    const button = $("processBatch");
    busy(button, true, `Processing ${payloads.length}…`);
    try {
      const result = await api("/api/v1/ingest/batch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payloads }) });
      showIngestResult(result);
      const firstEvent = Array.isArray(result) ? result.find((item) => item?.event_id) : null;
      if (firstEvent?.event_id) rememberEvent(firstEvent.event_id);
    } catch (error) { showConnectionError(error); }
    finally { busy(button, false); }
  }

  async function processFile() {
    const file = $("fileInput").files?.[0];
    if (!file) return;
    const button = $("processFile");
    busy(button, true, "Reading file…");
    try {
      const body = await file.text();
      const result = await api(`/api/v1/ingest/file?split_lines=${$("splitLines").checked ? "true" : "false"}`, { method: "POST", body });
      showIngestResult(result);
      const firstEvent = Array.isArray(result) ? result.find((item) => item?.event_id) : null;
      if (firstEvent?.event_id) rememberEvent(firstEvent.event_id);
    } catch (error) { showConnectionError(error); }
    finally { busy(button, false); }
  }

  async function loadDemo(id, target, mode) {
    try {
      const data = await api(`/api/v1/demo/datasets/${encodeURIComponent(id)}`);
      $(target).value = data.payload || (data.events || []).join("\n");
      if (mode) setIngestMode(mode);
    } catch (error) { showConnectionError(error); }
  }

  function eventValue(event, paths, fallback = "—") {
    for (const path of paths) {
      const value = path.includes(".") ? nested(event, path) : event?.[path];
      if (value !== undefined && value !== null && value !== "") return value;
    }
    return fallback;
  }

  async function loadEvents() {
    const params = new URLSearchParams({ limit: "250" });
    const map = [
      ["search", $("filterSearch")?.value],
      ["action", $("filterAction")?.value],
      ["vendor", $("filterVendor")?.value],
      ["protocol", $("filterProtocol")?.value],
    ];
    for (const [key, value] of map) if (value?.trim()) params.set(key, value.trim());
    const events = await api(`/api/v1/events?${params.toString()}`);
    renderEvents(Array.isArray(events) ? events : []);
  }

  function renderEvents(events) {
    $("eventCount").textContent = `${events.length.toLocaleString()} event${events.length === 1 ? "" : "s"}`;
    $("eventEmpty").hidden = events.length > 0;
    $("eventRows").innerHTML = events.map((event) => {
      const id = eventValue(event, ["event_id", "id"], "");
      const vendor = eventValue(event, ["observer.vendor", "vendor"]);
      const product = eventValue(event, ["observer.product", "product"], "");
      const sourceIp = eventValue(event, ["source.ip", "source_ip"]);
      const sourcePort = eventValue(event, ["source.port", "source_port"], "");
      const destIp = eventValue(event, ["destination.ip", "destination_ip"]);
      const destPort = eventValue(event, ["destination.port", "destination_port"], "");
      const protocol = eventValue(event, ["network.transport", "protocol"]);
      const action = String(eventValue(event, ["event.action", "action"], "—")).toUpperCase();
      const category = eventValue(event, ["event.category", "category"]);
      const timestamp = eventValue(event, ["@timestamp", "timestamp", "created_at"]);
      const actionClass = action === "ALLOW" ? "action-chip--allow" : action === "DENY" ? "action-chip--deny" : "";
      return `<tr data-event-id="${esc(id)}">
        <td title="${esc(timestamp)}">${esc(String(timestamp).replace("T", " ").replace("Z", ""))}</td>
        <td><span class="vendor-main">${esc(vendor)}</span><span class="vendor-sub">${esc(product)}</span></td>
        <td>${esc(sourceIp)}${sourcePort !== "" ? `:${esc(sourcePort)}` : ""}</td>
        <td>${esc(destIp)}${destPort !== "" ? `:${esc(destPort)}` : ""}</td>
        <td>${esc(protocol)}</td>
        <td><span class="action-chip ${actionClass}">${esc(action)}</span></td>
        <td>${esc(category)}</td>
      </tr>`;
    }).join("");
    $$("#eventRows tr").forEach((row) => row.addEventListener("click", () => {
      const id = row.dataset.eventId;
      if (!id) return;
      rememberEvent(id);
      $("inspectEventId").value = id;
      setView("inspector");
    }));
  }

  function rememberEvent(id) {
    state.lastEventId = id;
    localStorage.setItem("ulpf:lastEventId", id);
    if ($("inspectEventId")) $("inspectEventId").value = id;
  }

  function rawPayloadFromInspection(data) {
    const raw = first(data, ["raw", "raw_event", "original"], {});
    if (typeof raw === "string") return raw;
    return first(raw, ["payload", "event", "raw", "message"], raw);
  }

  function traceEntries(data) {
    const trace = first(data, ["field_trace", "trace", "provenance_trace"], nested(data, "provenance.field_trace", {}));
    if (Array.isArray(trace)) return trace.map((item) => [first(item, ["source_field", "from", "source"], "source"), first(item, ["target_field", "to", "target"], "target")]);
    if (trace && typeof trace === "object") {
      return Object.entries(trace).map(([target, info]) => {
        if (typeof info === "string") return [info, target];
        return [first(info, ["source_field", "from", "source"], "source"), target];
      });
    }
    return [];
  }

  async function loadInspector(eventId) {
    if (!eventId) return;
    $("inspectEventId").value = eventId;
    const data = await api(`/api/v1/events/${encodeURIComponent(eventId)}/inspect`);
    rememberEvent(eventId);
    $("inspectorEmpty").hidden = true;
    $("inspectorContent").hidden = false;

    const raw = rawPayloadFromInspection(data);
    const parsed = first(data, ["parsed", "source_fields", "parsed_event"], {});
    const normalized = first(data, ["normalized", "event", "normalized_event"], data);
    $("rawView").textContent = pretty(raw);
    $("parsedView").textContent = pretty(parsed);
    $("normalizedView").textContent = pretty(normalized);

    const rawId = first(first(data, ["raw", "raw_event"], {}), ["event_id", "raw_event_id", "id"], nested(normalized, "raw.event_id", "—"));
    const parserId = nested(normalized, "provenance.parser_id", first(data, ["parser_id"], "—"));
    const parserVersion = nested(normalized, "provenance.parser_version", first(data, ["parser_version"], "—"));
    const mappingVersion = nested(normalized, "provenance.mapping_version", first(data, ["mapping_version"], "—"));
    const hash = first(first(data, ["raw", "raw_event"], {}), ["sha256", "hash"], nested(normalized, "raw.sha256", ""));
    $("inspectionMeta").innerHTML = [
      ["event", eventId], ["raw", rawId], ["parser", `${parserId}@${parserVersion}`], ["mapping", mappingVersion], ...(hash ? [["sha256", hash]] : [])
    ].map(([label, value]) => `<span>${esc(label)} <b>${esc(value)}</b></span>`).join("");

    const entries = traceEntries(data);
    $("traceList").innerHTML = entries.length ? entries.map(([from, to]) => `<div class="trace-row"><span class="trace-from">${esc(from)}</span><span class="trace-arrow">→</span><span class="trace-to">${esc(to)}</span></div>`).join("") : '<div class="queue-empty">No field-level trace was returned for this event.</div>';
  }

  async function loadRegistry() {
    const plugins = await api("/api/v1/plugins");
    const list = Array.isArray(plugins) ? plugins : [];
    $("registryCount").textContent = `${list.length} parser${list.length === 1 ? "" : "s"}`;
    $("registryGrid").innerHTML = list.map((plugin) => {
      const id = first(plugin, ["plugin_id", "id", "name"], "plugin");
      const vendor = first(plugin, ["vendor"], "Unknown vendor");
      const product = first(plugin, ["product"], "");
      const format = first(plugin, ["format", "supported_format", "log_format"], "log");
      const version = first(plugin, ["version", "plugin_version"], "—");
      const enabled = first(plugin, ["enabled", "active"], true);
      const fixtures = first(plugin, ["fixture_count", "fixtures", "tests"], "—");
      const detection = first(plugin, ["detection_summary", "detection", "description"], "Deterministic detection rules loaded from the plugin contract.");
      return `<article class="plugin-card" data-plugin-id="${esc(id)}">
        <div class="plugin-card-head">
          <div><h3>${esc(product || id)}</h3><div class="plugin-vendor">${esc(vendor)} · ${esc(id)}</div></div>
          <button class="switch ${enabled ? "is-on" : ""}" type="button" role="switch" aria-checked="${enabled ? "true" : "false"}" aria-label="Toggle ${esc(id)}"></button>
        </div>
        <span class="plugin-format">${esc(format)}</span>
        <div class="plugin-meta"><span>version <b>${esc(version)}</b></span><span>fixtures <b>${esc(Array.isArray(fixtures) ? fixtures.length : fixtures)}</b></span></div>
        <div class="plugin-detection">${esc(typeof detection === "string" ? detection : pretty(detection))}</div>
      </article>`;
    }).join("");
    $$(".plugin-card .switch").forEach((toggle) => toggle.addEventListener("click", async () => {
      const card = toggle.closest(".plugin-card");
      const pluginId = card?.dataset.pluginId;
      if (!pluginId) return;
      const enabled = !toggle.classList.contains("is-on");
      toggle.disabled = true;
      try {
        await api(`/api/v1/plugins/${encodeURIComponent(pluginId)}/state`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled }) });
        toggle.classList.toggle("is-on", enabled);
        toggle.setAttribute("aria-checked", String(enabled));
      } catch (error) { showConnectionError(error); }
      finally { toggle.disabled = false; }
    }));
  }

  function quarantinePayload(item) {
    const raw = first(item, ["payload", "raw_payload", "message", "event"], first(item, ["raw"], ""));
    if (typeof raw === "string") return raw;
    return first(raw, ["payload", "event", "message", "raw"], "");
  }

  async function loadQuarantine() {
    const list = await api("/api/v1/quarantine?limit=100");
    state.quarantine = Array.isArray(list) ? list : [];
    $("quarantineCount").textContent = state.quarantine.length;
    if (!state.quarantine.length) {
      $("quarantineList").innerHTML = '<div class="queue-empty">Nothing is waiting here. Unknown events will appear when no deterministic parser matches.</div>';
      return;
    }
    $("quarantineList").innerHTML = state.quarantine.map((item, index) => {
      const reason = first(item, ["reason", "error", "status"], "UNKNOWN_SOURCE");
      const id = first(item, ["raw_event_id", "event_id", "id"], `unknown-${index + 1}`);
      const payload = quarantinePayload(item);
      return `<button class="queue-item" type="button" data-queue-index="${index}"><strong>${esc(payload || id)}</strong><span>${esc(reason)} · ${esc(id)}</span></button>`;
    }).join("");
    $$(".queue-item").forEach((button) => button.addEventListener("click", () => {
      $$(".queue-item").forEach((item) => item.classList.toggle("is-active", item === button));
      const item = state.quarantine[Number(button.dataset.queueIndex)];
      const payload = quarantinePayload(item);
      if (payload) $("onboardingPayload").value = payload;
    }));
  }

  function candidateFields(analysis) {
    const value = first(analysis, ["candidate_fields", "fields", "extracted_fields", "keys"], []);
    if (Array.isArray(value)) return value.map((item) => typeof item === "string" ? { name: item } : item);
    if (value && typeof value === "object") return Object.entries(value).map(([name, meta]) => ({ name, ...(typeof meta === "object" ? meta : { value: meta }) }));
    return [];
  }

  function renderAnalysis(analysis) {
    state.analysis = analysis;
    const fields = candidateFields(analysis);
    $("analysisStep").hidden = false;
    $("mappingStep").hidden = false;
    $("analysisOutput").innerHTML = fields.length ? fields.map((field) => `<span class="candidate-chip">${esc(first(field, ["name", "field", "key"], "field"))}</span>`).join("") : `<pre>${esc(pretty(analysis))}</pre>`;
    $("mappingEditor").innerHTML = fields.length ? fields.map((field, index) => {
      const name = first(field, ["name", "field", "key"], `field_${index + 1}`);
      const suggestion = first(field, ["suggested_target", "target", "mapping", "universal_field"], "");
      return `<label class="mapping-row"><span class="mapping-source" title="${esc(name)}">${esc(name)}</span><span>→</span><input data-source-field="${esc(name)}" value="${esc(suggestion)}" placeholder="universal field, e.g. source.ip" /></label>`;
    }).join("") : '<div class="queue-empty">No candidate field list was returned. You can still inspect the analysis above.</div>';
  }

  async function analyzeUnknown() {
    const payload = $("onboardingPayload").value.trim();
    if (!payload) return;
    const button = $("analyzeUnknown");
    busy(button, true, "Analyzing…");
    try {
      const analysis = await api("/api/v1/onboarding/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payload }) });
      renderAnalysis(analysis);
      $("analysisStep").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) { showConnectionError(error); }
    finally { busy(button, false); }
  }

  function mappingsFromEditor() {
    const mappings = {};
    $$("#mappingEditor input[data-source-field]").forEach((input) => {
      const target = input.value.trim();
      if (target) mappings[input.dataset.sourceField] = target;
    });
    return mappings;
  }

  function onboardingBody() {
    return {
      payload: $("onboardingPayload").value.trim(),
      mappings: mappingsFromEditor(),
      vendor: $("draftVendor").value.trim() || "Unknown",
      product: $("draftProduct").value.trim() || "Unknown",
      plugin_id: ($("draftPluginId").value.trim() || "draft_plugin").replace(/[^A-Za-z0-9_-]/g, "_"),
    };
  }

  async function previewMapping() {
    const button = $("previewMapping");
    busy(button, true, "Previewing…");
    try {
      const result = await api("/api/v1/onboarding/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(onboardingBody()) });
      $("previewStep").hidden = false;
      $("onboardingPreview").textContent = pretty(result);
      $("previewStep").scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (error) { showConnectionError(error); }
    finally { busy(button, false); }
  }

  async function saveDraft() {
    const button = $("saveDraft");
    busy(button, true, "Saving draft…");
    try {
      const result = await api("/api/v1/onboarding/drafts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(onboardingBody()) });
      $("previewStep").hidden = false;
      $("onboardingPreview").textContent = pretty(result);
      await loadDrafts();
    } catch (error) { showConnectionError(error); }
    finally { busy(button, false); }
  }

  async function loadDrafts() {
    try {
      const drafts = await api("/api/v1/onboarding/drafts?limit=50");
      const list = Array.isArray(drafts) ? drafts : [];
      $("draftList").innerHTML = list.length ? list.slice(0, 12).map((draft) => {
        const id = first(draft, ["plugin_id", "draft_id", "id"], "draft");
        const status = first(draft, ["status"], "review required");
        return `<span class="draft-pill">${esc(id)} · ${esc(status)}</span>`;
      }).join("") : '<span class="queue-empty">No parser drafts yet.</span>';
    } catch (error) { showConnectionError(error); }
  }

  function bind() {
    $$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
    $$("[data-jump]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.jump)));
    $$("[data-ingest-mode]").forEach((button) => button.addEventListener("click", () => setIngestMode(button.dataset.ingestMode)));

    $("menuButton")?.addEventListener("click", () => $("sidebar")?.classList.toggle("is-open"));
    $("dismissConnectionError")?.addEventListener("click", clearConnectionError);
    $("processPaste")?.addEventListener("click", processPaste);
    $("processBatch")?.addEventListener("click", processBatch);
    $("processFile")?.addEventListener("click", processFile);
    $("loadMixedSample")?.addEventListener("click", () => loadDemo("mixed", "batchPayload", "batch"));
    $("loadUnknownSamplePaste")?.addEventListener("click", () => loadDemo("unknown", "pastePayload", "paste"));
    $("loadUnknownSampleOnboarding")?.addEventListener("click", () => loadDemo("unknown", "onboardingPayload"));
    $("fileInput")?.addEventListener("change", () => { const file = $("fileInput").files?.[0]; $("fileName").textContent = file ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB` : "Text-based logs work best for this prototype."; });
    $("openResultInExplorer")?.addEventListener("click", () => setView("explorer"));

    $("applyFilters")?.addEventListener("click", () => loadEvents().catch(showConnectionError));
    $("clearFilters")?.addEventListener("click", () => {
      ["filterSearch", "filterVendor", "filterProtocol"].forEach((id) => { if ($(id)) $(id).value = ""; });
      $("filterAction").value = "";
      loadEvents().catch(showConnectionError);
    });
    $("filterSearch")?.addEventListener("keydown", (event) => { if (event.key === "Enter") loadEvents().catch(showConnectionError); });
    $("exportNdjson")?.addEventListener("click", () => { window.location.href = "/api/v1/export/ndjson?limit=10000"; });

    $("openEventButton")?.addEventListener("click", () => {
      const id = $("inspectEventId").value.trim();
      if (id) loadInspector(id).catch(showConnectionError);
    });
    $("inspectEventId")?.addEventListener("keydown", (event) => { if (event.key === "Enter") $("openEventButton").click(); });

    $("analyzeUnknown")?.addEventListener("click", analyzeUnknown);
    $("previewMapping")?.addEventListener("click", previewMapping);
    $("saveDraft")?.addEventListener("click", saveDraft);

    window.addEventListener("hashchange", () => setView(location.hash.slice(1) || "overview", { updateHash: false }));
  }

  document.addEventListener("DOMContentLoaded", () => {
    bind();
    if (state.lastEventId) $("inspectEventId").value = state.lastEventId;
    const initial = location.hash.slice(1) || "overview";
    setView(initial, { updateHash: false });
  });
})();
