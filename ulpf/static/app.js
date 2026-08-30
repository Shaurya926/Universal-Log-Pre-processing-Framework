/* ============================================================
   ULPF FRONTEND REDESIGN
   ------------------------------------------------------------
   This file keeps UI changes separate from backend behavior.
   Update API_BASE only if your backend is hosted elsewhere.
============================================================ */

const API_BASE = window.ULPF_API_BASE || "";

const $ = (id) => document.getElementById(id);

const state = {
  currentScreen: "overview",
  ingestMode: "paste",
  registryPlugins: [],
  registryIndex: 0,
  events: [],
  inspection: null,
};

const screenGroups = {
  overview: "overview",
  ingestion: "work",
  explorer: "investigate",
  inspector: "investigate",
  registry: "extend",
  onboarding: "extend",
  normalization: "extend",
};


/* ============================================================
   HELPERS
============================================================ */

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function pretty(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? "");
  }
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  if (Array.isArray(value?.events)) return value.events;
  if (Array.isArray(value?.plugins)) return value.plugins;
  if (Array.isArray(value?.results)) return value.results;
  return [];
}

async function api(path, options = {}) {
  const init = {
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  };

  const response = await fetch(`${API_BASE}${path}`, init);

  let payload = null;
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    payload = await response.json().catch(() => null);
  } else {
    payload = await response.text().catch(() => "");
  }

  if (!response.ok) {
    const message =
      payload?.detail ||
      payload?.message ||
      payload?.error ||
      (typeof payload === "string" && payload) ||
      `${response.status} ${response.statusText}`;

    throw new Error(message);
  }

  return payload;
}

let toastTimer = null;

function toast(message, isError = false) {
  const el = $("toast");
  if (!el) return;

  el.textContent = message;
  el.classList.toggle("error", Boolean(isError));
  el.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 3600);
}


/* ============================================================
   NAVIGATION
============================================================ */

function closeAllMenus() {
  document.querySelectorAll(".nav-dropdown").forEach((menu) => {
    menu.classList.remove("open");

    const button = menu.querySelector(".nav-parent");
    button?.setAttribute("aria-expanded", "false");
  });
}

function switchScreen(name) {
  const target = $(`screen-${name}`);
  if (!target) return;

  state.currentScreen = name;

  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen === target);
  });

  document.querySelectorAll(".nav-bubble").forEach((button) => {
    button.classList.remove("active");
  });

  const root = screenGroups[name];
  const activeRoot = document.querySelector(`[data-nav-root="${root}"]`);
  activeRoot?.classList.add("active");

  closeAllMenus();

  if (name === "explorer") loadEvents();
  if (name === "registry") loadRegistry();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

document.querySelectorAll("[data-screen]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    switchScreen(button.dataset.screen);
  });
});

document.querySelectorAll(".nav-parent").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.stopPropagation();

    const menu = button.closest(".nav-dropdown");
    const willOpen = !menu.classList.contains("open");

    closeAllMenus();

    if (willOpen) {
      menu.classList.add("open");
      button.setAttribute("aria-expanded", "true");
    }
  });
});

document.addEventListener("click", closeAllMenus);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllMenus();
});


/* ============================================================
   INGESTION TABS
============================================================ */

document.querySelectorAll(".ingestion-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    state.ingestMode = tab.dataset.ingestMode;

    document.querySelectorAll(".ingestion-tab").forEach((item) => {
      item.classList.toggle("active", item === tab);
    });

    document.querySelectorAll(".ingestion-mode").forEach((panel) => {
      panel.classList.toggle(
        "active",
        panel.dataset.modePanel === state.ingestMode
      );
    });
  });
});


/* ============================================================
   INGESTION
   Endpoint assumptions:
   POST /api/v1/ingest/paste
   POST /api/v1/ingest/batch
   POST /api/v1/ingest/file
============================================================ */

function renderIngestResults(data) {
  const host = $("processing-results");
  if (!host) return;

  const rows =
    asArray(data).length
      ? asArray(data)
      : [data];

  host.classList.remove("empty-result");

  host.innerHTML = rows
    .filter(Boolean)
    .map((item, index) => {
      const eventId = firstDefined(
        item.event_id,
        item.id,
        item.event?.id,
        item.normalized?.event?.id,
        "—"
      );

      const parserId = firstDefined(
        item.plugin_id,
        item.parser_id,
        item.parser?.id,
        item.provenance?.parser_id,
        item.normalized?.provenance?.parser_id,
        "unknown"
      );

      const normalized = firstDefined(
        item.normalized,
        item.event,
        item.output,
        item
      );

      return `
        <article class="result-card">
          <div class="result-card-top">
            <strong>Event ${index + 1}</strong>
            <code>${esc(parserId)} · ${esc(eventId)}</code>
          </div>
          <pre>${esc(pretty(normalized))}</pre>
        </article>
      `;
    })
    .join("");

  const count = rows.filter(Boolean).length;
  $("batch-summary").textContent = `${count} result${count === 1 ? "" : "s"}`;
}

async function processPaste() {
  const payload = $("ingest-text").value.trim();

  if (!payload) {
    toast("Paste a raw event first.", true);
    return;
  }

  const data = await api("/api/v1/ingest/paste", {
    method: "POST",
    body: JSON.stringify({ payload }),
  });

  renderIngestResults(data);
  toast("Event processed.");
}

async function processBatch() {
  const raw = $("batch-text").value.trim();

  if (!raw) {
    toast("Paste a batch first.", true);
    return;
  }

  const events = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const data = await api("/api/v1/ingest/batch", {
    method: "POST",
    body: JSON.stringify({ events }),
  });

  renderIngestResults(data);
  toast(`${events.length} event${events.length === 1 ? "" : "s"} submitted.`);
}

async function processFile() {
  const file = $("file-input").files?.[0];

  if (!file) {
    toast("Choose a local log file first.", true);
    return;
  }

  const formData = new FormData();
  formData.append("file", file);

  const data = await api("/api/v1/ingest/file", {
    method: "POST",
    body: formData,
  });

  renderIngestResults(data);
  toast(`${file.name} processed.`);
}

$("process-event")?.addEventListener("click", async () => {
  const button = $("process-event");
  button.disabled = true;

  try {
    if (state.ingestMode === "paste") await processPaste();
    if (state.ingestMode === "batch") await processBatch();
    if (state.ingestMode === "file") await processFile();
  } catch (error) {
    toast(`Processing failed: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
});


/* ============================================================
   UNKNOWN SAMPLE
   Tries demo endpoint first. If unavailable, uses a local sample
   so the UI remains usable while backend work is incomplete.
============================================================ */

const FALLBACK_UNKNOWN_SAMPLE =
  'timestamp=2026-08-30T14:30:00+05:30 sensor="EDGE-X" source=10.20.1.15 target=172.16.4.9 verdict="pass" proto=tcp sport=53001 dport=443';

$("load-unknown-sample")?.addEventListener("click", async () => {
  let sample = FALLBACK_UNKNOWN_SAMPLE;

  try {
    const data = await api("/api/v1/demo/datasets/unknown");

    sample = firstDefined(
      data?.events?.[0],
      data?.payload,
      data?.sample,
      typeof data === "string" ? data : null,
      FALLBACK_UNKNOWN_SAMPLE
    );
  } catch {
    // Deliberately silent: local fallback keeps the demo usable.
  }

  $("ingest-text").value = sample;

  const pasteTab = document.querySelector('[data-ingest-mode="paste"]');
  pasteTab?.click();

  toast("Unknown sample loaded.");
});


/* ============================================================
   EVENT EXPLORER
   GET /api/v1/events
============================================================ */

function normalizeEventForList(item) {
  return {
    id: firstDefined(item.event_id, item.id, item.event?.id, "—"),
    parser: firstDefined(
      item.plugin_id,
      item.parser_id,
      item.parser?.id,
      item.provenance?.parser_id,
      item.normalized?.provenance?.parser_id,
      "unknown"
    ),
    action: firstDefined(
      item.action,
      item.event?.action,
      item.normalized?.event?.action,
      "—"
    ),
    sourceIp: firstDefined(
      item.source_ip,
      item.source?.ip,
      item.normalized?.source?.ip,
      "—"
    ),
    raw: item,
  };
}

function renderEvents() {
  const host = $("event-list");
  if (!host) return;

  const query = $("event-search")?.value.trim().toLowerCase() || "";

  const filtered = state.events.filter((event) => {
    const haystack = [
      event.id,
      event.parser,
      event.action,
      event.sourceIp,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  });

  if (!filtered.length) {
    host.innerHTML = `
      <div class="event-empty">
        ${query ? "No matching events." : "No processed events found."}
      </div>
    `;
    return;
  }

  host.innerHTML = filtered
    .map(
      (event) => `
        <button class="event-row" type="button" data-event-id="${esc(event.id)}">
          <code>${esc(event.id)}</code>
          <span>${esc(event.parser)}</span>
          <small>${esc(event.sourceIp)} · ${esc(event.action)}</small>
          <span class="event-open-mark">↗</span>
        </button>
      `
    )
    .join("");

  host.querySelectorAll("[data-event-id]").forEach((row) => {
    row.addEventListener("click", () => {
      openInspector(row.dataset.eventId);
    });
  });
}

async function loadEvents() {
  try {
    const data = await api("/api/v1/events");
    state.events = asArray(data).map(normalizeEventForList);
    renderEvents();
  } catch (error) {
    $("event-list").innerHTML = `
      <div class="event-empty">
        Event API unavailable. The interface is ready; connect the backend to load data.
      </div>
    `;
    toast(`Events unavailable: ${error.message}`, true);
  }
}

$("refresh-events")?.addEventListener("click", loadEvents);
$("event-search")?.addEventListener("input", renderEvents);


/* ============================================================
   EVENT INSPECTOR
   GET /api/v1/events/{event_id}/inspect
============================================================ */

document.querySelectorAll(".inspector-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    const name = tab.dataset.inspectorTab;

    document.querySelectorAll(".inspector-tab").forEach((item) => {
      item.classList.toggle("active", item === tab);
    });

    document.querySelectorAll(".inspector-pane").forEach((pane) => {
      pane.classList.toggle(
        "active",
        pane.dataset.inspectorPane === name
      );
    });
  });
});

function getTraceEntries(data) {
  const trace = firstDefined(
    data?.field_trace,
    data?.provenance?.field_trace,
    data?.normalized?.provenance?.field_trace,
    {}
  );

  if (Array.isArray(trace)) {
    return trace.map((row, index) => [
      firstDefined(row.target, row.normalized_field, `field_${index}`),
      row,
    ]);
  }

  return Object.entries(trace || {});
}

function renderInspector(data) {
  state.inspection = data;

  $("inspector-empty").hidden = true;
  $("inspector-workspace").hidden = false;

  const normalized = firstDefined(data.normalized, data.event, {});
  const parsed = firstDefined(data.parsed, data.source_fields, {});
  const raw = firstDefined(data.raw, {});
  const rawPayload = firstDefined(
    raw?.payload,
    data.raw_payload,
    data.payload,
    typeof raw === "string" ? raw : null,
    ""
  );

  const parserId = firstDefined(
    data.plugin_id,
    data.parser_id,
    data.parser?.id,
    normalized?.provenance?.parser_id,
    "unknown"
  );

  const parserVersion = firstDefined(
    data.parser_version,
    data.parser?.version,
    normalized?.provenance?.parser_version,
    "—"
  );

  const eventId = firstDefined(
    data.event_id,
    data.id,
    normalized?.event?.id,
    "—"
  );

  const rawEventId = firstDefined(
    data.raw_event_id,
    raw?.id,
    "—"
  );

  const action = firstDefined(
    normalized?.event?.action,
    data.action,
    ""
  );

  const vendor = firstDefined(
    normalized?.observer?.vendor,
    data.vendor,
    ""
  );

  $("inspect-title").textContent =
    [vendor, action, "event"].filter(Boolean).join(" ") || "Event";

  $("inspect-subtitle").textContent =
    `${parserId} ${parserVersion !== "—" ? `· v${parserVersion}` : ""}`.trim();

  $("inspect-event-id").textContent = `event_id: ${eventId}`;
  $("inspect-raw-id").textContent = `raw_event_id: ${rawEventId}`;

  const hash = firstDefined(
    raw?.sha256,
    data.raw_sha256,
    data.sha256,
    "—"
  );

  $("raw-hash").textContent =
    hash === "—" ? "SHA-256 —" : `SHA-256 ${String(hash).slice(0, 16)}…`;

  $("parsed-plugin").textContent = `parser ${parserId}`;

  const validation = firstDefined(
    data.validation?.status,
    data.validation_status,
    normalized?.validation?.status,
    "—"
  );

  $("validation-status").textContent = `validation ${validation}`;

  $("raw-view").textContent = rawPayload;
  $("parsed-view").textContent = pretty(parsed);
  $("normalized-view").textContent = pretty(normalized);

  const extensions = firstDefined(
    data.extensions,
    normalized?.extensions,
    {}
  );

  $("extensions-view").textContent = pretty(extensions);

  const entries = getTraceEntries(data);

  $("trace-body").innerHTML = entries.length
    ? entries
        .map(([target, value]) => {
          const source = Array.isArray(value?.source_field)
            ? value.source_field.join(", ")
            : firstDefined(
                value?.source_field,
                value?.source,
                value?.from,
                value?.default ? "default" : "—"
              );

          const transform = firstDefined(
            value?.transform,
            value?.cast,
            value?.operation,
            value?.default ? "default" : "direct"
          );

          return `
            <div class="provenance-row">
              <div>
                <span>SOURCE</span>
                <strong>${esc(source)}</strong>
              </div>

              <div class="trace-arrow">→</div>

              <div>
                <span>NORMALIZED</span>
                <strong>${esc(target)}</strong>
              </div>

              <small>${esc(transform)}</small>
            </div>
          `;
        })
        .join("")
    : `
      <div class="event-empty">
        No field-level provenance was returned for this event.
      </div>
    `;

  const rawTab = document.querySelector('[data-inspector-tab="raw"]');
  rawTab?.click();

  switchScreen("inspector");
}

async function openInspector(eventId) {
  if (!eventId) return;

  try {
    const data = await api(
      `/api/v1/events/${encodeURIComponent(eventId)}/inspect`
    );

    renderInspector(data);
  } catch (error) {
    switchScreen("inspector");
    toast(`Inspector unavailable: ${error.message}`, true);
  }
}

$("manual-open-event")?.addEventListener("click", () => {
  const id = $("manual-event-id").value.trim();

  if (!id) {
    toast("Enter an Event ID.", true);
    return;
  }

  openInspector(id);
});

$("manual-event-id")?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    $("manual-open-event")?.click();
  }
});

$("go-explorer")?.addEventListener("click", () => {
  switchScreen("explorer");
});


/* ============================================================
   PARSER REGISTRY
   GET   /api/v1/plugins
   PATCH /api/v1/plugins/{plugin_id}/state
============================================================ */

const FALLBACK_PLUGINS = [
  {
    id: "cef",
    vendor: "CEF",
    format: "cef",
    product: "Common Event Format",
    version: "1.0.0",
    fixture_count: 3,
    detection_summary: "all_contains:1, all_regex:1",
    contract_status: "ready",
    enabled: true,
  },
  {
    id: "fortigate",
    vendor: "Fortinet",
    format: "key=value",
    product: "FortiGate Traffic",
    version: "1.0.0",
    fixture_count: 4,
    detection_summary: "contains:devname, logid",
    contract_status: "ready",
    enabled: true,
  },
  {
    id: "syslog",
    vendor: "RFC",
    format: "syslog",
    product: "Syslog",
    version: "1.0.0",
    fixture_count: 3,
    detection_summary: "priority + header",
    contract_status: "ready",
    enabled: true,
  },
  {
    id: "leef",
    vendor: "LEEF",
    format: "leef",
    product: "Log Event Extended Format",
    version: "1.0.0",
    fixture_count: 2,
    detection_summary: "prefix:LEEF",
    contract_status: "ready",
    enabled: true,
  },
  {
    id: "json",
    vendor: "Generic",
    format: "json",
    product: "Structured JSON",
    version: "1.0.0",
    fixture_count: 3,
    detection_summary: "valid_object:1",
    contract_status: "ready",
    enabled: true,
  },
];

function normalizePlugin(plugin) {
  return {
    id: firstDefined(plugin.id, plugin.plugin_id, plugin.slug, "unknown"),
    vendor: firstDefined(plugin.vendor, plugin.manifest?.vendor, "Unknown"),
    format: firstDefined(plugin.format, plugin.manifest?.format, "log"),
    product: firstDefined(
      plugin.product,
      plugin.name,
      plugin.manifest?.product,
      plugin.id,
      "Parser"
    ),
    version: firstDefined(plugin.version, plugin.manifest?.version, "—"),
    fixture_count: firstDefined(
      plugin.fixture_count,
      plugin.fixtures,
      plugin.manifest?.fixture_count,
      0
    ),
    detection_summary: firstDefined(
      plugin.detection_summary,
      plugin.detection,
      plugin.manifest?.detection_summary,
      "—"
    ),
    contract_status: firstDefined(
      plugin.contract_status,
      plugin.status,
      plugin.manifest?.contract_status,
      "—"
    ),
    enabled: plugin.enabled !== false,
  };
}

function renderRegistry() {
  const track = $("registry-track");
  const indicators = $("registry-indicators");

  if (!track || !indicators) return;

  if (!state.registryPlugins.length) {
    track.innerHTML = `
      <article class="registry-card">
        <span class="registry-format">NO PARSERS</span>
        <h2>Registry is empty</h2>
      </article>
    `;
    indicators.innerHTML = "";
    return;
  }

  track.innerHTML = state.registryPlugins
    .map(
      (plugin) => `
        <article class="registry-card">
          <div class="registry-card-top">
            <div>
              <span class="registry-format">
                ${esc(plugin.vendor)} · ${esc(plugin.format)}
              </span>

              <h2>${esc(plugin.product)}</h2>
            </div>

            <button
              class="toggle ${plugin.enabled ? "on" : ""}"
              type="button"
              data-plugin="${esc(plugin.id)}"
              data-enabled="${plugin.enabled}"
              aria-label="${plugin.enabled ? "Disable" : "Enable"} parser ${esc(plugin.id)}"
            ></button>
          </div>

          <span class="registry-plugin-id">${esc(plugin.id)}</span>

          <div class="registry-meta">
            <div class="registry-meta-item">
              <span>Version</span>
              <strong>${esc(plugin.version)}</strong>
            </div>

            <div class="registry-meta-item">
              <span>Fixtures</span>
              <strong>${esc(plugin.fixture_count)}</strong>
            </div>

            <div class="registry-meta-item">
              <span>Detection</span>
              <strong>${esc(plugin.detection_summary)}</strong>
            </div>

            <div class="registry-meta-item">
              <span>Contract</span>
              <strong>${esc(plugin.contract_status)}</strong>
            </div>
          </div>
        </article>
      `
    )
    .join("");

  indicators.innerHTML = state.registryPlugins
    .map(
      (_, index) => `
        <button
          class="registry-indicator ${index === state.registryIndex ? "active" : ""}"
          type="button"
          data-registry-index="${index}"
          aria-label="Show parser ${index + 1}"
        ></button>
      `
    )
    .join("");

  track.querySelectorAll(".toggle").forEach((button) => {
    button.addEventListener("click", async () => {
      const pluginId = button.dataset.plugin;
      const enabled = button.dataset.enabled !== "true";

      try {
        await api(`/api/v1/plugins/${encodeURIComponent(pluginId)}/state`, {
          method: "PATCH",
          body: JSON.stringify({ enabled }),
        });

        const plugin = state.registryPlugins.find((p) => p.id === pluginId);
        if (plugin) plugin.enabled = enabled;

        renderRegistry();
        updateRegistryPosition();
        toast(`${pluginId} ${enabled ? "enabled" : "disabled"}.`);
      } catch (error) {
        toast(`Parser state change failed: ${error.message}`, true);
      }
    });
  });

  indicators.querySelectorAll(".registry-indicator").forEach((button) => {
    button.addEventListener("click", () => {
      state.registryIndex = Number(button.dataset.registryIndex);
      updateRegistryPosition();
    });
  });

  updateRegistryPosition();
}

function updateRegistryPosition() {
  const count = state.registryPlugins.length;
  if (!count) return;

  state.registryIndex =
    ((state.registryIndex % count) + count) % count;

  $("registry-track").style.transform =
    `translateX(-${state.registryIndex * 100}%)`;

  document.querySelectorAll(".registry-indicator").forEach((dot, index) => {
    dot.classList.toggle("active", index === state.registryIndex);
  });
}

async function loadRegistry() {
  try {
    const data = await api("/api/v1/plugins");

    const plugins = asArray(data);
    state.registryPlugins = plugins.length
      ? plugins.map(normalizePlugin)
      : FALLBACK_PLUGINS.map(normalizePlugin);

    state.registryIndex = Math.min(
      state.registryIndex,
      Math.max(0, state.registryPlugins.length - 1)
    );

    renderRegistry();
  } catch (error) {
    // Keep the registry present for the UI demo.
    state.registryPlugins = FALLBACK_PLUGINS.map(normalizePlugin);
    state.registryIndex = 0;
    renderRegistry();

    toast("Registry API unavailable — showing UI demo data.", true);
  }
}

$("registry-next")?.addEventListener("click", () => {
  if (!state.registryPlugins.length) return;

  state.registryIndex =
    (state.registryIndex + 1) % state.registryPlugins.length;

  updateRegistryPosition();
});

$("registry-prev")?.addEventListener("click", () => {
  if (!state.registryPlugins.length) return;

  state.registryIndex =
    (state.registryIndex - 1 + state.registryPlugins.length) %
    state.registryPlugins.length;

  updateRegistryPosition();
});

// Touch / swipe support for registry carousel.
let swipeStartX = null;

$("registry-track")?.addEventListener(
  "touchstart",
  (event) => {
    swipeStartX = event.touches?.[0]?.clientX ?? null;
  },
  { passive: true }
);

$("registry-track")?.addEventListener(
  "touchend",
  (event) => {
    if (swipeStartX === null || !state.registryPlugins.length) return;

    const endX = event.changedTouches?.[0]?.clientX ?? swipeStartX;
    const delta = endX - swipeStartX;

    if (Math.abs(delta) > 45) {
      if (delta < 0) {
        state.registryIndex =
          (state.registryIndex + 1) % state.registryPlugins.length;
      } else {
        state.registryIndex =
          (state.registryIndex - 1 + state.registryPlugins.length) %
          state.registryPlugins.length;
      }

      updateRegistryPosition();
    }

    swipeStartX = null;
  },
  { passive: true }
);


/* ============================================================
   UNKNOWN / ONBOARDING
   This is intentionally tolerant because onboarding API schemas
   often change while the prototype is being developed.
============================================================ */

$("preview-onboarding")?.addEventListener("click", async () => {
  const payload = $("unknown-onboarding-input").value.trim();

  if (!payload) {
    toast("Paste an unknown log sample first.", true);
    return;
  }

  const host = $("onboarding-preview");
  host.textContent = "Analyzing source shape…";

  try {
    // Change only this endpoint if your backend uses a different route.
    const data = await api("/api/v1/onboarding/preview", {
      method: "POST",
      body: JSON.stringify({ payload }),
    });

    host.textContent = pretty(data);
    toast("Onboarding preview ready.");
  } catch (error) {
    // Useful local preview if the backend endpoint does not exist yet.
    const tokens = payload
      .split(/\s+/)
      .map((token) => token.split("=")[0])
      .filter(Boolean)
      .slice(0, 12);

    host.textContent =
      `Backend preview endpoint is not connected yet.\n\n` +
      `Detected field-like tokens:\n` +
      tokens.map((token) => `• ${token}`).join("\n");

    toast("Onboarding preview API unavailable.", true);
  }
});


/* ============================================================
   INITIAL STATE
============================================================ */

switchScreen("overview");
