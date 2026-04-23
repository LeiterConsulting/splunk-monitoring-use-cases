/* Cisco UI catalog — chunk 0: lazy-bootstrap loader.
 *
 * Runs FIRST in the concatenated bundle. Two modes:
 *
 *   1) Legacy mode — `data.js` was loaded as a separate <script> tag, so
 *      window.DATA, window.EQUIPMENT, window.CAT_META, window.CAT_GROUPS,
 *      window.FILTER_FACETS, window.RECENTLY_ADDED already exist.
 *      The loader resolves immediately, calls __bootstrapCatalogState(),
 *      and dispatches the "catalog:ready" event synchronously.
 *
 *   2) Lazy mode (production) — data.js is NOT loaded. window.DATA is
 *      empty. The loader fetches /api/catalog-index.json (~5 MB JSON,
 *      ~750 KB gzipped), reconstructs the legacy globals from the
 *      lightweight UC stubs, then runs the bootstrap.
 *
 * Heavy per-UC fields (full SPL, narrative, references, screenshots)
 * are NOT in the index. The detail panel lazy-fetches them from
 * /api/cat-{cat}.json on first open via __ensureFullUC().
 *
 * Public surface:
 *   window.__catalogReady   — Promise<void>; resolves when DATA + globals
 *                             are populated and __bootstrapCatalogState()
 *                             has run. initApp() must `await` this.
 *   window.__catalogIndex   — the parsed catalog-index.json (lazy mode only).
 *   window.__ensureFullUC(uc_id) — returns Promise<void> that resolves when
 *                             the UC's heavy fields are merged into DATA.
 *                             Cheap if already loaded.
 *   window.dispatchEvent(new Event("catalog:ready"))  — fired exactly once.
 */

(function() {
  if (typeof window === "undefined") return;

  // Root-absolute so the SPA works from any depth (e.g. /browse/, /embed/...).
  // Override via window.__CATALOG_API_BASE if hosting under a non-root prefix.
  var API_BASE = (typeof window.__CATALOG_API_BASE === "string" && window.__CATALOG_API_BASE)
    ? window.__CATALOG_API_BASE.replace(/\/+$/, "")
    : "/api";

  var CATALOG_INDEX_URL = API_BASE + "/catalog-index.json";
  var CATEGORY_URL = function(catId) { return API_BASE + "/cat-" + catId + ".json"; };

  var legacyMode =
    Array.isArray(window.DATA) &&
    window.DATA.length > 0 &&
    window.DATA[0] &&
    Array.isArray(window.DATA[0].s);

  var dispatchedReady = false;
  var fullCatPromises = {};
  var fullUCPromises = {};

  window.__catalogReady = new Promise(function(resolve, reject) {
    if (legacyMode) {
      // Defer to a microtask so __bootstrapCatalogState (defined later in
      // the bundle) is available when we call it.
      Promise.resolve().then(function() {
        try {
          if (typeof __bootstrapCatalogState === "function") {
            __bootstrapCatalogState();
          }
          _dispatchReady();
          resolve();
        } catch (err) {
          console.error("[loader] legacy bootstrap failed:", err);
          reject(err);
        }
      });
      return;
    }

    fetch(CATALOG_INDEX_URL, { credentials: "same-origin" })
      .then(function(res) {
        if (!res.ok) {
          throw new Error("catalog-index HTTP " + res.status);
        }
        return res.json();
      })
      .then(function(idx) {
        window.__catalogIndex = idx;
        _populateGlobalsFromIndex(idx);
        if (typeof __bootstrapCatalogState === "function") {
          __bootstrapCatalogState();
        }
        _dispatchReady();
        resolve();
      })
      .catch(function(err) {
        console.error("[loader] catalog-index fetch failed:", err);
        // Surface a minimal empty state so the SPA still renders shell UI.
        window.DATA = window.DATA || [];
        if (typeof __bootstrapCatalogState === "function") {
          try { __bootstrapCatalogState(); } catch (e) {}
        }
        _dispatchReady();
        resolve();
      });
  });

  function _dispatchReady() {
    if (dispatchedReady) return;
    dispatchedReady = true;
    try {
      window.dispatchEvent(new Event("catalog:ready"));
    } catch (e) {
      // IE-style fallback (we don't ship to IE but be polite).
      var ev = document.createEvent("Event");
      ev.initEvent("catalog:ready", true, true);
      window.dispatchEvent(ev);
    }
  }

  function _populateGlobalsFromIndex(idx) {
    if (!idx || typeof idx !== "object") return;
    if (idx.site) window.SITE_CUSTOM = idx.site;
    if (Array.isArray(idx.equipment)) window.EQUIPMENT = idx.equipment;
    if (idx.catGroups && typeof idx.catGroups === "object") window.CAT_GROUPS = idx.catGroups;
    if (idx.catMeta && typeof idx.catMeta === "object") window.CAT_META = idx.catMeta;
    if (idx.filterFacets && typeof idx.filterFacets === "object") window.FILTER_FACETS = idx.filterFacets;
    if (Array.isArray(idx.recentlyAdded)) {
      try {
        window.RECENTLY_ADDED = new Set(idx.recentlyAdded);
      } catch (e) {
        window.RECENTLY_ADDED = idx.recentlyAdded;
      }
    }
    if (idx.regulations) window.REGULATIONS = idx.regulations;

    var cats = (idx.categories || []).map(function(c) {
      return { i: c.i, n: c.n, s: (c.subs || []).map(function(s) {
        return { i: s.i, n: s.n, u: [] };
      }) };
    });
    var catById = {};
    var subKey = function(cat, subId) { return cat + "|" + subId; };
    cats.forEach(function(c) { catById[c.i] = c; });

    var subIndex = {};
    cats.forEach(function(c) {
      c.s.forEach(function(s) {
        subIndex[subKey(c.i, s.i)] = s;
      });
    });

    (idx.ucs || []).forEach(function(stub) {
      var sub = subIndex[subKey(stub.cat, stub.sub)];
      if (!sub) return;
      // The stub *is* the UC for browse-time purposes; per-UC heavy fields
      // are merged in lazily by __ensureFullUC().
      sub.u.push(stub);
    });

    window.DATA = cats;
  }

  // --------------------------------------------------------------------
  // Detail-panel lazy hydration
  // --------------------------------------------------------------------

  /** Fetch /api/cat-{catId}.json once and merge heavy fields into the
   *  matching UC stubs in window.DATA. Returns a Promise<void>. */
  window.__ensureFullCategory = function(catId) {
    if (legacyMode) return Promise.resolve();
    var key = String(catId);
    if (fullCatPromises[key]) return fullCatPromises[key];

    fullCatPromises[key] = fetch(CATEGORY_URL(catId), { credentials: "same-origin" })
      .then(function(res) {
        if (!res.ok) throw new Error("cat-" + catId + " HTTP " + res.status);
        return res.json();
      })
      .then(function(catFull) {
        _mergeCategoryFull(catId, catFull);
      })
      .catch(function(err) {
        console.error("[loader] cat-" + catId + " fetch failed:", err);
        // Allow retry on next call.
        delete fullCatPromises[key];
        throw err;
      });
    return fullCatPromises[key];
  };

  /** Convenience: ensure a single UC's heavy fields are merged. */
  window.__ensureFullUC = function(ucId) {
    if (!ucId) return Promise.resolve();
    if (fullUCPromises[ucId]) return fullUCPromises[ucId];
    var catId = parseInt(String(ucId).split(".")[0], 10);
    if (!catId || isNaN(catId)) return Promise.resolve();
    fullUCPromises[ucId] = window.__ensureFullCategory(catId);
    return fullUCPromises[ucId];
  };

  function _mergeCategoryFull(catId, catFull) {
    if (!catFull || !Array.isArray(catFull.s)) return;
    var stubCat = (window.DATA || []).find(function(c) { return c.i === catId; });
    if (!stubCat) return;

    var stubSubMap = {};
    stubCat.s.forEach(function(sub) {
      stubSubMap[sub.i] = sub;
      sub._ucMap = {};
      sub.u.forEach(function(uc, idx) { sub._ucMap[uc.i] = idx; });
    });

    catFull.s.forEach(function(fullSub) {
      var stubSub = stubSubMap[fullSub.i];
      if (!stubSub) return;
      (fullSub.u || []).forEach(function(fullUC) {
        var stubIdx = stubSub._ucMap[fullUC.i];
        if (typeof stubIdx === "number") {
          // Merge heavy fields onto the existing stub *in place* so any
          // existing references (ucIndex[].uc) keep pointing at the same
          // object. Stub fields take precedence for shape consistency.
          var stub = stubSub.u[stubIdx];
          for (var key in fullUC) {
            if (!Object.prototype.hasOwnProperty.call(fullUC, key)) continue;
            if (key in stub) continue; // already in stub
            stub[key] = fullUC[key];
          }
        } else {
          // Stub didn't exist for this UC — append the full record.
          stubSub.u.push(fullUC);
          stubSub._ucMap[fullUC.i] = stubSub.u.length - 1;
        }
      });
      delete stubSub._ucMap;
    });
  }
})();
/* Cisco UI catalog — chunk 1: setup, SI, state, helpers, filter core */
if (typeof EQUIPMENT === 'undefined') window.EQUIPMENT = [];
if (typeof CAT_META === 'undefined') window.CAT_META = {};
if (typeof CAT_GROUPS === 'undefined') window.CAT_GROUPS = {};
if (typeof FILTER_FACETS === 'undefined') window.FILTER_FACETS = {};
if (typeof DATA === 'undefined') window.DATA = [];

var SITE = Object.assign({
  heroBadge: "> Splunk Solutions Engineering", heroTitle: "Use Case Repository", heroTitleSpan: "for Splunk",
  heroIntro: "A curated path through {useCases} use cases across {categories} infrastructure domains.",
  statUseCases: "Use Cases", statCategories: "Categories", statSubcategories: "Subcategories", statQuickWins: "Quick Wins",
  roadmapTitle: "Implementation Roadmap", roadmapSub: "A phased approach to building comprehensive infrastructure monitoring",
  phase1Title: "Phase 1", phase1Heading: "Foundation", phase1Desc: "Deploy forwarders and start collecting data for immediate visibility.",
  phase2Title: "Phase 2", phase2Heading: "Core Monitoring", phase2Desc: "Expand data collection and build dashboards for critical infrastructure.",
  phase3Title: "Phase 3", phase3Heading: "Expand Coverage", phase3Desc: "Bring in cloud, application, and database monitoring for full-stack visibility.",
  phase4Title: "Phase 4", phase4Heading: "Optimize & Automate", phase4Desc: "Add ML-driven anomaly detection, automated remediation, and executive reporting.",
  filterAll: "All Categories", siteAuthor: "", siteRepoUrl: "https://github.com/fenre/splunk-monitoring-use-cases"
}, window.SITE_CUSTOM || {});

var EQUIPMENT_GROUPS = window.EQUIPMENT_GROUPS || [];

var SI = {
  magnifier: '<path fill-rule="evenodd" clip-rule="evenodd" d="M15.05 16.46c-1.26.97-2.84 1.54-4.55 1.54C6.36 18 3 14.64 3 10.5S6.36 3 10.5 3 18 6.36 18 10.5c0 1.71-.57 3.29-1.54 4.55l4.24 4.24a1 1 0 0 1-1.41 1.41l-4.24-4.24ZM16 10.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z"/>',
  chevronRight: '<path fill-rule="evenodd" clip-rule="evenodd" d="M14.79 12 8.49 5.7a1 1 0 0 1 1.41-1.41l6.65 6.65a1.5 1.5 0 0 1 0 2.12l-6.65 6.65a1 1 0 0 1-1.41-1.41L14.79 12Z"/>',
  chevronDown: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 14.79l6.3-6.3a1 1 0 0 1 1.41 1.42l-6.65 6.65a1.5 1.5 0 0 1-2.12 0L4.29 9.9a1 1 0 0 1 1.41-1.41L12 14.79Z"/>',
  cross: '<path d="M6.7 5.3a1 1 0 0 0-1.41 1.41L10.59 12l-5.3 5.3a1 1 0 1 0 1.42 1.41L12 13.41l5.3 5.3a1 1 0 0 0 1.41-1.42L13.41 12l5.3-5.3a1 1 0 0 0-1.42-1.41L12 10.59 6.7 5.3Z"/>',
  list: '<path d="M3.5 7.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 6a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H9a1 1 0 0 1-1-1Z"/><path d="M9 11a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2H9Z"/><path d="M9 17a1 1 0 1 0 0 2h12a1 1 0 1 0 0-2H9Z"/><path d="M3.5 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M5 18a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z"/>',
  external: '<path fill-rule="evenodd" clip-rule="evenodd" d="M14 5a1 1 0 0 1 1-1h4a2 2 0 0 1 2 2v4a1 1 0 1 1-2 0V7.41l-7.29 7.3a1 1 0 0 1-1.42-1.42L17.59 6H15a1 1 0 0 1-1-1ZM5 7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4a1 1 0 1 0-2 0v4H5V9h4a1 1 0 0 0 0-2H5Z"/>',
  monitor: '<path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 2.97H18.5A2.5 2.5 0 0 1 21 5.47v9a2.5 2.5 0 0 1-2.5 2.5H15V19h2a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2h2v-2.03H5.5a2.5 2.5 0 0 1-2.5-2.5v-9a2.5 2.5 0 0 1 2.5-2.5ZM11 19h2v-2h-2v2ZM5.5 4.97a.5.5 0 0 0-.5.5v9a.5.5 0 0 0 .5.5h13a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-13Z"/>',
  cloudNodes: '<path d="M19.21 8.31C18.59 5.98 16.15 3 12 3 9.68 3 7.88 4.03 6.66 5.26 5.97 5.95 5.43 6.75 5.08 7.5h6.69a2.5 2.5 0 1 1 0 3H2.75C1.74 10.45 1 11.83 1 13.5c0 1.33.45 2.7 1.38 3.75C3.32 18.32 4.72 19 6.5 19h11c1.74 0 3.14-.59 4.1-1.64.61-.67 1.01-1.49 1.22-2.36H9.73a2.5 2.5 0 1 1 0-3h13.25c-.11-1.32-.73-2.42-1.51-3.23a6.84 6.84 0 0 0-2.26-1.46Z"/>',
  container: '<path fill-rule="evenodd" clip-rule="evenodd" d="M4.5 4A1.5 1.5 0 0 0 3 5.5v13A1.5 1.5 0 0 0 4.5 20h15a1.5 1.5 0 0 0 1.5-1.5v-13A1.5 1.5 0 0 0 19.5 4h-15ZM9 9a1 1 0 1 0-2 0v6a1 1 0 1 0 2 0V9Zm3-1a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V9a1 1 0 0 1 1-1Z"/>',
  globe: '<path fill-rule="evenodd" clip-rule="evenodd" d="M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Zm-2.06 1a8.01 8.01 0 0 1-5.38 6.58c.97-2.06 1.53-4.3 1.63-6.58h3.75Zm-5.76 7A15.9 15.9 0 0 0 14.18 13H9.82c.12 2.47.84 4.87 2.11 7h.14Zm-4.63-.42A8.01 8.01 0 0 1 4.06 13h3.76a15.9 15.9 0 0 0 1.63 6.58ZM9.82 11h4.36A15.87 15.87 0 0 0 12.07 4H12c-.03 0-.05 0-.07 0a15.87 15.87 0 0 0-2.11 7Zm-.38-6.58A15.87 15.87 0 0 0 7.82 11H4.06a8.01 8.01 0 0 1 5.38-6.58ZM19.94 11h-3.76a15.87 15.87 0 0 0-1.62-6.58A8.01 8.01 0 0 1 19.94 11Z"/>',
  networkDevices: '<path fill-rule="evenodd" clip-rule="evenodd" d="M20 4.5A1.5 1.5 0 0 0 18.5 3h-13A1.5 1.5 0 0 0 4 4.5v10A1.5 1.5 0 0 0 5.5 16H11v1.17A3 3 0 0 0 9.17 19H4a1 1 0 1 0 0 2h5.17a3 3 0 0 0 5.66 0H20a1 1 0 1 0 0-2h-5.17A3 3 0 0 0 13 17.17V16h5.5a1.5 1.5 0 0 0 1.5-1.5v-10ZM7.9 7.7a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4Zm0 6a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4ZM10.8 20a1.2 1.2 0 0 1 1.2-1.2 1.2 1.2 0 1 1-1.2 1.2Z"/>',
  layersTriple: '<path fill-rule="evenodd" clip-rule="evenodd" d="M13.27 2.92a2.5 2.5 0 0 0-2.54 0L3.84 5.6c-1.28.5-1.28 2.3 0 2.8l6.9 2.68a2.5 2.5 0 0 0 2.54 0l6.9-2.68c1.27-.5 1.27-2.3 0-2.8l-6.9-2.68Zm-.73 1.86a1 1 0 0 1 1.09 0L18.24 7l-5.7 2.22a1 1 0 0 1-1.09 0L5.76 7l5.78-2.22Z"/><path d="M17.33 11.65l2.76-1.08.07.03c1.28.5 1.28 2.3 0 2.8l-6.9 2.68a2.5 2.5 0 0 1-2.54 0l-6.9-2.68c-1.27-.5-1.27-2.3 0-2.8l.08-.03 2.76 1.07-.91.35 5.7 2.22a1 1 0 0 0 1.09 0l5.7-2.22-.91-.36Z"/><path d="M17.33 16.65l2.76-1.08.07.03c1.28.5 1.28 2.3 0 2.8l-6.9 2.68a2.5 2.5 0 0 1-2.54 0l-6.9-2.68c-1.27-.5-1.27-2.3 0-2.8l.08-.03 2.76 1.07-.91.35 5.7 2.22a1 1 0 0 0 1.09 0l5.7-2.22-.91-.36Z"/>',
  table: '<path fill-rule="evenodd" clip-rule="evenodd" d="M1 6.5A1.5 1.5 0 0 1 2.5 5h19A1.5 1.5 0 0 1 23 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-19A1.5 1.5 0 0 1 1 17.5v-11ZM13 13v4h8v-4H13Zm8-2H13V7h8v4ZM3 11h8V7H3v4Zm8 6H3v-4h8v4Z"/>',
  cog: '<path fill-rule="evenodd" clip-rule="evenodd" d="M8.93 3.09A1.5 1.5 0 0 1 10.38 2h3.25a1.5 1.5 0 0 1 1.44 1.09l.69 2.41 2.43-.61a1.5 1.5 0 0 1 1.7.7l1.62 2.81a1.5 1.5 0 0 1-.22 1.79L19.51 12l1.74 1.8a1.5 1.5 0 0 1 .22 1.79l-1.62 2.81a1.5 1.5 0 0 1-1.7.7l-2.43-.6-.69 2.41a1.5 1.5 0 0 1-1.44 1.09h-3.25a1.5 1.5 0 0 1-1.44-1.09l-.69-2.41-2.43.61a1.5 1.5 0 0 1-1.7-.7l-1.62-2.82a1.5 1.5 0 0 1 .22-1.79L4.49 12 2.75 10.2a1.5 1.5 0 0 1-.22-1.8l1.62-2.8a1.5 1.5 0 0 1 1.7-.71l2.43.61.69-2.41ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/>',
  key: '<path fill-rule="evenodd" clip-rule="evenodd" d="M10 9a6 6 0 1 1 3.71 5.55l-.5 1.82a1.5 1.5 0 0 1-1.05 1.05l-1.95.53-.62 1.98a1.5 1.5 0 0 1-1.67 1.05l-4.7-.75a1.37 1.37 0 0 1-.83-2.54L10.08 9.99A6 6 0 0 1 10 9Zm6.2 1.27a1.4 1.4 0 1 0 0-2.8 1.4 1.4 0 0 0 0 2.8Z"/>',
  shield: '<path fill-rule="evenodd" clip-rule="evenodd" d="M11.19 2.33a1.5 1.5 0 0 1 1.62 0c.94.58 4.03 2.39 6.95 2.92a1.5 1.5 0 0 1 1.24 1.5c-.05 5.17-.92 8.45-2.48 10.72-1.56 2.27-3.72 3.37-5.9 4.35a1.5 1.5 0 0 1-1.22 0c-2.19-.98-4.35-2.08-5.91-4.35-1.56-2.27-2.44-5.55-2.48-10.72a1.5 1.5 0 0 1 1.24-1.5c2.92-.54 6.01-2.34 6.95-2.92ZM12 4.18c-1.15.7-4.05 2.33-6.99 2.96.09 4.74.93 7.45 2.12 9.2C8.32 18.06 9.94 18.97 12 19.9c2.06-.93 3.68-1.84 4.87-3.56 1.2-1.74 2.04-4.46 2.12-9.2-2.94-.63-5.85-2.26-7-2.96Z"/>',
  envelope: '<path fill-rule="evenodd" clip-rule="evenodd" d="M19.73 4H4.27C3.02 4 2 5.12 2 6.5v10.99C2 18.88 3.02 20 4.27 20h15.46C20.98 20 22 18.88 22 17.5V6.5C22 5.12 20.98 4 19.73 4ZM3.82 7.32V17.5c0 .28.2.5.45.5h15.45c.25 0 .45-.22.45-.5V7.33l-7.23 6.33a1.5 1.5 0 0 1-1.9 0L3.82 7.32ZM18.67 6H5.34L12 11.86 18.67 6Z"/>',
  nodeBranch: '<path fill-rule="evenodd" clip-rule="evenodd" d="M5 4a3 3 0 0 0-3 3 3 3 0 0 0 2.77 1.15c1.39.36 2.42 1.62 2.42 3.12v2.09c0 2.14 1.37 3.96 3.28 4.63.18 1.49 1.44 2.65 2.98 2.65a3 3 0 1 0-2.53-4.62c-1.02-.45-1.73-1.47-1.73-2.66v-2.09c0-1.22-.42-2.33-1.11-3.22h5.08a3 3 0 0 0 5.86-.98 3 3 0 0 0-5.86-.99H7.84A3 3 0 0 0 5 4Z"/>',
  monitorChart: '<path fill-rule="evenodd" clip-rule="evenodd" d="M5.5 2.97H18.5A2.5 2.5 0 0 1 21 5.47v9A2.5 2.5 0 0 1 18.5 16.97H15V19h2a1 1 0 1 1 0 2H7a1 1 0 1 1 0-2h2v-2.03H5.5A2.5 2.5 0 0 1 3 14.47v-9a2.5 2.5 0 0 1 2.5-2.5ZM13 17v2h-2v-2h2ZM14 7a1 1 0 0 1 1 1v5h-2V8a1 1 0 0 1 1-1Zm-4 2a1 1 0 0 1 1 1v3H9v-3a1 1 0 0 1 1-1Z"/>',
  factory: '<path fill-rule="evenodd" clip-rule="evenodd" d="M4 9.46V4.75A1.75 1.75 0 0 1 5.75 3h2.5C9.22 3 10 3.78 10 4.75v2.04l.54-.24a1.5 1.5 0 0 1 2.46 1.6V9.46L14.04 9H14V4.75A1.75 1.75 0 0 1 15.75 3h2.5c.97 0 1.75.78 1.75 1.75v1.67C21.02 6.27 22 7.05 22 8.15v11.1c0 .97-.78 1.75-1.75 1.75H3.75A1.75 1.75 0 0 1 2 19.25v-7.76c0-.69.41-1.32 1.04-1.6L4 9.46Z"/>',
  buildings: '<path fill-rule="evenodd" clip-rule="evenodd" d="M4 4.5A1.5 1.5 0 0 1 5.5 3h9A1.5 1.5 0 0 1 16 4.5V7h-4.5A1.5 1.5 0 0 0 10 8.5V19h2V9h8v10h1a1 1 0 1 1 0 2H3a1 1 0 1 1 0-2h1V4.5ZM6 9h2V7H6v2Zm8 4v-2h4v2h-4Zm0 4v-2h4v2h-4ZM6 17h2v-2H6v2Zm2-4H6v-2h2v2Z"/>',
  clipboard: '<path fill-rule="evenodd" clip-rule="evenodd" d="M8.36 3.15A2 2 0 0 1 9.82 2.02h3.94a2 2 0 0 1 1.45 1.13l.22.85h2.85A1.5 1.5 0 0 1 19.78 5.5v15c0 .83-.67 1.5-1.5 1.5H5.28a1.5 1.5 0 0 1-1.5-1.5v-15c0-.83.67-1.5 1.5-1.5h2.87l.21-.85Zm1.85.87l-.37 1.47h3.91l-.37-1.47h-3.17ZM8.78 10a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-6Zm0 4a1 1 0 1 0 0 2h3a1 1 0 1 0 0-2h-3Z"/>',
  lock: '<path fill-rule="evenodd" clip-rule="evenodd" d="M6.94 7.06V9.91H5.89A2 2 0 0 0 3.89 11.91v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1.02V7.06a4.96 4.96 0 1 0-9.93 0Zm4.96-2.96a2.96 2.96 0 0 0-2.96 2.96v2.85h5.93V7.06a2.96 2.96 0 0 0-2.97-2.96ZM11.89 18a1 1 0 0 1-1-1v-2a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1Z"/>',
  nodeNetwork: '<path fill-rule="evenodd" clip-rule="evenodd" d="M19 8a3 3 0 1 0-2.71-4.71L14.29 5.29A3 3 0 0 0 13 5c-.79 0-1.5.3-2.04.8L7.94 3.91a3 3 0 1 0-3.81 3.47l.31 3.07A3 3 0 0 0 3 13a3 3 0 0 0 6 0 3 3 0 0 0-.13-.88l2.45-1.63A3 3 0 0 0 13 11c.16 0 .32-.01.47-.04l2.28 3.05A3 3 0 1 0 21 16a3 3 0 0 0-3.47-2.96l-2.29-3.05A3 3 0 0 0 16 8c0-.46-.1-.9-.29-1.29l2-2A3 3 0 0 0 19 5a3 3 0 0 0 0-3Z"/>',
  servers: '<path fill-rule="evenodd" clip-rule="evenodd" d="M20 4.5A1.5 1.5 0 0 0 18.5 3h-13A1.5 1.5 0 0 0 4 4.5v5A1.5 1.5 0 0 0 5.5 11h13A1.5 1.5 0 0 0 20 9.5v-5ZM7.2 7a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0Z"/><path fill-rule="evenodd" clip-rule="evenodd" d="M20 14.5a1.5 1.5 0 0 0-1.5-1.5h-13A1.5 1.5 0 0 0 4 14.5v5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-5ZM7.2 17a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 0 0-2.4 0Z"/>',
  data: '<path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C7.58 2 4 3.79 4 6v12c0 2.21 3.58 4 8 4s8-1.79 8-4V6c0-2.21-3.58-4-8-4Zm6 4c0 .62-1.14 1.4-2.87 1.87A16.4 16.4 0 0 1 12 8.2c-1.11 0-2.17-.11-3.13-.33C7.14 7.4 6 6.62 6 6s1.14-1.4 2.87-1.87C9.83 3.8 10.89 3.68 12 3.68c1.11 0 2.17.11 3.13.33C16.86 4.6 18 5.38 18 6ZM6 8.65V12c0 .62 1.14 1.4 2.87 1.87.96.24 2.02.36 3.13.36s2.17-.12 3.13-.36C16.86 13.4 18 12.62 18 12V8.65c-.55.36-1.24.67-2.02.91A17.8 17.8 0 0 1 12 10.07c-1.44 0-2.81-.17-4-.51-.77-.24-1.46-.55-2-.91ZM6 18V14.65c.55.36 1.24.67 2.02.91 1.18.34 2.55.51 3.98.51s2.8-.17 3.98-.51c.78-.24 1.47-.55 2.02-.91V18c0 .62-1.14 1.4-2.87 1.87-.96.24-2.02.36-3.13.36s-2.17-.12-3.13-.36C7.14 19.4 6 18.62 6 18Z"/>',
  dollarMark: '<path d="M13 3a1 1 0 1 0-2 0v2.07a6.7 6.7 0 0 0-.7.11l-.12.03a4.5 4.5 0 0 0-1.44.62l-.13.09c-.32.21-.61.47-.85.78a3.5 3.5 0 0 0-.67 1.41l-.01.03c-.11.51-.1 1.03.03 1.53.17.66.54 1.26 1.06 1.7l.04.03c.22.19.47.36.73.49l.24.12c.36.18.74.31 1.13.41l.73.18 1.25.23.77.15V21a1 1 0 1 0 2 0v-2.03c.27-.03.54-.08.8-.15l.19-.05c.41-.11.8-.28 1.16-.5l.09-.06c.41-.25.77-.58 1.05-.97.37-.5.6-1.1.68-1.73V3Z"/>',
  chart: '<path d="M4 5a1 1 0 0 1 1 1v11h15a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="M7 13a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v3H7v-3Zm5-3a1 1 0 0 0-1 1v5h3v-5a1 1 0 0 0-1-1h-1Zm3 1a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v5h-3v-5Zm4-4a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v2h3V7Z"/>',
  download: '<path d="M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42L11 13.59V4a1 1 0 0 1 1-1Z"/><path d="M4 17a1 1 0 0 1 1 1v1h14v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"/>'
};
function si(name, cls) {
  return '<svg class="si' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">' + (SI[name] || '') + '</svg>';
}

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function stripMd(s) {
  if (!s) return '';
  return String(s).replace(/`([^`]+)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}
function linkify(s) {
  var t = esc(s);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return t;
}

var CRIT_ORDER = {critical:0, high:1, medium:2, low:3};
var DIFF_ORDER = {beginner:0, intermediate:1, advanced:2, expert:3};
var SIDEBAR_GROUP_LABELS = { infra:'Infrastructure', security:'Security', cloud:'Cloud & Containers', app:'Applications', industry:'Industry Verticals', compliance:'Regulatory & Compliance', business:'Business & Executive' };

var allUCs = [];
var ucIndex = {};
var _cachedRegKeys = [];
var _cachedMtypes = [];
// Phase 3a — clause-level regulation facet.
// ``_cachedClausesByReg[regName]`` → sorted array of unique clause strings
// (``"{version}#{clause}"`` canonical form). The UI renders a second-level
// dropdown from this map when the user has picked a regulation that
// actually has per-clause compliance rows. Populated from the compact
// ``uc.cmp[]`` array materialised by build.py's sidecar merge.
var _cachedClausesByReg = {};

function __bootstrapCatalogState() {
  allUCs.length = 0;
  Object.keys(ucIndex).forEach(function(k) { delete ucIndex[k]; });
  (window.DATA || []).forEach(function(cat) {
    (cat.s || []).forEach(function(sc) {
      (sc.u || []).forEach(function(uc) {
        var entry = { cat: cat, sc: sc, uc: uc, flatIdx: allUCs.length };
        var blob = [uc.n, uc.i, uc.v, uc.q, uc.t, uc.d, cat.n, sc.n].join(' ');
        if (Array.isArray(uc.a)) blob += ' ' + uc.a.join(' ');
        if (Array.isArray(uc.mtype)) blob += ' ' + uc.mtype.join(' ');
        if (Array.isArray(uc.regs)) blob += ' ' + uc.regs.join(' ');
        if (Array.isArray(uc.cmp)) {
          // Fold clause ids ("Art.5", "§164.312(b)") into the search blob
          // so an auditor typing "Art.5" or "164.312" lands on the right UC.
          uc.cmp.forEach(function(row) { if (row && row.cl) blob += ' ' + row.cl; });
        }
        if (uc.hw) blob += ' ' + uc.hw;
        if (uc.escu) blob += ' escu enterprise security content detection';
        if (uc.escu_rba) blob += ' rba risk based alerting';
        entry._searchBlob = blob.toLowerCase();
        allUCs.push(entry);
        ucIndex[uc.i] = entry;
      });
    });
  });
  __recomputeCachedFacets();
  __rebuildEqById();
}

function __recomputeCachedFacets() {
  var regSet = {};
  allUCs.forEach(function(e) { if (Array.isArray(e.uc.regs)) e.uc.regs.forEach(function(r) { regSet[r] = 1; }); });
  _cachedRegKeys = Object.keys(regSet).sort();

  // Rebuild the per-regulation clause facet from the compact
  // ``uc.cmp[]`` rows. Each row carries regulation + version + clause so
  // we can offer an auditor-facing clause dropdown that is scoped to
  // whichever framework they've picked in the first dropdown. Clauses
  // are stored in their canonical ``{version}#{clause}`` form so the
  // same clause string under two different versions shows up as two
  // separate options (regulators often renumber clauses between
  // revisions and conflating them would silently mask coverage gaps).
  var clauseMap = Object.create(null);
  allUCs.forEach(function(e) {
    var cmp = e.uc.cmp;
    if (!Array.isArray(cmp)) return;
    cmp.forEach(function(row) {
      if (!row || !row.r || !row.cl || !row.v) return;
      var reg = row.r;
      var canonical = row.v + '#' + row.cl;
      if (!clauseMap[reg]) clauseMap[reg] = Object.create(null);
      clauseMap[reg][canonical] = 1;
    });
  });
  _cachedClausesByReg = {};
  Object.keys(clauseMap).forEach(function(reg) {
    _cachedClausesByReg[reg] = Object.keys(clauseMap[reg]).sort(function(a, b) {
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
  });

  var mtypes = new Set();
  allUCs.forEach(function(e) { if (Array.isArray(e.uc.mtype)) e.uc.mtype.forEach(function(t) { mtypes.add(t); }); });
  var mtOrder = ['Availability','Performance','Security','Configuration','Capacity','Fault','Anomaly','Compliance'];
  _cachedMtypes = Array.from(mtypes).sort(function(a, b) {
    var ia = mtOrder.indexOf(a), ib = mtOrder.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if (ia >= 0) return -1;
    if (ib >= 0) return 1;
    return a.localeCompare(b);
  });
}

var currentCat = null;
var currentSubcat = null;
var catShowAllUCs = false;
var currentSearch = '';
var searchShowAll = false;
var currentPillarFilter = 'all';
var currentFilter = 'all';
var currentDiffFilter = 'all';
var currentStatusFilter = 'all';
var currentFreshFilter = 'all';
var currentRegulationFilter = 'all';
// Phase 3a — second-level filter scoped to the currently selected
// regulation. Stored in canonical ``{version}#{clause}`` form so the
// filter logic can split back into (version, clause) without extra
// lookups. Reset to ``'all'`` whenever the top-level regulation changes.
var currentClauseFilter = 'all';
var currentMtypeFilter = 'all';
var currentIndustryFilter = 'all';
var currentEscuFilter = 'all';
var currentDtypeFilter = 'all';
var currentPremiumFilter = 'all';
var currentCimFilter = 'all';
var currentSappFilter = 'all';
var currentMitreFilter = '';
var currentMitreTacticFilter = '';
var currentDsGroup = '';
var currentDatasourceFilter = '';
var currentTrendFilter = false;
var selectedEquipmentId = '';
var inventorySelections = [];
var _invTempSelections = new Set();
var INVENTORY_STORAGE_KEY = 'uc-inventory';
var selectedUCIds = new Set();
var UC_SELECTION_STORAGE_KEY = 'uc-selected-ucs';
var advFiltersOpen = false;
var nonTechnicalView = false;
var ovGroupFilter = 'all';
var ovHeroGroupFilter = null;
var expandedSidebarGroups = new Set();
var sidebarManualToggle = false;

var panelUCList = [];
var panelIdx = -1;
var panelOpen = false;
var currentDisplayedList = [];

var currentSort = 'criticality';
try { var _ss = localStorage.getItem('uc-sort-pref'); if (_ss) currentSort = _ss; } catch (e) {}

var _eqById = {};
function __rebuildEqById() {
  Object.keys(_eqById).forEach(function(k) { delete _eqById[k]; });
  (window.EQUIPMENT || []).forEach(function(eq) { if (eq && eq.id != null) _eqById[eq.id] = eq; });
}
__rebuildEqById();

var ucRenderBatch = 50;
var ucRenderedCount = 0;
var ucScrollObserver = null;
var ucAllCardsHtml = [];
var ucGridTargets = [];
function isEquipmentModelId(compoundId) {
  var list = EQUIPMENT || [];
  for (var i = 0; i < list.length; i++) {
    var eq = list[i];
    if (!eq.models) continue;
    for (var j = 0; j < eq.models.length; j++) {
      if (compoundId === eq.id + '_' + eq.models[j].id) return true;
    }
  }
  return false;
}

function getCatById(id) {
  if (id == null) return null;
  return DATA.find(function(c) { return c.i === id; }) || null;
}

function getFilteredUCs() {
  var result = allUCs;
  if (inventorySelections.length > 0 && !selectedEquipmentId) {
    var invSet = new Set(inventorySelections);
    var invTopIds = new Set();
    inventorySelections.forEach(function(id) { invTopIds.add(id.split('_')[0]); });
    result = result.filter(function(e) {
      var eq = e.uc.e || [];
      var em = e.uc.em || [];
      return eq.some(function(id) { return invSet.has(id) || invTopIds.has(id); })
          || em.some(function(id) { return invSet.has(id); });
    });
  }
  if (selectedEquipmentId) {
    var byModel = isEquipmentModelId(selectedEquipmentId);
    result = result.filter(function(e) {
      if (byModel) return Array.isArray(e.uc.em) && e.uc.em.indexOf(selectedEquipmentId) !== -1;
      return Array.isArray(e.uc.e) && e.uc.e.indexOf(selectedEquipmentId) !== -1;
    });
  }
  if (currentPillarFilter !== 'all') {
    result = result.filter(function(e) {
      var p = e.uc.pillar || 'observability';
      if (currentPillarFilter === 'security') return p === 'security' || p === 'both';
      if (currentPillarFilter === 'observability') return p === 'observability' || p === 'both';
      return true;
    });
  }
  if (currentRegulationFilter !== 'all') {
    // Top-level regulation filter still honours the flat ``regs[]`` list
    // for backward compatibility with UCs that don't have a structured
    // ``cmp[]`` array yet (pre-Phase-1 sidecars). UCs that *do* have a
    // ``cmp[]`` array still match here because build.py mirrors every
    // ``cmp`` row's regulation id into the flat ``regs[]`` union.
    result = result.filter(function(e) {
      return Array.isArray(e.uc.regs) && e.uc.regs.indexOf(currentRegulationFilter) !== -1;
    });
    if (currentClauseFilter && currentClauseFilter !== 'all') {
      // Second-level clause filter: only applicable when the top-level
      // regulation was chosen AND a specific ``{version}#{clause}`` tuple
      // has been selected. We split on the first ``#`` because clause
      // strings such as ``§164.312(b)`` legitimately contain ``#``-free
      // characters but could in theory include other punctuation. The
      // match is exact on regulation + version + clause — a partial
      // match would silently over-count coverage, which is the precise
      // story problem Phase 3 is meant to fix.
      var hashAt = currentClauseFilter.indexOf('#');
      if (hashAt > 0) {
        var wantVer = currentClauseFilter.slice(0, hashAt);
        var wantClause = currentClauseFilter.slice(hashAt + 1);
        result = result.filter(function(e) {
          if (!Array.isArray(e.uc.cmp)) return false;
          return e.uc.cmp.some(function(row) {
            return row
              && row.r === currentRegulationFilter
              && row.v === wantVer
              && row.cl === wantClause;
          });
        });
      }
    }
  }
  if (currentFilter !== 'all') result = result.filter(function(e) { return e.uc.c === currentFilter; });
  if (currentDiffFilter !== 'all') result = result.filter(function(e) { return e.uc.f === currentDiffFilter; });
  if (currentStatusFilter !== 'all') {
    result = result.filter(function(e) { return (e.uc.status || 'community') === currentStatusFilter; });
  }
  if (currentFreshFilter !== 'all') {
    result = result.filter(function(e) { return freshnessBucket(e.uc.reviewed) === currentFreshFilter; });
  }
  if (currentMtypeFilter !== 'all') {
    result = result.filter(function(e) { return Array.isArray(e.uc.mtype) && e.uc.mtype.indexOf(currentMtypeFilter) !== -1; });
  }
  if (currentIndustryFilter !== 'all') result = result.filter(function(e) { return e.uc.ind === currentIndustryFilter; });
  if (currentEscuFilter !== 'all') {
    result = result.filter(function(e) { return currentEscuFilter === 'yes' ? !!e.uc.escu : !e.uc.escu; });
  }
  if (currentDtypeFilter !== 'all') {
    var dtypeMethodologies = ['TTP','Anomaly','Hunting','Baseline','Correlation','Operational metrics'];
    if (currentDtypeFilter === 'TTP') {
      result = result.filter(function(e) { var d = e.uc.dtype; return d && (d === 'TTP' || dtypeMethodologies.indexOf(d) === -1); });
    } else {
      result = result.filter(function(e) { return e.uc.dtype === currentDtypeFilter; });
    }
  }
  if (currentPremiumFilter !== 'all') {
    result = result.filter(function(e) { return (e.uc.premium || '') === currentPremiumFilter; });
  }
  if (currentCimFilter !== 'all') {
    result = result.filter(function(e) {
      return Array.isArray(e.uc.a) && e.uc.a.some(function(m) { return m.split('(')[0].trim() === currentCimFilter; });
    });
  }
  if (currentSappFilter !== 'all') {
    var sappId = parseInt(currentSappFilter, 10);
    result = result.filter(function(e) {
      return Array.isArray(e.uc.sapp) && e.uc.sapp.some(function(a) { return a.id === sappId; });
    });
  }
  if (currentMitreFilter) {
    var mq = currentMitreFilter;
    result = result.filter(function(e) { return Array.isArray(e.uc.mitre) && e.uc.mitre.indexOf(mq) !== -1; });
  }
  if (currentMitreTacticFilter && typeof FILTER_FACETS !== 'undefined' && FILTER_FACETS.mitre) {
    var tacticTechs = {};
    FILTER_FACETS.mitre.forEach(function(g) { tacticTechs[g.tactic] = g.techniques.map(function(t) { return t.id; }); });
    var ids = tacticTechs[currentMitreTacticFilter] || [];
    result = result.filter(function(e) { return Array.isArray(e.uc.mitre) && e.uc.mitre.some(function(t) { return ids.indexOf(t) !== -1; }); });
  }
  if (currentDsGroup && !currentDatasourceFilter) {
    var grp = FILTER_FACETS.datasource_groups && FILTER_FACETS.datasource_groups.find(function(g) { return g.name === currentDsGroup; });
    if (grp) {
      var srcNames = grp.sources.map(function(s) { return s.name.toLowerCase(); });
      result = result.filter(function(e) {
        var d = (e.uc.d || '').toLowerCase();
        return srcNames.some(function(sn) { return d.indexOf(sn) !== -1; });
      });
    }
  } else if (currentDatasourceFilter) {
    var dq = currentDatasourceFilter.toLowerCase();
    result = result.filter(function(e) { return (e.uc.d || '').toLowerCase().indexOf(dq) !== -1; });
  }
  if (currentTrendFilter) result = result.filter(function(e) { return /\btrend/i.test(e.uc.n); });
  if (currentCat != null) result = result.filter(function(e) { return e.cat.i === currentCat; });
  if (currentSearch) {
    // Two-tier search:
    //   1) Synchronous substring scan over the in-memory _searchBlob.
    //      Always runs, returns instantly. Matches stub-level fields
    //      only (UC name, summary, source names, app names, etc.).
    //   2) Asynchronous shard-based inverted index (06-search.js).
    //      Indexes the full SPL + markdown narrative + heavy fields the
    //      stub doesn't ship. Scheduled here, results flow in via
    //      window.__onSearchResults -> reRender(); the union of (1) and
    //      the latest (2) is what the user sees.
    var qNorm = currentSearch.toLowerCase().trim();
    var words = qNorm.split(/\s+/).filter(Boolean);
    var inMem = new Set();
    for (var _si = 0; _si < result.length; _si++) {
      var _e = result[_si];
      if (words.every(function(w) { return _e._searchBlob.indexOf(w) !== -1; })) {
        inMem.add(_e.uc.i);
      }
    }
    if (window.__searchIndex && typeof window.__searchIndex.query === 'function') {
      // Schedule the async query (debounced inside the index). When it
      // resolves it calls __onSearchResults which fires reRender, and on
      // the next pass through here window.__searchAsyncResults will be
      // fresh.
      window.__searchIndex.query(qNorm);
    }
    var asyncSet = null;
    var ar = window.__searchAsyncResults;
    if (ar && ar.q === qNorm && ar.set) asyncSet = ar.set;
    result = result.filter(function(e) {
      return inMem.has(e.uc.i) || (asyncSet && asyncSet.has(e.uc.i));
    });
  }
  return result;
}

// Wired by 06-search.js once the async shard fetch resolves. The handler
// just kicks reRender(); getFilteredUCs() will then read the freshly
// published window.__searchAsyncResults on its next pass.
if (typeof window !== 'undefined') {
  window.__onSearchResults = function(q, set) {
    if (typeof currentSearch === 'undefined') return;
    if ((currentSearch || '').toLowerCase().trim() !== q) return;
    if (typeof reRender === 'function') {
      try { reRender(); } catch (e) { /* swallow */ }
    }
  };
}

function sortUCs(list, sortKey) {
  var s = sortKey || currentSort;
  return list.slice().sort(function(a, b) {
    if (s === 'criticality') return (CRIT_ORDER[a.uc.c] || 9) - (CRIT_ORDER[b.uc.c] || 9) || (DIFF_ORDER[a.uc.f] || 9) - (DIFF_ORDER[b.uc.f] || 9);
    if (s === 'difficulty') return (DIFF_ORDER[a.uc.f] || 9) - (DIFF_ORDER[b.uc.f] || 9) || (CRIT_ORDER[a.uc.c] || 9) - (CRIT_ORDER[b.uc.c] || 9);
    if (s === 'difficulty-desc') return (DIFF_ORDER[b.uc.f] || 9) - (DIFF_ORDER[a.uc.f] || 9) || (CRIT_ORDER[a.uc.c] || 9) - (CRIT_ORDER[b.uc.c] || 9);
    if (s === 'name-az') return a.uc.n.localeCompare(b.uc.n);
    if (s === 'name-za') return b.uc.n.localeCompare(a.uc.n);
    if (s === 'category') return (a.cat.i - b.cat.i) || (CRIT_ORDER[a.uc.c] || 9) - (CRIT_ORDER[b.uc.c] || 9);
    return 0;
  });
}

function critBadge(c) {
  return '<span class="c-badge c-badge-' + esc(c || 'low') + '">' + esc((c || '').charAt(0).toUpperCase() + (c || '').slice(1)) + '</span>';
}
function diffBadge(d) {
  return '<span class="c-badge c-badge-diff">' + esc((d || '').charAt(0).toUpperCase() + (d || '').slice(1)) + '</span>';
}
// Wave is the per-UC implementation tier inside the crawl/walk/run rollout
// model. Surfaces only when the curator has assigned one (uc.wv set); UCs
// without a wave never render a badge.
var WAVE_LABELS = { crawl: 'Crawl', walk: 'Walk', run: 'Run' };
var WAVE_TOOLTIPS = {
  crawl: 'Foundation wave — install the TA, turn on a base data feed, ship one panel or alert. Implement first.',
  walk: 'Intermediate wave — refines or correlates a crawl signal (anomaly detection, SLA math, cross-host roll-ups).',
  run: 'Advanced wave — depends on multiple crawls/walks, often cross-category. Implement after walk UCs are stable.'
};
function waveBadge(w) {
  var key = (w || '').toLowerCase();
  if (!WAVE_LABELS[key]) return '';
  return '<span class="c-badge c-badge-wave-' + esc(key) + '" title="' + esc(WAVE_TOOLTIPS[key]) + '">' + esc(WAVE_LABELS[key]) + '</span>';
}
// Reverse-prereq index: { 'UC-X.Y.Z': ['UC-A.B.C', ...] } where the listed
// UCs declare the key as a prerequisite. Built lazily on first use so the
// initial DATA scan in buildIndex() stays untouched, then memoised.
var _reversePrereqIndex = null;
function getReversePrereqIndex() {
  if (_reversePrereqIndex) return _reversePrereqIndex;
  _reversePrereqIndex = {};
  if (typeof DATA === 'undefined' || !Array.isArray(DATA)) return _reversePrereqIndex;
  DATA.forEach(function(cat) {
    (cat.s || []).forEach(function(sc) {
      (sc.u || []).forEach(function(uc) {
        if (!Array.isArray(uc.pre) || !uc.pre.length) return;
        var src = 'UC-' + uc.i;
        uc.pre.forEach(function(dep) {
          if (typeof dep !== 'string') return;
          (_reversePrereqIndex[dep] = _reversePrereqIndex[dep] || []).push(src);
        });
      });
    });
  });
  Object.keys(_reversePrereqIndex).forEach(function(k) {
    _reversePrereqIndex[k] = _reversePrereqIndex[k].sort();
  });
  return _reversePrereqIndex;
}
// Render an inline UC chip that opens the target UC in the side panel when
// clicked. Falls back to a plain id when the referenced UC is missing from
// the catalogue (defensive — validate_prerequisites() should already have
// failed the build, but the SPA must not crash on stale cached data.js).
function renderUCChip(ucFullId) {
  if (typeof ucFullId !== 'string' || !ucFullId.indexOf) return '';
  var bareId = ucFullId.replace(/^UC-/, '');
  var entry = (typeof ucIndex === 'object' && ucIndex) ? ucIndex[bareId] : null;
  if (!entry) {
    return '<li><span class="uc-chip" title="Unknown or removed UC">' + esc(ucFullId) + '</span></li>';
  }
  var title = entry.uc.n || '';
  var waveHtml = '';
  if (entry.uc.wv && WAVE_LABELS[entry.uc.wv]) {
    waveHtml = ' <span class="chip-wave c-badge c-badge-wave-' + esc(entry.uc.wv) + '" title="' + esc(WAVE_TOOLTIPS[entry.uc.wv]) + '">' + esc(WAVE_LABELS[entry.uc.wv]) + '</span>';
  }
  return '<li><button type="button" class="uc-chip" title="' + esc(title) + '" onclick="openUCById(\'' + esc(bareId) + '\')">' + esc(ucFullId) + waveHtml + '</button></li>';
}
function renderImplementationOrdering(uc) {
  var html = '';
  var pre = Array.isArray(uc.pre) ? uc.pre : [];
  var enables = getReversePrereqIndex()['UC-' + uc.i] || [];
  if (!pre.length && !enables.length) return '';
  if (pre.length) {
    html += '<div class="c-panel-section"><div class="c-panel-section-title">Implement first (prerequisites)</div><div class="c-panel-section-body"><ul class="uc-chip-list">';
    pre.forEach(function(p) { html += renderUCChip(p); });
    html += '</ul></div></div>';
  }
  if (enables.length) {
    html += '<div class="c-panel-section"><div class="c-panel-section-title">Enables</div><div class="c-panel-section-body"><ul class="uc-chip-list">';
    enables.forEach(function(p) { html += renderUCChip(p); });
    html += '</ul></div></div>';
  }
  return html;
}
// Per-category 'Crawl → Walk → Run' rollout rendered above the UC list.
// Reads from the precomputed ROADMAP global emitted by build.py
// (one bucket per wave, one bucket per category id). Returns '' when the
// category has no waves assigned at all so categories curators have not
// yet touched render unchanged.
function renderCategoryRoadmap(catId) {
  if (typeof ROADMAP === 'undefined' || !ROADMAP) return '';
  var buckets = ROADMAP[String(catId)];
  if (!buckets) return '';
  var crawl = Array.isArray(buckets.crawl) ? buckets.crawl : [];
  var walk = Array.isArray(buckets.walk) ? buckets.walk : [];
  var run = Array.isArray(buckets.run) ? buckets.run : [];
  var unassigned = Array.isArray(buckets.unassigned) ? buckets.unassigned : [];
  if (!crawl.length && !walk.length && !run.length) return '';
  var MAX_VISIBLE = 5;
  function chips(list) {
    if (!list.length) return '<span class="c-roadmap-empty">No UCs assigned</span>';
    var visible = list.slice(0, MAX_VISIBLE).map(renderUCChip).join('');
    var more = list.length > MAX_VISIBLE
      ? '<span class="c-roadmap-more" title="' + (list.length - MAX_VISIBLE) + ' more in this wave">+' + (list.length - MAX_VISIBLE) + '</span>'
      : '';
    return '<ul class="uc-chip-list">' + visible + '</ul>' + more;
  }
  function col(label, list, tip, withArrow) {
    return '<div class="c-roadmap-col">'
      + '<div class="c-roadmap-col-title" title="' + esc(tip) + '">'
      + esc(label) + ' <span class="c-roadmap-count">(' + list.length + ')</span>'
      + (withArrow ? ' <span class="c-roadmap-col-arrow" aria-hidden="true">→</span>' : '')
      + '</div>'
      + '<div class="c-roadmap-col-body">' + chips(list) + '</div>'
      + '</div>';
  }
  var html = '<div class="c-roadmap-band" role="group" aria-label="Implementation roadmap for this category">';
  html += col('Crawl', crawl, WAVE_TOOLTIPS.crawl, true);
  html += col('Walk', walk, WAVE_TOOLTIPS.walk, true);
  html += col('Run', run, WAVE_TOOLTIPS.run, false);
  if (unassigned.length) {
    html += '<div class="c-roadmap-unassigned">'
      + unassigned.length + ' UC(s) in this category have no wave assigned yet.'
      + '</div>';
  }
  html += '</div>';
  return html;
}

function githubIssueUrlForEntry(entry) {
  var uc = entry.uc, cat = entry.cat, sc = entry.sc;
  var repo = (SITE.siteRepoUrl || 'https://github.com/fenre/splunk-monitoring-use-cases').replace(/\/$/, '').replace(/\.git$/, '');
  var mm = repo.match(/github\.com\/([^/]+)\/([^/?#]+)/);
  var base = mm ? 'https://github.com/' + mm[1] + '/' + mm[2] : 'https://github.com/fenre/splunk-monitoring-use-cases';
  var issueTitle = '[UC Feedback] UC-' + uc.i + ' — ' + String(uc.n).replace(/[\r\n]+/g, ' ').substring(0, 100);
  var mdLink = cat.src ? (repo + '/blob/main/use-cases/' + cat.src) : (repo + '/tree/main/use-cases');
  var pageLink = '';
  try { pageLink = location.origin + location.pathname + location.search + '#uc-' + (uc.i || ''); } catch (e2) { pageLink = repo; }
  // Pre-fill the YAML issue form fields declared in
  // .github/ISSUE_TEMPLATE/use-case-feedback.yml:
  //   - uc-id      (input)
  //   - details    (textarea)
  //   - fix        (textarea)  -- left blank for the reporter
  var details = 'Category: ' + cat.i + '. ' + cat.n +
                ' / Subcategory: ' + sc.i + ' ' + sc.n + '\n\n' +
                'Source file: ' + (cat.src ? mdLink : '(unknown)') + '\n' +
                'Dashboard link: ' + pageLink + '\n\n' +
                'What is wrong?\n\n';
  var qs = [
    'template=use-case-feedback.yml',
    'title=' + encodeURIComponent(issueTitle),
    'uc-id=' + encodeURIComponent('UC-' + uc.i),
    'details=' + encodeURIComponent(details)
  ].join('&');
  return base + '/issues/new?' + qs;
}

function cimDocUrl(model) {
  var base = model.split('(')[0].trim().replace(/\s+/g, '_');
  return 'https://docs.splunk.com/Documentation/CIM/latest/User/' + encodeURIComponent(base);
}

function renderDetailCodeBlock(text, codeLang) {
  var includeSearch = typeof looksLikeSplunkSearch === 'function'
    ? looksLikeSplunkSearch(text, codeLang)
    : false;
  var actions = typeof codeActionButtonsHtml === 'function'
    ? codeActionButtonsHtml(includeSearch)
    : '<div class="code-actions"><button type="button" class="copy-btn" onclick="copyCode(this)">Copy</button></div>';
  return '<div class="code-wrap">' + actions + '<pre class="c-spl-block">' + esc(text) + '</pre></div>';
}

function renderDetailBody(md) {
  if (!md) return '';
  var fence = /^```(\w*)$/;
  var lines = md.split('\n');
  var out = [];
  var inCode = false;
  var codeLang = '';
  var codeLines = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var m = line.match(fence);
    if (m) {
      if (!inCode) { inCode = true; codeLang = (m[1] || 'text').toLowerCase(); codeLines = []; }
      else {
        inCode = false;
        out.push(renderDetailCodeBlock(codeLines.join('\n'), codeLang));
      }
      continue;
    }
    if (inCode) codeLines.push(line);
    else out.push(linkify(line) + '<br>');
  }
  if (inCode && codeLines.length) out.push(renderDetailCodeBlock(codeLines.join('\n'), codeLang));
  return out.join('');
}
function setSort(val) {
  currentSort = val;
  try { localStorage.setItem('uc-sort-pref', val); } catch (e) {}
  reRender();
}

function setPillarFilter(val) { currentPillarFilter = val; reRender(); }
function setFilter(f) { currentFilter = f; reRender(); }
function setDiffFilter(f) { currentDiffFilter = f; reRender(); }
function setStatusFilter(f) { currentStatusFilter = f; reRender(); }
function setFreshFilter(f) { currentFreshFilter = f; reRender(); }
function freshnessBucket(iso) {
  if (!iso) return 'unknown';
  var t = Date.parse(iso);
  if (isNaN(t)) return 'unknown';
  var days = (Date.now() - t) / 86400000;
  if (days <= 183) return 'fresh';
  if (days <= 366) return 'stale';
  return 'outdated';
}
function freshChipHtml(iso) {
  if (!iso) return '';
  var t = Date.parse(iso);
  if (isNaN(t)) return '';
  var days = Math.floor((Date.now() - t) / 86400000);
  var cls = 'fresh-green', label;
  if (days < 31) label = days + 'd ago';
  else if (days < 366) label = Math.round(days / 30) + 'mo ago';
  else label = Math.max(1, Math.round(days / 365)) + 'y ago';
  if (days > 183) cls = 'fresh-amber';
  if (days > 366) cls = 'fresh-red';
  return '<span class="uc-card-fresh ' + cls + '" title="Last reviewed ' + esc(iso) + '">✓ ' + esc(label) + '</span>';
}
function setRegFilter(f) {
  // Changing the regulation always resets the clause selection: a
  // clause id is only meaningful inside a single framework, and keeping
  // a stale clause when the user switches from (say) GDPR to PCI DSS
  // would silently produce zero-result pages with no obvious cause.
  currentRegulationFilter = f;
  currentClauseFilter = 'all';
  reRender();
}
function setClauseFilter(f) {
  // Clause-level filter is only meaningful when a specific regulation
  // is already selected; the regulation dropdown's ``onchange`` clears
  // this automatically. Values are the canonical ``{version}#{clause}``
  // form stored in ``_cachedClausesByReg``.
  currentClauseFilter = f || 'all';
  reRender();
}
function setMtypeFilter(f) { currentMtypeFilter = f; reRender(); }
function setTrendFilter() { currentTrendFilter = !currentTrendFilter; reRender(); }

function setAdvFilter(key, val) {
  if (key === 'escu') currentEscuFilter = val;
  else if (key === 'dtype') currentDtypeFilter = val;
  else if (key === 'premium') currentPremiumFilter = val;
  else if (key === 'cim') currentCimFilter = val;
  else if (key === 'sapp') currentSappFilter = val;
  else if (key === 'industry') currentIndustryFilter = val;
  else if (key === 'mitre') { currentMitreFilter = val; currentMitreTacticFilter = ''; }
  else if (key === 'mitre_tactic') { currentMitreTacticFilter = val; currentMitreFilter = ''; }
  reRender();
}

var _advDebounceTimer = null;
function debounceAdvSearch(key, val) {
  clearTimeout(_advDebounceTimer);
  _advDebounceTimer = setTimeout(function() {
    if (key === 'datasource') currentDatasourceFilter = val;
    reRender();
  }, 300);
}

function handleDsGroupSelect(val) {
  if (val === 'all') { currentDsGroup = ''; currentDatasourceFilter = ''; }
  else if (val === '__custom__') { currentDsGroup = ''; currentDatasourceFilter = ''; }
  else { currentDsGroup = val; currentDatasourceFilter = ''; }
  reRender();
}
function handleDsSourceSelect(val) { currentDatasourceFilter = val; reRender(); }

function toggleAdvFilters() { advFiltersOpen = !advFiltersOpen; reRender(); }

function buildMitreDdList(query) {
  if (typeof FILTER_FACETS === 'undefined' || !FILTER_FACETS.mitre) return '';
  var q = (query || '').toLowerCase().trim();
  var html = '<div class="adv-mitre-clear" onclick="selectMitreTech(\'\')">← All tactics & techniques</div>';
  var any = false;
  FILTER_FACETS.mitre.forEach(function(group) {
    var tacticMatch = !q || group.label.toLowerCase().indexOf(q) !== -1 || (group.tactic && group.tactic.toLowerCase().indexOf(q) !== -1);
    var matched = group.techniques.filter(function(t) {
      if (!q || tacticMatch) return true;
      return t.id.toLowerCase().indexOf(q) !== -1 || (t.name && t.name.toLowerCase().indexOf(q) !== -1);
    });
    if (matched.length === 0 && !tacticMatch) return;
    any = true;
    var tacSel = currentMitreTacticFilter === group.tactic ? ' selected' : '';
    html += '<div class="adv-mitre-tactic clickable' + tacSel + '" onclick="selectMitreDdTactic(\'' + esc(group.tactic || '') + '\')">' + esc(group.label) + '</div>';
    matched.forEach(function(t) {
      var sel = currentMitreFilter === t.id ? ' selected' : '';
      html += '<div class="adv-mitre-opt' + sel + '" onclick="selectMitreTech(\'' + esc(t.id) + '\')"><span class="mitre-tid">' + esc(t.id) + '</span> ' + esc(t.name || '') + '</div>';
    });
  });
  if (!any) html += '<div class="adv-mitre-none">No matches</div>';
  return html;
}

function toggleMitreDd() {
  var dd = document.getElementById('mitre-dd');
  var btn = dd && dd.previousElementSibling;
  if (!dd) return;
  var show = !dd.classList.contains('show');
  dd.classList.toggle('show', show);
  if (btn) btn.classList.toggle('open', show);
  if (show) {
    var list = document.getElementById('mitre-dd-list');
    if (list) list.innerHTML = buildMitreDdList('');
    var inp = dd.querySelector('.adv-mitre-search');
    if (inp) { inp.value = ''; inp.focus(); }
  }
}

function filterMitreDd(val) {
  var list = document.getElementById('mitre-dd-list');
  if (list) list.innerHTML = buildMitreDdList(val);
}

function selectMitreTech(id) {
  currentMitreFilter = id;
  currentMitreTacticFilter = '';
  var dd = document.getElementById('mitre-dd');
  if (dd) { dd.classList.remove('show'); var b = dd.previousElementSibling; if (b) b.classList.remove('open'); }
  reRender();
}

function selectMitreDdTactic(tactic) {
  currentMitreTacticFilter = tactic;
  currentMitreFilter = '';
  var dd = document.getElementById('mitre-dd');
  if (dd) { dd.classList.remove('show'); var b = dd.previousElementSibling; if (b) b.classList.remove('open'); }
  reRender();
}

function advancedFilterPanel() {
  var html = '<div class="adv-filter-panel"><div class="adv-row">';
  html += '<div class="adv-group"><label class="adv-label">ES Detection</label><div class="adv-chips">';
  [['all','All'],['yes','Yes'],['no','No']].forEach(function(o) {
    html += '<button type="button" class="c-chip sm' + (currentEscuFilter === o[0] ? ' active' : '') + '" onclick="setAdvFilter(\'escu\',\'' + o[0] + '\')">' + o[1] + '</button>';
  });
  html += '</div></div>';
  html += '<div class="adv-group"><label class="adv-label">Detection type</label><select class="c-select full" onchange="setAdvFilter(\'dtype\',this.value)">';
  html += '<option value="all">All types</option>';
  if (FILTER_FACETS.dtype) FILTER_FACETS.dtype.forEach(function(v) {
    html += '<option value="' + esc(v) + '"' + (currentDtypeFilter === v ? ' selected' : '') + '>' + esc(v) + '</option>';
  });
  html += '</select></div>';
  html += '<div class="adv-group"><label class="adv-label">Premium Apps</label><select class="c-select full" onchange="setAdvFilter(\'premium\',this.value)">';
  html += '<option value="all">All</option>';
  if (FILTER_FACETS.premium) FILTER_FACETS.premium.forEach(function(v) {
    html += '<option value="' + esc(v) + '"' + (currentPremiumFilter === v ? ' selected' : '') + '>' + esc(v.substring(0, 80)) + '</option>';
  });
  html += '</select></div>';
  html += '<div class="adv-group"><label class="adv-label">CIM Data Model</label><select class="c-select full" onchange="setAdvFilter(\'cim\',this.value)">';
  html += '<option value="all">All models</option>';
  if (FILTER_FACETS.cim) FILTER_FACETS.cim.forEach(function(v) {
    html += '<option value="' + esc(v) + '"' + (currentCimFilter === v ? ' selected' : '') + '>' + esc(v) + '</option>';
  });
  html += '</select></div>';
  html += '<div class="adv-group"><label class="adv-label">App / TA</label><select class="c-select full" onchange="setAdvFilter(\'sapp\',this.value)">';
  html += '<option value="all">All apps</option>';
  if (FILTER_FACETS.sapp) FILTER_FACETS.sapp.forEach(function(v) {
    html += '<option value="' + v.id + '"' + (currentSappFilter === String(v.id) ? ' selected' : '') + '>' + esc(v.name) + '</option>';
  });
  html += '</select></div>';
  html += '<div class="adv-group"><label class="adv-label">Industry</label><select class="c-select full" onchange="setAdvFilter(\'industry\',this.value)">';
  html += '<option value="all">All industries</option>';
  if (FILTER_FACETS.industry) FILTER_FACETS.industry.forEach(function(v) {
    html += '<option value="' + esc(v) + '"' + (currentIndustryFilter === v ? ' selected' : '') + '>' + esc(v) + '</option>';
  });
  html += '</select></div>';
  html += '<div class="adv-group"><label class="adv-label">Data source</label>';
  html += '<select class="c-select full" onchange="handleDsGroupSelect(this.value)">';
  html += '<option value="all"' + (!currentDsGroup && !currentDatasourceFilter ? ' selected' : '') + '>All sources</option>';
  if (FILTER_FACETS.datasource_groups) FILTER_FACETS.datasource_groups.forEach(function(g) {
    if (g.name === 'Other') return;
    html += '<option value="' + esc(g.name) + '"' + (currentDsGroup === g.name ? ' selected' : '') + '>' + esc(g.name) + ' (' + g.total + ')</option>';
  });
  html += '<option value="__custom__"' + (!currentDsGroup && currentDatasourceFilter ? ' selected' : '') + '>Other…</option></select>';
  if (currentDsGroup) {
    var grp = FILTER_FACETS.datasource_groups && FILTER_FACETS.datasource_groups.find(function(g) { return g.name === currentDsGroup; });
    if (grp && grp.sources.length) {
      html += '<select class="c-select full mt" onchange="handleDsSourceSelect(this.value)">';
      html += '<option value="">Any in group</option>';
      grp.sources.forEach(function(s) {
        html += '<option value="' + esc(s.name) + '"' + (currentDatasourceFilter === s.name ? ' selected' : '') + '>' + esc(s.name) + '</option>';
      });
      html += '</select>';
    }
  }
  if (!currentDsGroup && currentDatasourceFilter) {
    html += '<input type="text" class="c-input full mt" placeholder="Type data source…" value="' + esc(currentDatasourceFilter) + '" oninput="debounceAdvSearch(\'datasource\',this.value)">';
  }
  html += '</div></div>';
  var mitreLabel = 'All tactics & techniques';
  var mitreHas = false;
  if (currentMitreFilter && FILTER_FACETS.mitre) {
    mitreHas = true;
    FILTER_FACETS.mitre.some(function(g) {
      var f = g.techniques.find(function(t) { return t.id === currentMitreFilter; });
      if (f) { mitreLabel = f.id + ' — ' + f.name; return true; }
    });
  } else if (currentMitreTacticFilter && FILTER_FACETS.mitre) {
    mitreHas = true;
    var tg = FILTER_FACETS.mitre.find(function(g) { return g.tactic === currentMitreTacticFilter; });
    mitreLabel = tg ? 'Tactic: ' + tg.label : currentMitreTacticFilter;
  }
  html += '<div class="adv-row single"><div class="adv-group grow">';
  html += '<label class="adv-label">MITRE ATT&CK</label><div class="adv-mitre-row">';
  html += '<div class="adv-mitre-wrap" id="mitre-dd-wrap"><button type="button" class="adv-mitre-btn' + (mitreHas ? ' has-value' : '') + '" onclick="toggleMitreDd()">' + esc(mitreLabel) + '</button>';
  html += '<div class="adv-mitre-dd" id="mitre-dd"><input type="text" class="adv-mitre-search" placeholder="Search…" oninput="filterMitreDd(this.value)"><div id="mitre-dd-list"></div></div></div>';
  html += '<button type="button" class="c-btn c-btn-secondary mitre-map-trigger" onclick="openMitreMap()">' + si('shield') + ' Coverage Map</button>';
  html += '</div></div></div></div>';
  return html;
}

function breadcrumb(catObj, scObj) {
  var h = '<nav class="c-breadcrumb"><button onclick="goHome()">Overview</button>';
  if (catObj) {
    h += '<span class="c-bc-sep">/</span>';
    if (scObj) {
      h += '<button onclick="selectCat(' + catObj.i + ')">' + esc(catObj.n) + '</button>';
      h += '<span class="c-bc-sep">/</span><span class="c-bc-current">' + esc(scObj.n) + '</span>';
    } else {
      h += '<span class="c-bc-current">' + esc(catObj.n) + '</span>';
    }
  }
  return h + '</nav>';
}
function emptyState(msg) {
  return '<div class="c-empty-state">' +
    '<div class="c-empty-icon">' + si('search') + '</div>' +
    '<div class="c-empty-title">' + esc(msg || 'No use cases match your filters') + '</div>' +
    '<div class="c-empty-desc">Try removing some filters or broadening your search.</div>' +
    '<div class="c-empty-actions">' +
    '<button class="primary" onclick="clearAllFilters()">Clear all filters</button>' +
    '<button onclick="goHome()">Back to overview</button>' +
    '</div></div>';
}
function filterStrip() {
  var html = '<div class="filter-strip">';
  [['all','All'],['security','Security'],['observability','Observability']].forEach(function(p) {
    html += '<button type="button" class="c-chip' + (currentPillarFilter === p[0] ? ' active' : '') + '" onclick="setPillarFilter(\'' + p[0] + '\')">' + p[1] + '</button>';
  });
  html += '<select class="c-select" onchange="setFilter(this.value)"><option value="all">All criticality</option>';
  ['critical','high','medium','low'].forEach(function(c) {
    html += '<option value="' + c + '"' + (currentFilter === c ? ' selected' : '') + '>' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>';
  });
  html += '</select><select class="c-select" onchange="setDiffFilter(this.value)"><option value="all">All Difficulty</option>';
  ['beginner','intermediate','advanced','expert'].forEach(function(d) {
    html += '<option value="' + d + '"' + (currentDiffFilter === d ? ' selected' : '') + '>' + d.charAt(0).toUpperCase() + d.slice(1) + '</option>';
  });
  html += '</select>';
  html += '<select class="c-select" onchange="setStatusFilter(this.value)" title="Quality status">';
  html += '<option value="all">All Status</option>';
  ['verified','community','draft'].forEach(function(s) {
    html += '<option value="' + s + '"' + (currentStatusFilter === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
  });
  html += '</select>';
  html += '<select class="c-select" onchange="setFreshFilter(this.value)" title="Last reviewed">';
  html += '<option value="all">All Freshness</option>';
  [['fresh','≤ 6 mo'],['stale','6–12 mo'],['outdated','> 12 mo'],['unknown','Never reviewed']].forEach(function(fp) {
    html += '<option value="' + fp[0] + '"' + (currentFreshFilter === fp[0] ? ' selected' : '') + '>' + fp[1] + '</option>';
  });
  html += '</select>';
  if (_cachedRegKeys.length) {
    html += '<select class="c-select" onchange="setRegFilter(this.value)" title="Regulation framework">';
    html += '<option value="all">All Regulations</option>';
    _cachedRegKeys.forEach(function(r) {
      html += '<option value="' + esc(r) + '"' + (currentRegulationFilter === r ? ' selected' : '') + '>' + esc(r) + '</option>';
    });
    html += '</select>';
    // Phase 3a — clause-level dropdown. Only renders when the user
    // picked a specific regulation AND that regulation has at least
    // one structured ``cmp[]`` row in the catalogue. Frameworks whose
    // UCs still use the flat ``regs[]`` form (pre-Phase-1 sidecars)
    // simply don't show the second dropdown, so the UX degrades to
    // "regulation only" instead of breaking.
    if (currentRegulationFilter !== 'all') {
      var clauses = _cachedClausesByReg[currentRegulationFilter] || [];
      if (clauses.length) {
        html += '<select class="c-select" onchange="setClauseFilter(this.value)" title="Specific clause or article">';
        html += '<option value="all">All Clauses (' + clauses.length + ')</option>';
        clauses.forEach(function(canonical) {
          // canonical form: ``{version}#{clause}``. Split on the first
          // ``#`` so the option label can show the clause prominently
          // with the version in parentheses — clauses are how auditors
          // think ("show me GDPR Art.5 coverage") and versions are
          // disambiguators, not the primary key.
          var hashAt = canonical.indexOf('#');
          var ver = hashAt > 0 ? canonical.slice(0, hashAt) : '';
          var clause = hashAt > 0 ? canonical.slice(hashAt + 1) : canonical;
          var label = clause + (ver ? '  (' + ver + ')' : '');
          html += '<option value="' + esc(canonical) + '"' + (currentClauseFilter === canonical ? ' selected' : '') + '>' + esc(label) + '</option>';
        });
        html += '</select>';
      }
    }
  }
  if (_cachedMtypes.length) {
    html += '<select class="c-select" onchange="setMtypeFilter(this.value)"><option value="all">All Types</option>';
    _cachedMtypes.forEach(function(t) { html += '<option value="' + esc(t) + '"' + (currentMtypeFilter === t ? ' selected' : '') + '>' + esc(t) + '</option>'; });
    html += '</select>';
  }
  html += '<button type="button" class="c-chip trend' + (currentTrendFilter ? ' active' : '') + '" onclick="setTrendFilter()">📈 Trend</button>';
  html += '<span class="filter-count"><strong id="filter-count-num">0</strong> use cases</span></div>';
  var anyAdv = currentEscuFilter !== 'all' || currentDtypeFilter !== 'all' || currentPremiumFilter !== 'all' || currentCimFilter !== 'all' || currentSappFilter !== 'all' || currentIndustryFilter !== 'all' || currentMitreFilter || currentMitreTacticFilter || currentDsGroup || currentDatasourceFilter;
  html += '<div class="adv-toggle-row"><button type="button" class="adv-toggle-btn' + (advFiltersOpen ? ' open' : '') + '" onclick="toggleAdvFilters()">Advanced Filters ' + (anyAdv ? '•' : '') + ' ' + (advFiltersOpen ? '▲' : '▼') + '</button></div>';
  if (advFiltersOpen) html += advancedFilterPanel();
  return html;
}

function activeFilterTags() {
  var tags = [];
  if (currentPillarFilter !== 'all') tags.push({ label: currentPillarFilter === 'security' ? 'Security' : 'Observability', fn: "setPillarFilter('all')" });
  if (currentFilter !== 'all') tags.push({ label: currentFilter.charAt(0).toUpperCase() + currentFilter.slice(1), fn: "setFilter('all')" });
  if (currentDiffFilter !== 'all') tags.push({ label: currentDiffFilter.charAt(0).toUpperCase() + currentDiffFilter.slice(1), fn: "setDiffFilter('all')" });
  if (currentStatusFilter !== 'all') tags.push({ label: 'Status: ' + currentStatusFilter.charAt(0).toUpperCase() + currentStatusFilter.slice(1), fn: "setStatusFilter('all')" });
  if (currentFreshFilter !== 'all') {
    var freshMap = { fresh: '≤ 6 mo', stale: '6–12 mo', outdated: '> 12 mo', unknown: 'Never reviewed' };
    tags.push({ label: 'Reviewed: ' + (freshMap[currentFreshFilter] || currentFreshFilter), fn: "setFreshFilter('all')" });
  }
  if (currentRegulationFilter !== 'all') tags.push({ label: currentRegulationFilter, fn: "setRegFilter('all')" });
  if (currentClauseFilter && currentClauseFilter !== 'all') {
    // Render the clause as "<clause> (<version>)" so the chip reads like
    // an auditor would say it out loud ("GDPR Art.5 (2016/679)") rather
    // than the raw canonical ``{version}#{clause}`` which looks like an
    // internal id. The backing filter value stays canonical for exact
    // match in ``getFilteredUCs()``.
    var hashAt2 = currentClauseFilter.indexOf('#');
    var clauseLabel = hashAt2 > 0 ? (currentClauseFilter.slice(hashAt2 + 1) + '  (' + currentClauseFilter.slice(0, hashAt2) + ')') : currentClauseFilter;
    tags.push({ label: 'Clause: ' + clauseLabel, fn: "setClauseFilter('all')" });
  }
  if (currentMtypeFilter !== 'all') tags.push({ label: currentMtypeFilter, fn: "setMtypeFilter('all')" });
  if (currentIndustryFilter !== 'all') tags.push({ label: 'Industry: ' + currentIndustryFilter, fn: "setAdvFilter('industry','all')" });
  if (currentEscuFilter !== 'all') tags.push({ label: 'ES Detection: ' + (currentEscuFilter === 'yes' ? 'Yes' : 'No'), fn: "setAdvFilter('escu','all')" });
  if (currentDtypeFilter !== 'all') tags.push({ label: 'Detection: ' + currentDtypeFilter, fn: "setAdvFilter('dtype','all')" });
  if (currentPremiumFilter !== 'all') tags.push({ label: 'Premium: ' + currentPremiumFilter, fn: "setAdvFilter('premium','all')" });
  if (currentCimFilter !== 'all') tags.push({ label: 'CIM: ' + currentCimFilter, fn: "setAdvFilter('cim','all')" });
  if (currentSappFilter !== 'all') {
    var sl = currentSappFilter;
    if (FILTER_FACETS.sapp) { var sf = FILTER_FACETS.sapp.find(function(s) { return String(s.id) === currentSappFilter; }); if (sf) sl = sf.name; }
    tags.push({ label: 'App: ' + sl, fn: "setAdvFilter('sapp','all')" });
  }
  if (currentMitreFilter) {
    var mitreLabel = currentMitreFilter;
    if (FILTER_FACETS.mitre) { var mf2 = null; FILTER_FACETS.mitre.some(function(g) { mf2 = g.techniques.find(function(t) { return t.id === currentMitreFilter; }); return !!mf2; }); if (mf2 && mf2.name) mitreLabel = mf2.id + ' ' + mf2.name; }
    tags.push({ label: 'MITRE: ' + mitreLabel, fn: "setAdvFilter('mitre','')" });
  }
  if (currentMitreTacticFilter) {
    var tacLabel = currentMitreTacticFilter;
    if (FILTER_FACETS.mitre) { var tg = FILTER_FACETS.mitre.find(function(g) { return g.tactic === currentMitreTacticFilter; }); if (tg) tacLabel = tg.label; }
    tags.push({ label: 'Tactic: ' + tacLabel, fn: "setAdvFilter('mitre_tactic','')" });
  }
  if (currentDsGroup && currentDatasourceFilter) {
    tags.push({ label: currentDsGroup + ': ' + currentDatasourceFilter, fn: "clearAdvSearch('datasource')" });
  } else if (currentDsGroup) {
    tags.push({ label: 'Data source: ' + currentDsGroup, fn: "clearAdvSearch('datasource')" });
  } else if (currentDatasourceFilter) {
    tags.push({ label: 'Data source: ' + currentDatasourceFilter, fn: "clearAdvSearch('datasource')" });
  }
  if (currentTrendFilter) tags.push({ label: 'Trend', fn: "clearTrendFilter()" });
  if (selectedEquipmentId) {
    var _eqLabel = selectedEquipmentId;
    var _eqObj = (EQUIPMENT||[]).find(function(x){return x.id===selectedEquipmentId;});
    if (_eqObj) _eqLabel = _eqObj.label;
    tags.push({ label: 'Equipment: ' + _eqLabel, fn: "clearEquipmentFilter()" });
  }
  if (inventorySelections.length) tags.push({ label: 'Inventory (' + inventorySelections.length + ' items)', fn: "clearInventoryFilter()" });
  if (ovHeroGroupFilter) tags.push({ label: 'Domain: ' + ovHeroGroupFilter, fn: 'clearHeroFilter()' });
  if (currentSearch) tags.push({ label: 'Search: ' + currentSearch, fn: "clearSearch()" });
  if (!tags.length) return '';
  var h = '<div class="c-active-tags">';
  tags.forEach(function(t) { h += '<button type="button" class="c-active-tag" onclick="' + t.fn + '">' + esc(t.label) + ' <span class="x">×</span></button>'; });
  h += '<button type="button" class="c-clear-all" onclick="clearAllFilters()">Clear all</button></div>';
  return h;
}

function clearTrendFilter() { currentTrendFilter = false; reRender(); }
function clearAdvSearch(key) {
  if (key === 'datasource') { currentDsGroup = ''; currentDatasourceFilter = ''; }
  reRender();
}
function clearEquipmentFilter() {
  selectedEquipmentId = '';
  var es = document.getElementById('equipment-select');
  var ms = document.getElementById('equipment-model-select');
  var mw = document.getElementById('equipment-model-wrap');
  if (es) es.value = '';
  if (ms) ms.innerHTML = '<option value="">All models</option>';
  if (mw) mw.style.display = 'none';
  if (typeof reRender === 'function') reRender();
}
function clearInventoryFilter() {
  inventorySelections = [];
  try { localStorage.removeItem(INVENTORY_STORAGE_KEY); } catch (e) {}
  _updateInventoryBadge();
  reRender();
}

function clearAllFilters() {
  currentSearch = '';
  var siEl = document.getElementById('search-input');
  if (siEl) siEl.value = '';
  currentFilter = 'all'; currentDiffFilter = 'all'; currentIndustryFilter = 'all'; currentMtypeFilter = 'all';
  currentPillarFilter = 'all'; currentRegulationFilter = 'all'; currentClauseFilter = 'all'; currentEscuFilter = 'all'; currentDtypeFilter = 'all';
  currentPremiumFilter = 'all'; currentCimFilter = 'all'; currentSappFilter = 'all'; currentMitreFilter = '';
  currentStatusFilter = 'all'; currentFreshFilter = 'all';
  currentMitreTacticFilter = ''; currentDsGroup = ''; currentDatasourceFilter = ''; currentTrendFilter = false;
  ovHeroGroupFilter = null; ovGroupFilter = 'all';
  selectedEquipmentId = '';
  var es = document.getElementById('equipment-select');
  var ms = document.getElementById('equipment-model-select');
  var mw = document.getElementById('equipment-model-wrap');
  if (es) es.value = '';
  if (ms) ms.innerHTML = '<option value="">All models</option>';
  if (mw) mw.style.display = 'none';
  if (inventorySelections.length) { inventorySelections = []; try { localStorage.removeItem(INVENTORY_STORAGE_KEY); } catch (e2) {} }
  _updateInventoryBadge();
  reRender();
}
function renderUCCard(uc) {
  var cbChecked = selectedUCIds.has(uc.i) ? ' checked' : '';
  var cb = '<label class="uc-select-cb" onclick="event.stopPropagation()" title="Select for data sizing estimate"><input type="checkbox"' + cbChecked + ' onchange="toggleUCSelection(\'' + esc(uc.i) + '\')"></label>';
  var html = '<div class="uc-card" onclick="openUCById(\'' + esc(uc.i) + '\')">' + cb;
  html += '<div class="uc-card-top"><span class="uc-crit-dot c-' + esc(uc.c || 'low') + '"></span><div style="flex:1;min-width:0"><span class="uc-card-title">' + esc(uc.n) + '</span><div style="margin-top:3px"><span class="uc-card-id">UC-' + esc(uc.i) + '</span></div></div>';
  html += diffBadge(uc.f);
  html += '</div>';
  if (uc.v) html += '<p class="uc-card-val">' + esc(stripMd(uc.v)) + '</p>';
  var ta = (uc.t || '').replace(/`/g, '');
  var cimModels = Array.isArray(uc.a) ? uc.a : null;
  var mtypes = Array.isArray(uc.mtype) ? uc.mtype : null;
  var provCode = (window.PROVENANCE && window.PROVENANCE[uc.i]) || null;
  var showTagStrip = ta || cimModels || mtypes || uc.escu || (Array.isArray(uc.regs) && uc.regs.length) || uc.status || uc.reviewed || provCode;
  if (showTagStrip) {
    html += '<div class="uc-card-tags">';
    if (uc.status) html += '<span class="uc-card-status ' + esc(uc.status) + '" title="Quality status">' + esc(uc.status) + '</span>';
    if (provCode) {
      var provLabel = (window.PROVENANCE_LABELS && window.PROVENANCE_LABELS[provCode]) || 'Source';
      html += '<span class="uc-card-prov prov-' + esc(provCode) + '" title="Source: ' + esc(provLabel) + ' (see References for details)">' + esc(provLabel) + '</span>';
    }
    html += freshChipHtml(uc.reviewed);
    if (ta) html += '<span class="uc-card-equip">' + esc(ta.substring(0, 40)) + '</span>';
    if (cimModels) html += '<span class="uc-card-cim">' + esc(cimModels.join(', ')) + '</span>';
    if (mtypes) mtypes.forEach(function(t) { html += '<span class="uc-card-tag">' + esc(t) + '</span>'; });
    var pillar = uc.pillar || 'observability';
    if (pillar === 'security' || pillar === 'both') html += '<span class="uc-card-pillar security">Security</span>';
    if (pillar === 'observability' || pillar === 'both') html += '<span class="uc-card-pillar observability">Observability</span>';
    if (Array.isArray(uc.regs) && uc.regs.length) uc.regs.forEach(function(r) { html += '<span class="uc-card-reg">' + esc(r) + '</span>'; });
    if (uc.escu) html += '<span class="uc-card-es">ES Detection' + (uc.escu_rba ? ' (RBA)' : '') + '</span>';
    if (Array.isArray(uc.sapp) && uc.sapp.some(function(a) { return typeof a === 'object' && Array.isArray(a.predecessor) && a.predecessor.length; })) html += '<span class="uc-card-successor">Successor App</span>';
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderUCBatch(container, startIdx) {
  var end = Math.min(startIdx + ucRenderBatch, ucAllCardsHtml.length);
  if (ucGridTargets.length) {
    var byGrid = {};
    for (var i = startIdx; i < end; i++) {
      var gid = ucGridTargets[i];
      if (!byGrid[gid]) byGrid[gid] = [];
      byGrid[gid].push(ucAllCardsHtml[i]);
    }
    Object.keys(byGrid).forEach(function(gid) {
      var grid = document.getElementById(gid);
      if (!grid) return;
      var frag = document.createDocumentFragment();
      byGrid[gid].forEach(function(html) {
        var d = document.createElement('div');
        d.innerHTML = html;
        while (d.firstChild) frag.appendChild(d.firstChild);
      });
      grid.appendChild(frag);
    });
  }
  ucRenderedCount = end;
}

function setupUCScrollObserver(container) {
  if (ucScrollObserver) { ucScrollObserver.disconnect(); ucScrollObserver = null; }
  if (ucRenderedCount >= ucAllCardsHtml.length) return;
  var sentinel = document.createElement('div');
  sentinel.className = 'uc-scroll-sentinel';
  sentinel.style.height = '1px';
  container.appendChild(sentinel);
  ucScrollObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && ucRenderedCount < ucAllCardsHtml.length) {
      sentinel.remove();
      renderUCBatch(container, ucRenderedCount);
      if (ucRenderedCount < ucAllCardsHtml.length) container.appendChild(sentinel);
      else ucScrollObserver.disconnect();
    }
  }, { rootMargin: '400px' });
  ucScrollObserver.observe(sentinel);
}

function filterOvGroup(group) {
  ovGroupFilter = group;
  renderOverview();
  updateHash(false);
}

function filterByHeroGroup(group) {
  var des = ovHeroGroupFilter === group;
  ovHeroGroupFilter = des ? null : group;
  sidebarManualToggle = false;
  if (!des) { expandedSidebarGroups.clear(); expandedSidebarGroups.add(group); sidebarManualToggle = true; }
  renderOverview();
  buildSidebar();
}

function clearHeroFilter() {
  ovHeroGroupFilter = null;
  reRender();
}
function clearSearch() {
  currentSearch = '';
  var si = document.getElementById('search-input');
  if (si) si.value = '';
  reRender();
}

function toggleOvSection(el) {
  var body = el.nextElementSibling;
  var arrow = el.querySelector('.ov-collapse-arrow');
  var open = body.style.display === 'none';
  body.style.display = open ? '' : 'none';
  if (arrow) arrow.classList.toggle('open', open);
  el.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleSidebarGroup(g) {
  sidebarManualToggle = true;
  if (expandedSidebarGroups.has(g)) expandedSidebarGroups.delete(g);
  else expandedSidebarGroups.add(g);
  buildSidebar();
}

function scrollToSubcat(scId) {
  currentSubcat = scId;
  buildSidebar();
  updateHash(true);
  var el = document.getElementById('sc-' + String(scId).replace(/\./g, '_'));
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function _updateInventoryBadge() {
  var b = document.getElementById('inv-badge');
  if (b) {
    var n = inventorySelections.length;
    b.textContent = n ? String(n) : '';
    b.style.display = n ? 'inline-flex' : 'none';
  }
}

function _saveInventory() {
  try { localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(inventorySelections)); } catch (e) {}
}

function _loadInventory() {
  try {
    var raw = localStorage.getItem(INVENTORY_STORAGE_KEY);
    if (raw) inventorySelections = JSON.parse(raw) || [];
  } catch (e) { inventorySelections = []; }
}

function updateFilterCountNum() {
  var el = document.getElementById('filter-count-num');
  if (el) el.textContent = getFilteredUCs().length.toLocaleString();
}

function buildSidebar() {
  var sb = document.getElementById('sidebar');
  if (!sb) return;
  var filt = getFilteredUCs();
  var hasFilter = selectedEquipmentId || inventorySelections.length || currentPillarFilter !== 'all' || currentRegulationFilter !== 'all'
    || currentFilter !== 'all' || currentDiffFilter !== 'all' || currentMtypeFilter !== 'all' || currentIndustryFilter !== 'all'
    || currentStatusFilter !== 'all' || currentFreshFilter !== 'all'
    || currentEscuFilter !== 'all' || currentDtypeFilter !== 'all' || currentPremiumFilter !== 'all' || currentCimFilter !== 'all'
    || currentSappFilter !== 'all' || currentMitreFilter || currentMitreTacticFilter || currentDsGroup || currentDatasourceFilter
    || currentTrendFilter || currentSearch;
  var filtByCat = {};
  var filtBySubcat = {};
  if (hasFilter) {
    filt.forEach(function(e) {
      filtByCat[e.cat.i] = (filtByCat[e.cat.i] || 0) + 1;
      filtBySubcat[e.sc.i] = (filtBySubcat[e.sc.i] || 0) + 1;
    });
  }
  if (currentCat != null && !sidebarManualToggle) {
    var catToGroup = {};
    ['infra','security','cloud','app','industry','compliance','business'].forEach(function(g) {
      (CAT_GROUPS[g] || []).forEach(function(id) { catToGroup[id] = g; });
    });
    var ag = catToGroup[currentCat];
    if (ag) { expandedSidebarGroups.clear(); expandedSidebarGroups.add(ag); }
  }
  var html = '<div class="c-sidebar-item' + (!currentCat && !currentSearch ? ' active' : '') + '" onclick="goHome()">' + si('globe') + '<span>Overview</span><span class="c-sidebar-count">' + filt.length + '</span></div>';
  var groupOrder = ['infra','security','cloud','app','industry','compliance','business'];
  groupOrder.forEach(function(g) {
    var ids = CAT_GROUPS[g] || [];
    var groupCount = 0;
    ids.forEach(function(id) {
      if (hasFilter) groupCount += filtByCat[id] || 0;
      else {
        var c = DATA.find(function(d) { return d.i === id; });
        if (c) groupCount += c.s.reduce(function(a, s) { return a + s.u.length; }, 0);
      }
    });
    var isOpen = expandedSidebarGroups.has(g);
    html += '<div class="sb-group"><button type="button" class="sb-group-hd' + (isOpen ? ' open' : '') + '" onclick="toggleSidebarGroup(\'' + g + '\')">' + si('chevronRight') + '<span>' + esc(SIDEBAR_GROUP_LABELS[g] || g) + '</span><span class="c-sidebar-count">' + groupCount + '</span></button>';
    html += '<div class="sb-group-bd' + (isOpen ? ' open' : '') + '">';
    ids.forEach(function(catId) {
      var cat = DATA.find(function(d) { return d.i === catId; });
      if (!cat) return;
      var count = hasFilter ? (filtByCat[cat.i] || 0) : cat.s.reduce(function(a, s) { return a + s.u.length; }, 0);
      var meta = CAT_META[cat.i] || {};
      var active = currentCat === cat.i ? ' active' : '';
      html += '<div class="c-sidebar-item depth' + active + '" tabindex="0" role="button" onclick="selectCat(' + cat.i + ')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();selectCat(' + cat.i + ')}">' + si(meta.icon || 'globe') + '<span>' + esc(cat.n) + '</span><span class="c-sidebar-count">' + count + '</span></div>';
      html += '<div class="sb-subcats' + (currentCat === cat.i ? ' open' : '') + '">';
      cat.s.forEach(function(sc) {
        var scn = hasFilter ? (filtBySubcat[sc.i] || 0) : sc.u.length;
        if (hasFilter && scn === 0) return;
        var sca = currentSubcat === sc.i ? ' active' : '';
        html += '<div class="sb-subcat' + sca + '" tabindex="0" role="button" onclick="event.stopPropagation();goToSubcat(' + cat.i + ',\'' + String(sc.i).replace(/'/g, "\\'") + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();event.stopPropagation();goToSubcat(' + cat.i + ',\'' + String(sc.i).replace(/'/g, "\\'") + '\')}">' + esc(sc.n) + '<span class="c-sidebar-count">' + scn + '</span></div>';
      });
      html += '</div>';
    });
    html += '</div></div>';
  });
  sb.innerHTML = html;
}

function roadmapBlock() {
  var h = '<div class="roadmap-hd" onclick="toggleOvSection(this)" role="button" tabindex="0" aria-expanded="false"><span class="ov-collapse-arrow">' + si('chevronRight') + '</span> ' + esc(SITE.roadmapTitle || '') + '</div>';
  h += '<div class="roadmap-body" style="display:none"><p class="roadmap-sub">' + esc(SITE.roadmapSub || '') + '</p><div class="roadmap-grid">';
  [[SITE.phase1Title, SITE.phase1Heading, SITE.phase1Desc], [SITE.phase2Title, SITE.phase2Heading, SITE.phase2Desc], [SITE.phase3Title, SITE.phase3Heading, SITE.phase3Desc], [SITE.phase4Title, SITE.phase4Heading, SITE.phase4Desc]].forEach(function(p) {
    h += '<div class="roadmap-phase"><div class="rp-num">' + esc(p[0] || '') + '</div><h4>' + esc(p[1] || '') + '</h4><p>' + esc(p[2] || '') + '</p></div>';
  });
  h += '</div></div>';
  return h;
}

function renderOverview() {
  window.scrollTo(0, 0);
  if (ucScrollObserver) { ucScrollObserver.disconnect(); ucScrollObserver = null; }
  var main = document.getElementById('main');
  var filteredBase = getFilteredUCs();
  var filtered = filteredBase;
  if (ovHeroGroupFilter && CAT_GROUPS[ovHeroGroupFilter]) {
    var hg = CAT_GROUPS[ovHeroGroupFilter];
    filtered = filtered.filter(function(e) { return hg.indexOf(e.cat.i) !== -1; });
  }
  currentDisplayedList = filtered;
  var totalSubs = DATA.reduce(function(a, c) { return a + c.s.length; }, 0);
  var quickWins = filtered.filter(function(e) { return e.uc.f === 'beginner' && (e.uc.c === 'critical' || e.uc.c === 'high'); }).length;
  var intro = (SITE.heroIntro || '').replace('{useCases}', filtered.length).replace('{categories}', DATA.length);

  var html = '<div class="c-kpi-strip">';
  html += '<div class="c-kpi-card"><div class="c-kpi-num">' + filtered.length.toLocaleString() + '</div><div class="c-kpi-label">' + esc(SITE.statUseCases) + '</div></div>';
  html += '<div class="c-kpi-card"><div class="c-kpi-num">' + DATA.length + '</div><div class="c-kpi-label">' + esc(SITE.statCategories) + '</div></div>';
  html += '<div class="c-kpi-card"><div class="c-kpi-num">' + totalSubs + '</div><div class="c-kpi-label">' + esc(SITE.statSubcategories) + '</div></div>';
  html += '<div class="c-kpi-card"><div class="c-kpi-num">' + quickWins.toLocaleString() + '</div><div class="c-kpi-label">' + esc(SITE.statQuickWins) + '</div></div></div>';

  html += renderHelpBanner();
  html += '<div class="ov-hero-inline"><div class="ov-hero-badge">' + esc(SITE.heroBadge || '') + '</div><h2 class="ov-hero-h2">' + esc(SITE.heroTitle || '') + ' <span>' + esc(SITE.heroTitleSpan || '') + '</span></h2><p>' + esc(intro) + '</p></div>';

  var heroOrder = ['infra','security','cloud','app','industry','compliance','business'];
  var heroLabels = { infra:'Infrastructure', security:'Security', cloud:'Cloud', app:'Applications', industry:'Industry', compliance:'Regulatory & Compliance', business:'Business & Executive' };
  var heroIcons = { infra:'servers', security:'shield', cloud:'cloudNodes', app:'cog', industry:'factory', compliance:'clipboard', business:'chart' };
  html += '<div class="hero-domains">';
  heroOrder.forEach(function(g) {
    var ids = CAT_GROUPS[g] || [];
    var cnt = 0;
    ids.forEach(function(id) {
      var c = DATA.find(function(d) { return d.i === id; });
      if (c) cnt += c.s.reduce(function(a, s) { return a + s.u.length; }, 0);
    });
    var cls = 'hero-chip' + (ovHeroGroupFilter === g ? ' active' : '');
    html += '<button type="button" class="' + cls + '" onclick="filterByHeroGroup(\'' + g + '\')">' + si(heroIcons[g] || 'list') + esc(heroLabels[g]) + '<span class="hd-count">' + cnt + '</span></button>';
  });
  html += '</div>';

  html += filterStrip();
  html += activeFilterTags();

  html += '<div class="ov-tab-bar">';
  [['all', SITE.filterAll || 'Categories'], ['subcats', SITE.statSubcategories || 'Subcategories'], ['alluc', SITE.statUseCases || 'Use Cases'], ['quickwins', SITE.statQuickWins || 'Quick Wins'], ['recent', 'Recently Added']].forEach(function(g) {
    html += '<button type="button" class="ov-tab' + (ovGroupFilter === g[0] ? ' active' : '') + '" onclick="filterOvGroup(\'' + g[0] + '\')">' + esc(g[1]) + '</button>';
  });
  html += '<select class="ov-sort" onchange="setSort(this.value)">';
  [['criticality', '\u2195 Criticality'], ['difficulty', '\u2195 Easiest first'], ['difficulty-desc', '\u2195 Hardest first'], ['name-az', '\u2195 A\u2013Z'], ['name-za', '\u2195 Z\u2013A'], ['category', '\u2195 Category']].forEach(function(s) {
    html += '<option value="' + s[0] + '"' + (currentSort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
  });
  html += '</select>';
  html += '<div style="margin-left:auto;display:flex;gap:6px">';
  html += '<button type="button" class="ov-tab" onclick="exportFiltered(\'csv\')" title="Export filtered use cases as CSV">' + si('download') + 'CSV</button>';
  html += '<button type="button" class="ov-tab" onclick="exportFiltered(\'json\')" title="Export filtered use cases as JSON">' + si('download') + 'JSON</button>';
  html += '</div></div>';

  ucAllCardsHtml = [];
  ucGridTargets = [];

  if (ovGroupFilter === 'alluc') {
    var sorted = sortUCs(filtered);
    currentDisplayedList = sorted;
    var byCat = {};
    sorted.forEach(function(e) {
      var k = e.cat.i;
      if (!byCat[k]) byCat[k] = { cat: e.cat, entries: [] };
      byCat[k].entries.push(e);
    });
    var vcStructure = '';
    var vcGridIdx = 0;
    DATA.forEach(function(cat) {
      var g = byCat[cat.i];
      if (!g || !g.entries.length) return;
      var gid = 'uc-vgrid-' + vcGridIdx++;
      vcStructure += '<div class="ov-section"><div class="subcat-header">' + esc(cat.i + '. ' + cat.n) + '<span class="subcat-count">(' + g.entries.length + ')</span></div><div class="uc-grid" id="' + gid + '"></div></div>';
      g.entries.forEach(function(e) {
        ucAllCardsHtml.push(renderUCCard(e.uc));
        ucGridTargets.push(gid);
      });
    });
    html += '<div id="uc-virtual-container">' + vcStructure + '</div>';
  } else if (ovGroupFilter === 'subcats') {
    var filteredBySubcat = {};
    filtered.forEach(function(e) {
      var key = e.cat.i + '.' + (e.sc.i != null ? e.sc.i : '');
      filteredBySubcat[key] = (filteredBySubcat[key] || 0) + 1;
    });
    var hasAny = selectedEquipmentId || inventorySelections.length || currentFilter !== 'all' || currentDiffFilter !== 'all' || currentPillarFilter !== 'all'
      || currentRegulationFilter !== 'all' || currentMtypeFilter !== 'all' || currentIndustryFilter !== 'all' || currentEscuFilter !== 'all'
      || currentStatusFilter !== 'all' || currentFreshFilter !== 'all'
      || currentDtypeFilter !== 'all' || currentPremiumFilter !== 'all' || currentCimFilter !== 'all' || currentSappFilter !== 'all'
      || currentMitreFilter || currentMitreTacticFilter || currentDsGroup || currentDatasourceFilter || currentTrendFilter;
    var visibleSubs = hasAny ? Object.keys(filteredBySubcat).length : totalSubs;
    html += '<div class="ov-section"><h3 class="ov-h3">Subcategories — ' + visibleSubs + '</h3><div class="ov-subcat-list">';
    DATA.forEach(function(cat) {
      cat.s.forEach(function(sc) {
        var key = cat.i + '.' + (sc.i != null ? sc.i : '');
        var subCount = hasAny ? (filteredBySubcat[key] || 0) : sc.u.length;
        if (hasAny && subCount === 0) return;
        html += '<button type="button" class="ov-subcat-row" onclick="goToSubcat(' + cat.i + ',\'' + String(sc.i).replace(/'/g, "\\'") + '\')">';
        html += '<span class="ov-subcat-id">' + esc(sc.i) + '</span><span>' + esc(sc.n) + '</span><span class="ov-subcat-count">' + subCount + '</span></button>';
      });
    });
    html += '</div></div>';
  } else if (ovGroupFilter === 'recent') {
    var recentSet = (typeof RECENTLY_ADDED !== 'undefined') ? RECENTLY_ADDED : new Set();
    var rr = sortUCs(filtered.filter(function(e) { return recentSet.has(e.uc.i); }));
    currentDisplayedList = rr;
    var byCatR = {};
    rr.forEach(function(e) {
      var k = e.cat.i;
      if (!byCatR[k]) byCatR[k] = { cat: e.cat, entries: [] };
      byCatR[k].entries.push(e);
    });
    html += '<div class="ov-section"><h3 class="ov-h3">Recently Added (' + rr.length + ')</h3>';
    if (rr.length === 0) {
      html += '<p style="padding:1rem;opacity:.6">No new use cases since the last build. Run <code>build.py</code> after adding content to populate this tab.</p>';
    }
    Object.values(byCatR).forEach(function(g) {
      html += '<div class="ov-section"><div class="subcat-header">' + esc(g.cat.i + '. ' + g.cat.n) + '</div><div class="uc-grid">';
      g.entries.forEach(function(e) { html += renderUCCard(e.uc); });
      html += '</div></div>';
    });
    html += '</div>';
  } else if (ovGroupFilter === 'quickwins') {
    var qw = sortUCs(filtered.filter(function(e) { return e.uc.f === 'beginner' && (e.uc.c === 'critical' || e.uc.c === 'high'); }));
    currentDisplayedList = qw;
    var byCatQ = {};
    qw.forEach(function(e) {
      var k = e.cat.i;
      if (!byCatQ[k]) byCatQ[k] = { cat: e.cat, entries: [] };
      byCatQ[k].entries.push(e);
    });
    html += '<div class="ov-section"><h3 class="ov-h3">' + esc(SITE.starterListLabel || 'Quick wins') + ' (' + qw.length + ')</h3>';
    Object.values(byCatQ).forEach(function(g) {
      html += '<div class="ov-section"><div class="subcat-header">' + esc(g.cat.i + '. ' + g.cat.n) + '</div><div class="uc-grid">';
      g.entries.forEach(function(e) { html += renderUCCard(e.uc); });
      html += '</div></div>';
    });
    html += '</div>';
  } else {
    var heroCatIds = ovHeroGroupFilter ? CAT_GROUPS[ovHeroGroupFilter] : null;
    html += '<div class="c-cat-grid">';
    DATA.forEach(function(cat) {
      if (heroCatIds && heroCatIds.indexOf(cat.i) === -1) return;
      var count = filtered.filter(function(e) { return e.cat.i === cat.i; }).length;
      var totalCount = cat.s.reduce(function(a, s) { return a + s.u.length; }, 0);
      var disp = (hasAnyFilterActive() ? count : totalCount);
      if ((selectedEquipmentId || inventorySelections.length) && count === 0) return;
      var meta = CAT_META[cat.i] || {};
      html += '<div class="c-cat-card" onclick="selectCat(' + cat.i + ')"><div class="c-cat-card-head"><div class="c-cat-card-icon">' + si(meta.icon || 'globe') + '</div><div><div class="c-cat-card-title">' + esc(cat.n) + '</div>';
      html += '<div class="c-cat-card-num">' + disp + ' use cases · ' + cat.s.length + ' subcategories</div></div></div>';
      html += '<div class="c-cat-card-desc">' + esc(stripMd(meta.desc || '')) + '</div><div class="c-cat-card-footer">';
      cat.s.slice(0, 3).forEach(function(sc) { html += '<span class="c-cat-card-badge">' + esc(sc.n) + '</span>'; });
      if (cat.s.length > 3) html += '<span class="c-cat-card-badge">+' + (cat.s.length - 3) + '</span>';
      html += '</div></div>';
    });
    html += '</div>';
  }

  html += roadmapBlock();
  main.innerHTML = html;
  document.getElementById('back-btn').style.display = 'none';
  updateFilterCountNum();

  if (ovGroupFilter === 'alluc' && ucAllCardsHtml.length > 50) {
    var vc = document.getElementById('uc-virtual-container');
    if (vc) {
      ucRenderedCount = 0;
      renderUCBatch(vc, 0);
      setupUCScrollObserver(vc);
    }
  } else if (ovGroupFilter === 'alluc' && ucAllCardsHtml.length) {
    var vc2 = document.getElementById('uc-virtual-container');
    if (vc2) renderUCBatch(vc2, 0);
  }
}

function hasAnyFilterActive() {
  return selectedEquipmentId || inventorySelections.length || currentFilter !== 'all' || currentDiffFilter !== 'all' || currentPillarFilter !== 'all'
    || currentRegulationFilter !== 'all' || currentMtypeFilter !== 'all' || currentIndustryFilter !== 'all' || currentEscuFilter !== 'all'
    || currentStatusFilter !== 'all' || currentFreshFilter !== 'all'
    || currentDtypeFilter !== 'all' || currentPremiumFilter !== 'all' || currentCimFilter !== 'all' || currentSappFilter !== 'all'
    || currentMitreFilter || currentMitreTacticFilter || currentDsGroup || currentDatasourceFilter || currentTrendFilter || currentSearch;
}

function renderSearchResults() {
  window.scrollTo(0, 0);
  var main = document.getElementById('main');
  var results = getFilteredUCs();
  panelUCList = results;
  currentDisplayedList = results;
  var html = '<div class="c-search-heading">Results for <strong>' + esc(currentSearch) + '</strong> — ' + results.length + ' use cases</div>';
  html += filterStrip() + activeFilterTags();
  if (!results.length) {
    html += emptyState('No matches found');
    main.innerHTML = html;
    updateFilterCountNum();
    document.getElementById('back-btn').style.display = 'none';
    return;
  }
  var SEARCH_RENDER_CAP = 200;
  var capped = !searchShowAll && results.length > SEARCH_RENDER_CAP;
  var renderList = capped ? results.slice(0, SEARCH_RENDER_CAP) : results;
  var grouped = {};
  renderList.forEach(function(e) {
    var k = e.cat.i;
    if (!grouped[k]) grouped[k] = { cat: e.cat, rows: [] };
    grouped[k].rows.push(e);
  });
  Object.keys(grouped).sort(function(a, b) { return a - b; }).forEach(function(k) {
    var g = grouped[k];
    html += '<div class="search-cat-block"><h3 class="subcat-header">' + esc(g.cat.i + '. ' + g.cat.n) + ' <span class="subcat-count">(' + g.rows.length + ')</span></h3>';
    html += '<div class="uc-grid">';
    g.rows.forEach(function(e) { html += renderUCCard(e.uc); });
    html += '</div></div>';
  });
  if (capped) {
    html += '<div style="text-align:center;padding:20px"><button type="button" class="c-chip active" onclick="searchShowAll=true;renderSearchResults()">Show all ' + results.length + ' results</button></div>';
  }
  main.innerHTML = html;
  document.getElementById('back-btn').style.display = 'none';
  updateFilterCountNum();
}

function renderSubcategoryView() {
  window.scrollTo(0, 0);
  var cat = getCatById(currentCat);
  var main = document.getElementById('main');
  if (!cat) { goHome(); return; }
  var catFiltered = getFilteredUCs();
  panelUCList = catFiltered;
  currentDisplayedList = catFiltered;
  var totalCount = cat.s.reduce(function(a, s) { return a + s.u.length; }, 0);
  var meta = CAT_META[cat.i] || {};

  var bySubcat = {};
  catFiltered.forEach(function(e) {
    var key = e.sc.i;
    if (!bySubcat[key]) bySubcat[key] = 0;
    bySubcat[key]++;
  });

  var html = breadcrumb(cat) + filterStrip() + activeFilterTags();
  html += '<div class="c-section-header"><div class="c-section-title">' + esc(cat.n) + '</div>';
  html += '<div class="c-section-desc">' + esc(stripMd(meta.desc || '')) + '</div>';
  html += '<div style="margin-top:6px;font-size:12px;color:var(--text-tertiary)">' + cat.s.length + ' subcategories · ' + catFiltered.length + ' / ' + totalCount + ' use cases</div>';
  html += '</div>';

  html += '<div class="sc-view-grid">';
  cat.s.forEach(function(sc) {
    var scCount = bySubcat[sc.i] || 0;
    var scTotal = sc.u.length;
    var hasFilter = catFiltered.length !== totalCount;
    var displayCount = hasFilter ? scCount : scTotal;
    if (hasFilter && scCount === 0) return;

    var critCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    var entries = catFiltered.filter(function(e) { return e.sc.i === sc.i; });
    entries.forEach(function(e) { if (critCounts[e.uc.c] !== undefined) critCounts[e.uc.c]++; });

    html += '<article class="sc-view-card" onclick="goToSubcat(' + cat.i + ',\'' + String(sc.i).replace(/'/g, "\\'") + '\')">';
    html += '<div class="sc-view-card-head">';
    html += '<span class="sc-view-card-id">' + esc(String(sc.i)) + '</span>';
    html += '<h3 class="sc-view-card-name">' + esc(sc.n) + '</h3>';
    html += '<span class="sc-view-card-count">' + displayCount + ' use cases</span>';
    html += '</div>';

    html += '<div class="sc-view-card-crit">';
    if (critCounts.critical) html += '<span class="sc-crit-dot critical">' + critCounts.critical + ' Critical</span>';
    if (critCounts.high) html += '<span class="sc-crit-dot high">' + critCounts.high + ' High</span>';
    if (critCounts.medium) html += '<span class="sc-crit-dot medium">' + critCounts.medium + ' Medium</span>';
    if (critCounts.low) html += '<span class="sc-crit-dot low">' + critCounts.low + ' Low</span>';
    html += '</div>';

    var topUCs = entries.slice(0, 3);
    if (topUCs.length) {
      html += '<div class="sc-view-card-ucs">';
      topUCs.forEach(function(e) {
        html += '<div class="sc-view-uc-peek" onclick="event.stopPropagation(); openUCById(\'' + esc(e.uc.i) + '\')">';
        html += '<span class="uc-crit-dot c-' + (e.uc.c || 'low') + '"></span>';
        html += '<span class="sc-view-uc-name">' + esc(e.uc.n) + '</span></div>';
      });
      if (entries.length > 3) html += '<div class="sc-view-more">+' + (entries.length - 3) + ' more</div>';
      html += '</div>';
    }
    html += '</article>';
  });
  html += '</div>';

  html += '<div class="sc-view-showall">';
  html += '<button type="button" class="sc-view-showall-btn" onclick="showAllCategoryUCs()">';
  html += si('list') + ' Show all ' + catFiltered.length + ' use cases</button></div>';

  main.innerHTML = html;
  document.getElementById('back-btn').style.display = 'flex';
  updateFilterCountNum();
}

function goToSubcat(catId, scId) {
  currentCat = catId;
  currentSubcat = scId;
  catShowAllUCs = true;
  currentSearch = '';
  document.getElementById('search-input').value = '';
  buildSidebar();
  renderCategory();
  updateHash(false);
  closeMobileSidebar();
  setTimeout(function() {
    var el = document.getElementById('sc-' + String(scId).replace(/\./g, '_'));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 50);
}

function showAllCategoryUCs() {
  catShowAllUCs = true;
  buildSidebar();
  renderCategory();
  updateHash(false);
}

function renderCategory() {
  window.scrollTo(0, 0);
  var cat = getCatById(currentCat);
  var main = document.getElementById('main');
  if (!cat) { goHome(); return; }
  var filtered = getFilteredUCs();
  panelUCList = filtered;
  currentDisplayedList = filtered;
  var meta = CAT_META[cat.i] || {};
  var html = breadcrumb(cat) + filterStrip() + activeFilterTags();
  html += '<div class="c-section-header"><div class="c-section-title">' + esc(cat.n) + '</div><div class="c-section-desc">' + esc(stripMd(meta.desc || '')) + '</div></div>';
  if (currentSearch) {
    html += '<div class="c-search-heading">Filtered in category</div>';
    html += '<div class="uc-grid">';
    filtered.forEach(function(e) { html += renderUCCard(e.uc); });
    html += '</div>';
  } else {
    html += renderCategoryRoadmap(cat.i);
    cat.s.forEach(function(sc) {
      var scUCs = filtered.filter(function(e) { return e.sc.i === sc.i; });
      if (!scUCs.length) return;
      var sid = 'sc-' + String(sc.i).replace(/\./g, '_');
      html += '<div class="c-subcat-group" id="' + sid + '"><div class="c-subcat-title">' + esc(sc.n) + ' (' + scUCs.length + ')</div>';
      html += '<div class="uc-grid">';
      scUCs.forEach(function(e) { html += renderUCCard(e.uc); });
      html += '</div></div>';
    });
  }
  if (!filtered.length) html += emptyState('No use cases match your filters');
  main.innerHTML = html;
  document.getElementById('back-btn').style.display = 'flex';
  updateFilterCountNum();
}

function ntVizMockups(vizStr) {
  if (!vizStr) return '';
  var v = vizStr.toLowerCase();
  var panels = [];
  var cb = 'var(--cisco-blue)';
  var ct = 'var(--text-tertiary)';
  var cs = 'var(--text-secondary)';
  var cp = 'var(--text-primary)';
  var bd = 'var(--border-default)';
  var bg = 'var(--bg-page)';
  var be = 'var(--bg-elevated)';
  var cg = 'var(--cisco-green)';
  var cr = 'var(--cisco-red)';
  if (v.indexOf('line chart') !== -1 || v.indexOf('timechart') !== -1) {
    panels.push({ title: 'Trend over time', svg: '<svg viewBox="0 0 240 100" class="ntviz-svg"><rect x="0" y="0" width="240" height="100" rx="4" fill="' + bg + '"/><line x1="30" y1="10" x2="30" y2="85" stroke="' + bd + '" stroke-width="1"/><line x1="30" y1="85" x2="230" y2="85" stroke="' + bd + '" stroke-width="1"/><polyline points="35,70 65,55 95,60 125,35 155,45 185,25 215,30" fill="none" stroke="' + cb + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><polyline points="35,75 65,68 95,72 125,58 155,62 185,50 215,55" fill="none" stroke="' + ct + '" stroke-width="1.5" stroke-dasharray="4,3" stroke-linecap="round" stroke-linejoin="round" opacity="0.5"/><text x="30" y="96" fill="' + ct + '" font-size="7">Time</text></svg>' });
  }
  if (v.indexOf('area chart') !== -1) {
    panels.push({ title: 'Usage over time', svg: '<svg viewBox="0 0 240 100" class="ntviz-svg"><rect x="0" y="0" width="240" height="100" rx="4" fill="' + bg + '"/><line x1="30" y1="10" x2="30" y2="85" stroke="' + bd + '" stroke-width="1"/><line x1="30" y1="85" x2="230" y2="85" stroke="' + bd + '" stroke-width="1"/><path d="M35,70 L65,50 L95,55 L125,35 L155,40 L185,30 L215,35 L215,85 L35,85 Z" fill="rgba(4,159,217,0.2)" stroke="' + cb + '" stroke-width="2"/></svg>' });
  }
  if (v.indexOf('bar chart') !== -1 || v.indexOf('column chart') !== -1) {
    panels.push({ title: 'Comparison', svg: '<svg viewBox="0 0 240 100" class="ntviz-svg"><rect x="0" y="0" width="240" height="100" rx="4" fill="' + bg + '"/><line x1="30" y1="85" x2="230" y2="85" stroke="' + bd + '" stroke-width="1"/><rect x="45" y="30" width="22" height="55" rx="2" fill="' + cb + '" opacity="0.8"/><rect x="80" y="45" width="22" height="40" rx="2" fill="' + cb + '" opacity="0.65"/><rect x="115" y="20" width="22" height="65" rx="2" fill="' + cb + '" opacity="0.9"/><rect x="150" y="55" width="22" height="30" rx="2" fill="' + cb + '" opacity="0.5"/><rect x="185" y="40" width="22" height="45" rx="2" fill="' + cb + '" opacity="0.7"/></svg>' });
  }
  if (v.indexOf('single value') !== -1) {
    panels.push({ title: 'Current status', svg: '<svg viewBox="0 0 160 90" class="ntviz-svg ntviz-sv"><rect x="0" y="0" width="160" height="90" rx="4" fill="' + bg + '"/><text x="80" y="50" text-anchor="middle" fill="' + cb + '" font-size="28" font-weight="700">94.2%</text><text x="80" y="70" text-anchor="middle" fill="' + ct + '" font-size="9">Current value</text></svg>' });
  }
  if (v.indexOf('gauge') !== -1) {
    panels.push({ title: 'Threshold gauge', svg: '<svg viewBox="0 0 160 100" class="ntviz-svg ntviz-sv"><rect x="0" y="0" width="160" height="100" rx="4" fill="' + bg + '"/><path d="M30,75 A50,50 0 0,1 130,75" fill="none" stroke="' + bd + '" stroke-width="8" stroke-linecap="round"/><path d="M30,75 A50,50 0 0,1 110,38" fill="none" stroke="' + cb + '" stroke-width="8" stroke-linecap="round"/><text x="80" y="80" text-anchor="middle" fill="' + cp + '" font-size="14" font-weight="700">72%</text><text x="80" y="93" text-anchor="middle" fill="' + ct + '" font-size="8">of threshold</text></svg>' });
  }
  if (v.indexOf('table') !== -1) {
    panels.push({ title: 'Details table', svg: '<svg viewBox="0 0 240 100" class="ntviz-svg"><rect x="0" y="0" width="240" height="100" rx="4" fill="' + bg + '"/><rect x="10" y="10" width="220" height="14" rx="2" fill="' + cb + '" opacity="0.15"/><text x="18" y="20" fill="' + cb + '" font-size="7" font-weight="600">Host</text><text x="90" y="20" fill="' + cb + '" font-size="7" font-weight="600">Status</text><text x="160" y="20" fill="' + cb + '" font-size="7" font-weight="600">Value</text><line x1="10" y1="26" x2="230" y2="26" stroke="' + bd + '" stroke-width="0.5"/><text x="18" y="36" fill="' + cs + '" font-size="7">server-01</text><text x="90" y="36" fill="' + cg + '" font-size="7">OK</text><text x="160" y="36" fill="' + cs + '" font-size="7">23.4%</text><line x1="10" y1="40" x2="230" y2="40" stroke="' + bd + '" stroke-width="0.3"/><text x="18" y="50" fill="' + cs + '" font-size="7">server-02</text><text x="90" y="50" fill="' + cr + '" font-size="7">Warning</text><text x="160" y="50" fill="' + cs + '" font-size="7">87.1%</text><line x1="10" y1="54" x2="230" y2="54" stroke="' + bd + '" stroke-width="0.3"/><text x="18" y="64" fill="' + cs + '" font-size="7">server-03</text><text x="90" y="64" fill="' + cs + '" font-size="7">OK</text><text x="160" y="64" fill="' + cs + '" font-size="7">41.7%</text></svg>' });
  }
  if (v.indexOf('heatmap') !== -1) {
    var cells = '';
    var colors = ['rgba(4,159,217,0.15)','rgba(4,159,217,0.3)','rgba(4,159,217,0.5)','rgba(4,159,217,0.7)','rgba(4,159,217,0.9)','rgba(229,57,53,0.6)','rgba(229,57,53,0.3)'];
    for (var r = 0; r < 4; r++) { for (var c = 0; c < 8; c++) { cells += '<rect x="' + (30 + c * 25) + '" y="' + (15 + r * 18) + '" width="22" height="15" rx="2" fill="' + colors[(r * 8 + c + r * 3) % colors.length] + '"/>'; } }
    panels.push({ title: 'Heatmap', svg: '<svg viewBox="0 0 240 100" class="ntviz-svg"><rect x="0" y="0" width="240" height="100" rx="4" fill="' + bg + '"/>' + cells + '</svg>' });
  }
  if (v.indexOf('pie') !== -1 || v.indexOf('donut') !== -1) {
    panels.push({ title: 'Distribution', svg: '<svg viewBox="0 0 160 100" class="ntviz-svg ntviz-sv"><rect x="0" y="0" width="160" height="100" rx="4" fill="' + bg + '"/><circle cx="80" cy="50" r="35" fill="none" stroke="' + bd + '" stroke-width="12"/><circle cx="80" cy="50" r="35" fill="none" stroke="' + cb + '" stroke-width="12" stroke-dasharray="154 66" stroke-dashoffset="0" transform="rotate(-90 80 50)"/><circle cx="80" cy="50" r="35" fill="none" stroke="' + ct + '" stroke-width="12" stroke-dasharray="44 176" stroke-dashoffset="-154" transform="rotate(-90 80 50)" opacity="0.5"/><text x="80" y="54" text-anchor="middle" fill="' + cp + '" font-size="12" font-weight="700">70%</text></svg>' });
  }
  if (v.indexOf('status') !== -1 || v.indexOf('grid') !== -1) {
    var dots = ''; var dC = [cb,cb,cb,cr,cb,cb,cb,cb,cb,cb,cb,cb];
    for (var di = 0; di < 12; di++) { dots += '<circle cx="' + (30 + (di % 6) * 34) + '" cy="' + (30 + Math.floor(di / 6) * 34) + '" r="10" fill="' + dC[di] + '" opacity="0.8"/>'; }
    panels.push({ title: 'Status grid', svg: '<svg viewBox="0 0 240 100" class="ntviz-svg"><rect x="0" y="0" width="240" height="100" rx="4" fill="' + bg + '"/>' + dots + '</svg>' });
  }
  if (v.indexOf('timeline') !== -1) {
    panels.push({ title: 'Event timeline', svg: '<svg viewBox="0 0 240 80" class="ntviz-svg"><rect x="0" y="0" width="240" height="80" rx="4" fill="' + bg + '"/><line x1="20" y1="40" x2="220" y2="40" stroke="' + bd + '" stroke-width="1.5"/><circle cx="40" cy="40" r="5" fill="' + cb + '"/><circle cx="85" cy="40" r="5" fill="' + cb + '"/><circle cx="110" cy="40" r="5" fill="' + cr + '"/><circle cx="150" cy="40" r="5" fill="' + cb + '"/><circle cx="200" cy="40" r="5" fill="' + cb + '"/><text x="40" y="55" text-anchor="middle" fill="' + ct + '" font-size="6">09:00</text><text x="110" y="55" text-anchor="middle" fill="' + cr + '" font-size="6">11:42</text><text x="200" y="55" text-anchor="middle" fill="' + ct + '" font-size="6">16:30</text></svg>' });
  }
  if (panels.length === 0) {
    panels.push({ title: 'Dashboard overview', svg: '<svg viewBox="0 0 320 140" class="ntviz-svg"><rect x="0" y="0" width="320" height="140" rx="4" fill="' + bg + '"/><rect x="8" y="8" width="94" height="40" rx="3" fill="' + be + '" stroke="' + bd + '" stroke-width="0.5"/><text x="55" y="28" text-anchor="middle" fill="' + cb + '" font-size="14" font-weight="700">247</text><text x="55" y="40" text-anchor="middle" fill="' + ct + '" font-size="6">Events</text><rect x="110" y="8" width="94" height="40" rx="3" fill="' + be + '" stroke="' + bd + '" stroke-width="0.5"/><text x="157" y="28" text-anchor="middle" fill="' + cp + '" font-size="14" font-weight="700">99.4%</text><text x="157" y="40" text-anchor="middle" fill="' + ct + '" font-size="6">Availability</text><rect x="212" y="8" width="100" height="40" rx="3" fill="' + be + '" stroke="' + bd + '" stroke-width="0.5"/><text x="262" y="28" text-anchor="middle" fill="' + cr + '" font-size="14" font-weight="700">3</text><text x="262" y="40" text-anchor="middle" fill="' + ct + '" font-size="6">Alerts</text><rect x="8" y="56" width="200" height="76" rx="3" fill="' + be + '" stroke="' + bd + '" stroke-width="0.5"/><line x1="28" y1="70" x2="28" y2="120" stroke="' + bd + '" stroke-width="0.5"/><line x1="28" y1="120" x2="195" y2="120" stroke="' + bd + '" stroke-width="0.5"/><polyline points="35,110 60,100 85,105 110,88 135,92 160,80 185,84" fill="none" stroke="' + cb + '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><text x="108" y="68" text-anchor="middle" fill="' + ct + '" font-size="6">Trend over time</text><rect x="216" y="56" width="96" height="76" rx="3" fill="' + be + '" stroke="' + bd + '" stroke-width="0.5"/><text x="264" y="68" text-anchor="middle" fill="' + ct + '" font-size="6">By host</text><rect x="228" y="76" width="72" height="8" rx="1" fill="' + bd + '"/><rect x="228" y="76" width="58" height="8" rx="1" fill="' + cb + '" opacity="0.7"/><rect x="228" y="88" width="72" height="8" rx="1" fill="' + bd + '"/><rect x="228" y="88" width="44" height="8" rx="1" fill="' + cb + '" opacity="0.5"/><rect x="228" y="100" width="72" height="8" rx="1" fill="' + bd + '"/><rect x="228" y="100" width="30" height="8" rx="1" fill="' + cb + '" opacity="0.4"/><rect x="228" y="112" width="72" height="8" rx="1" fill="' + bd + '"/><rect x="228" y="112" width="18" height="8" rx="1" fill="' + cr + '" opacity="0.6"/></svg>' });
  }
  var html = '<div class="ntviz-panels">';
  panels.forEach(function(p) { html += '<div class="ntviz-panel"><div class="ntviz-panel-title">' + esc(p.title) + '</div>' + p.svg + '</div>'; });
  html += '</div>';
  return html;
}
function currentSplunkLocale() {
  var match = window.location.pathname.match(/^\/([^/]+)\/(?:static|app)\//);
  return match ? match[1] : '';
}

function canOpenInSplunkSearch() {
  return !!currentSplunkLocale();
}

function looksLikeSplunkSearch(text, language) {
  var query = String(text || '').trim();
  var lang = String(language || '').toLowerCase();
  if (!query) return false;
  if (lang === 'spl' || lang === 'splunk' || lang === 'search' || lang === 'tstats') return true;
  if (lang && lang !== 'text' && lang !== 'txt' && lang !== 'plain') return false;
  return /(^\s*(?:\||search\b|tstats\b|mstats\b|from\b|index=|sourcetype=|source=|host=))/i.test(query);
}

function codeActionButtonsHtml(includeSearch) {
  var html = '<div class="code-actions">';
  if (includeSearch && canOpenInSplunkSearch()) {
    html += '<button type="button" class="copy-btn search-btn" onclick="openSplunkSearch(this)">Open in Splunk Search</button>';
  }
  html += '<button type="button" class="copy-btn" onclick="copyCode(this)">Copy</button>';
  html += '</div>';
  return html;
}

function requestSplunkHostAction(type, payload) {
  if (!window.parent || window.parent === window) return false;
  try {
    var message = payload || {};
    message.source = 'monitoring_use_cases';
    message.type = type;
    window.parent.postMessage(message, window.location.origin);
    return true;
  } catch (e) {
    return false;
  }
}

function splunkSearchUrl(query, earliest, latest) {
  var locale = currentSplunkLocale();
  if (!locale) return null;
  return '/' + locale
    + '/app/search/search?q=' + encodeURIComponent(String(query || ''))
    + '&earliest=' + encodeURIComponent(String(earliest || '-24h'))
    + '&latest=' + encodeURIComponent(String(latest || 'now'));
}

function openSplunkSearchQuery(query, earliest, latest) {
  var cleanedQuery = String(query || '').trim();
  var url = splunkSearchUrl(cleanedQuery, earliest, latest);
  if (!cleanedQuery || !url) return false;
  if (requestSplunkHostAction('open-search', {
    query: cleanedQuery,
    earliest: earliest || '-24h',
    latest: latest || 'now'
  })) {
    return true;
  }
  window.top.location.assign(url);
  return true;
}

function openSplunkSearch(btn) {
  var wrap = btn.closest ? btn.closest('.code-wrap') : null;
  var pre = wrap ? wrap.querySelector('pre') : null;
  var originalLabel = btn.textContent;
  if (!pre || !openSplunkSearchQuery(pre.textContent)) return;
  btn.textContent = 'Opening...';
  setTimeout(function() { btn.textContent = originalLabel; }, 1500);
}

function fillPanelBody(e) {
  var uc = e.uc;
  var html = '<div class="c-panel-meta">';
  html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Criticality</div>' + critBadge(uc.c) + '</div>';
  html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Difficulty</div>' + diffBadge(uc.f) + '</div>';
  if (uc.wv && WAVE_LABELS[uc.wv]) html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Wave</div>' + waveBadge(uc.wv) + '</div>';
  if (uc.mtype && uc.mtype.length) html += '<div class="c-panel-meta-item full"><div class="c-panel-meta-label">Monitoring type</div><div>' + esc(uc.mtype.join(', ')) + '</div></div>';
  if (uc.pillar) html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Pillar</div><div>' + esc(uc.pillar) + '</div></div>';
  if (uc.status) html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Status</div><div><span class="uc-card-status ' + esc(uc.status) + '">' + esc(uc.status) + '</span></div></div>';
  var panelProvCode = (window.PROVENANCE && window.PROVENANCE[uc.i]) || null;
  if (panelProvCode) {
    var panelProvLabel = (window.PROVENANCE_LABELS && window.PROVENANCE_LABELS[panelProvCode]) || 'Source';
    html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Source</div><div><span class="uc-card-prov prov-' + esc(panelProvCode) + '" title="Source classification">' + esc(panelProvLabel) + '</span></div></div>';
  }
  if (uc.reviewed) html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Last reviewed</div><div>' + esc(uc.reviewed) + ' ' + freshChipHtml(uc.reviewed) + '</div></div>';
  if (uc.sver) html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Splunk versions</div><div>' + esc(uc.sver) + '</div></div>';
  if (uc.rby) html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Reviewer</div><div>' + esc(uc.rby) + '</div></div>';
  if (uc.ind) html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Industry</div><div>' + esc(uc.ind) + '</div></div>';
  if (uc.sdomain) html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Security domain</div><div>' + esc(uc.sdomain) + '</div></div>';
  if (uc.dtype) html += '<div class="c-panel-meta-item"><div class="c-panel-meta-label">Detection type</div><div>' + esc(uc.dtype) + '</div></div>';
  html += '</div>';

  html += renderImplementationOrdering(uc);

  if (uc.mitre && uc.mitre.length) {
    html += '<div class="c-panel-section"><div class="c-panel-section-title">MITRE ATT&CK</div><div class="c-panel-section-body">';
    uc.mitre.forEach(function(tid) {
      html += '<button type="button" class="linkish" onclick="filterByMitreId(\'' + esc(tid) + '\')">' + esc(tid) + '</button> ';
    });
    html += '</div></div>';
  }
  if (uc.regs && uc.regs.length) {
    html += '<div class="c-panel-section"><div class="c-panel-section-title">Regulations</div><div class="c-panel-section-body">';
    uc.regs.forEach(function(r) {
      html += '<button type="button" class="linkish" onclick="filterByRegEnc(\'' + encodeURIComponent(r).replace(/'/g, '%27') + '\')">' + esc(r) + '</button> ';
    });
    html += '</div></div>';
  }
  // Phase 3a — clause-level compliance table. Renders the structured
  // ``uc.cmp[]`` projection when the UC sidecar has one (v1.6.0 schema,
  // ~1,395 UCs at the time of writing). Columns reflect the three
  // audiences the redesign targets:
  //   * Clause  — what the regulator asks for (auditor/buyer anchor)
  //   * Mode    — satisfies / detects-violation-of / assists-with
  //   * Assurance — full / partial / contributing
  //   * Control objective — implementer-facing "what this UC actually does"
  //   * Evidence artefact — auditor-facing "what you can hand to the audit"
  // UCs with a flat ``regs[]`` but no ``cmp[]`` continue to show only
  // the flat chip list above, so no regression for pre-Phase-1 UCs.
  if (Array.isArray(uc.cmp) && uc.cmp.length) {
    html += '<div class="c-panel-section"><div class="c-panel-section-title">Compliance clauses</div><div class="c-panel-section-body">';
    html += '<div class="uc-compliance-table-wrap"><table class="uc-compliance-table">';
    html += '<thead><tr>';
    html += '<th scope="col">Regulation</th>';
    html += '<th scope="col">Clause</th>';
    html += '<th scope="col">Mode</th>';
    html += '<th scope="col">Assurance</th>';
    html += '<th scope="col">Control objective</th>';
    html += '<th scope="col">Evidence artefact</th>';
    html += '</tr></thead><tbody>';
    uc.cmp.forEach(function(row) {
      if (!row) return;
      var canonical = (row.v || '') + '#' + (row.cl || '');
      var regEnc = encodeURIComponent(row.r || '').replace(/'/g, '%27');
      var clauseEnc = encodeURIComponent(canonical).replace(/'/g, '%27');
      var clauseCell = esc(row.cl || '');
      if (row.u) {
        // Deep-link to the regulator's own clause page when the sidecar
        // provided one. External links always open in a new tab with
        // noopener/noreferrer per OWASP link guidance — the catalogue
        // is hosted on GitHub Pages and must not leak referrer data.
        clauseCell = '<a href="' + esc(row.u) + '" target="_blank" rel="noopener noreferrer" title="Open in new tab">' + clauseCell + '</a>';
      }
      if (row.v) clauseCell += ' <span class="uc-compliance-ver">(' + esc(row.v) + ')</span>';
      html += '<tr>';
      html += '<td><button type="button" class="linkish" onclick="filterByRegEnc(\'' + regEnc + '\')">' + esc(row.r || '') + '</button></td>';
      html += '<td>' + clauseCell + ' <button type="button" class="linkish uc-compliance-filter-clause" title="Filter catalogue by this clause" onclick="filterByClauseEnc(\'' + regEnc + '\',\'' + clauseEnc + '\')">filter</button></td>';
      html += '<td>' + (row.m ? '<span class="uc-compliance-mode mode-' + esc(row.m) + '">' + esc(row.m) + '</span>' : '') + '</td>';
      html += '<td>' + (row.a ? '<span class="uc-compliance-assurance assurance-' + esc(row.a) + '">' + esc(row.a) + '</span>' : '') + '</td>';
      html += '<td>' + (row.co ? esc(row.co) : '<span class="uc-compliance-missing">—</span>') + '</td>';
      html += '<td>' + (row.ea ? esc(row.ea) : '<span class="uc-compliance-missing">—</span>') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    html += '<div class="uc-compliance-footnote">Clauses without a control objective or evidence artefact are flagged for SME review (Phase 4 migration).</div>';
    html += '</div></div>';
  }
  if (uc.a && uc.a.length) {
    html += '<div class="c-panel-section"><div class="c-panel-section-title">CIM models</div><div class="c-panel-section-body">';
    uc.a.forEach(function(m) {
      var u = cimDocUrl(m);
      html += '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(m) + '</a> ';
    });
    html += '</div></div>';
  }
  if (uc.v) html += '<div class="c-panel-section"><div class="c-panel-section-title">Value</div><div class="c-panel-section-body">' + esc(stripMd(uc.v)) + '</div></div>';

  html += '<div class="c-panel-section"><div class="c-panel-section-title">App / TA</div><div class="c-panel-section-body">';
  var taText = uc.t ? stripMd(uc.t) : '';
  if (uc.ta_link && uc.ta_link.url) {
    html += '<a href="' + esc(uc.ta_link.url) + '" target="_blank" rel="noopener" class="splunk-app-link ta-card">';
    html += '<span class="splunk-ta-icon">' + si('data') + '</span>';
    html += '<span class="splunk-ta-info"><span class="splunk-ta-label">Technology Add-on</span>';
    html += '<strong>' + esc(uc.ta_link.name || taText) + '</strong>';
    if (taText && uc.ta_link.name) html += '<span class="splunk-app-desc">' + esc(taText) + '</span>';
    html += '</span><span class="splunk-app-arrow">' + si('external') + '</span></a>';
  } else if (taText) {
    html += '<div class="splunk-ta-card">';
    html += '<span class="splunk-ta-icon">' + si('data') + '</span>';
    html += '<span class="splunk-ta-info"><span class="splunk-ta-label">Data Input / Add-on</span>';
    html += '<strong>' + esc(taText) + '</strong></span></div>';
  }
  if (uc.sapp && uc.sapp.length) {
    uc.sapp.forEach(function(app) {
      var id = typeof app === 'object' && app != null ? app.id : app;
      var name = typeof app === 'object' && app && app.name ? app.name : ('Splunkbase #' + id);
      var u = typeof app === 'object' && app && app.url ? app.url : ('https://splunkbase.splunk.com/app/' + id);
      var desc = typeof app === 'object' && app && app.desc ? app.desc : '';
      html += '<a href="' + esc(u) + '" target="_blank" rel="noopener" class="splunk-app-link app-card">';
      html += '<span class="splunk-app-icon">' + si('monitorChart') + '</span>';
      html += '<span class="splunk-app-info"><span class="splunk-app-label">Splunkbase App</span>';
      html += '<strong>' + esc(name) + '</strong>';
      if (desc) html += '<span class="splunk-app-desc">' + esc(desc) + '</span>';
      html += '</span><span class="splunk-app-arrow">' + si('external') + '</span></a>';
      if (typeof app === 'object' && Array.isArray(app.predecessor) && app.predecessor.length) {
        html += '<div class="predecessor-note-box">Replaces ';
        app.predecessor.forEach(function(p, pi) {
          if (pi > 0) html += ', ';
          var pUrl = typeof p === 'object' && p.url ? p.url : '#';
          var pName = typeof p === 'object' && p.name ? p.name : String(p);
          html += '<a href="' + esc(pUrl) + '" target="_blank" rel="noopener">' + esc(pName) + '</a>';
        });
        html += ' (archived on Splunkbase). The underlying TA/Add-on still works for data collection.</div>';
      }
    });
  }
  html += '</div></div>';

  if (uc.d) html += '<div class="c-panel-section"><div class="c-panel-section-title">Data sources</div><div class="c-panel-section-body"><code>' + esc(stripMd(uc.d)) + '</code></div></div>';
  if (uc.e && uc.e.length) {
    html += '<div class="c-panel-section"><div class="c-panel-section-title">Equipment</div><div class="c-panel-section-body">';
    uc.e.forEach(function(eid) { var eq = _eqById[eid]; html += esc(eq ? eq.label : eid) + '<br>'; });
    html += '</div></div>';
  }
  if (uc.em && uc.em.length) {
    html += '<div class="c-panel-section"><div class="c-panel-section-title">Equipment models</div><div class="c-panel-section-body">';
    uc.em.forEach(function(mid) { html += esc(mid) + '<br>'; });
    html += '</div></div>';
  }
  if (uc.premium) html += '<div class="c-panel-section"><div class="c-panel-section-title">Premium Apps</div><div class="c-panel-section-body">' + esc(uc.premium) + '</div></div>';
  if (uc.reqf) html += '<div class="c-panel-section"><div class="c-panel-section-title">Required fields</div><div class="c-panel-section-body"><code>' + esc(uc.reqf) + '</code></div></div>';
  if (uc.schema) html += '<div class="c-panel-section"><div class="c-panel-section-title">Schema</div><div class="c-panel-section-body"><code>' + esc(uc.schema) + '</code></div></div>';

  function copyBlock(label, text, id, includeSearch) {
    if (!text) return '';
    return '<div class="c-panel-section"><div class="c-panel-section-title">' + label + '</div><div class="code-wrap">'
      + codeActionButtonsHtml(includeSearch)
      + '<pre class="c-spl-block" id="' + id + '">' + esc(text) + '</pre></div></div>';
  }
  html += copyBlock('SPL query', uc.q, 'copy-q', looksLikeSplunkSearch(uc.q, 'spl'));
  html += copyBlock('tstats query', uc.qs, 'copy-qs', looksLikeSplunkSearch(uc.qs, 'tstats'));
  html += copyBlock('Script example', uc.script, 'copy-script', false);

  if (uc.m) html += '<div class="c-panel-section"><div class="c-panel-section-title">Implementation</div><div class="c-panel-section-body">' + esc(stripMd(uc.m)) + '</div></div>';
  if (uc.md) html += '<details class="c-panel-details"><summary>Detailed implementation</summary><div class="c-panel-section-body">' + renderDetailBody(uc.md) + '</div></details>';
  if (uc.kfp) html += '<div class="c-panel-section"><div class="c-panel-section-title">Known false positives</div><div class="c-panel-section-body">' + esc(stripMd(uc.kfp)) + '</div></div>';
  if (uc.refs) html += '<div class="c-panel-section"><div class="c-panel-section-title">References</div><div class="c-panel-section-body">' + esc(stripMd(uc.refs)) + '</div></div>';
  if (uc.dma) html += '<div class="c-panel-section"><div class="c-panel-section-title">Data model acceleration</div><div class="c-panel-section-body">' + esc(stripMd(uc.dma)) + '</div></div>';
  if (uc.z) {
    html += '<div class="c-panel-section"><div class="c-panel-section-title">Visualization</div><div class="c-panel-section-body">' + esc(stripMd(uc.z)) + '</div>';
    var hasScreenshots = false;
    if (Array.isArray(uc.sapp) && uc.sapp.length) {
      var allScreenshots = [];
      uc.sapp.forEach(function(app) {
        if (typeof app === 'object' && Array.isArray(app.screenshots) && app.screenshots.length) {
          app.screenshots.forEach(function(s) { allScreenshots.push({src: s, app: app.name || '', url: app.url || '#'}); });
        }
      });
      if (allScreenshots.length) {
        hasScreenshots = true;
        html += '<div class="app-screenshots-section">';
        html += '<div class="app-screenshots-title">App Dashboard Examples</div>';
        html += '<div class="app-screenshots-grid">';
        allScreenshots.forEach(function(s) {
          html += '<a href="' + esc(s.url) + '" target="_blank" rel="noopener" class="app-screenshot-card" title="' + esc(s.app) + ' — View on Splunkbase">';
          html += '<img src="' + esc(s.src) + '" alt="' + esc(s.app) + ' dashboard screenshot" loading="lazy">';
          html += '<span class="app-screenshot-label">' + esc(s.app) + '</span></a>';
        });
        html += '</div></div>';
      }
    }
    if (!hasScreenshots && typeof ntVizMockups === 'function') {
      html += '<div class="app-screenshots-section">';
      html += '<div class="app-screenshots-title">Example Dashboard Layout</div>';
      html += ntVizMockups(uc.z);
      html += '</div>';
    }
    html += '</div>';
  }
  if (uc.tuc) html += '<div class="c-panel-section"><div class="c-panel-section-title">Telco use case</div><div class="c-panel-section-body">' + esc(stripMd(uc.tuc)) + '</div></div>';

  html += '<div class="c-panel-gh"><a class="c-btn c-btn-secondary" href="' + esc(githubIssueUrlForEntry(e)) + '" target="_blank" rel="noopener">Report issue on GitHub</a></div>';
  document.getElementById('panel-body').innerHTML = html;
}

function openPanel(idx) {
  panelIdx = idx;
  var e = panelUCList[idx];
  if (!e) return;
  panelOpen = true;
  document.getElementById('panel-id').textContent = 'UC-' + e.uc.i + ' · ' + e.cat.n + ' · ' + e.sc.n;
  document.getElementById('panel-title').textContent = e.uc.n;

  // Render whatever stub data we have immediately so the panel feels
  // responsive, then lazy-fetch the per-category JSON to merge in heavy
  // fields (full SPL, narrative, references, screenshots) and re-render.
  fillPanelBody(e);
  var pos = document.getElementById('panel-pos');
  if (pos) pos.textContent = (idx + 1) + ' / ' + panelUCList.length;
  document.getElementById('panel-backdrop').classList.add('open');
  document.body.classList.add('panel-open');
  buildSidebar();
  history.replaceState(null, '', '#uc-' + e.uc.i);

  if (typeof window.__ensureFullUC === 'function') {
    var ucIdAtOpen = e.uc.i;
    window.__ensureFullUC(e.uc.i).then(function() {
      // Bail if the user navigated away before the fetch resolved.
      if (!panelOpen || panelIdx !== idx) return;
      var current = panelUCList[panelIdx];
      if (!current || current.uc.i !== ucIdAtOpen) return;
      fillPanelBody(current);
    }).catch(function() { /* loader already logged */ });
  }
}

function closePanel() {
  document.getElementById('panel-backdrop').classList.remove('open');
  document.body.classList.remove('panel-open');
  panelOpen = false;
  updateHash(true);
}

function navPanel(dir) {
  var n = panelIdx + dir;
  if (n >= 0 && n < panelUCList.length) openPanel(n);
}

function copyCode(btn) {
  var wrap = btn.closest ? btn.closest('.code-wrap') : btn.parentElement;
  var pre = wrap.querySelector('pre');
  var t = pre ? pre.textContent : '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(function() {
      btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
    }).catch(function() { _fallbackCopy(t, btn); });
  } else { _fallbackCopy(t, btn); }
}
function _fallbackCopy(text, btn) {
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); btn.textContent = 'Copied!'; } catch (e) { btn.textContent = 'Failed'; }
  document.body.removeChild(ta);
  setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
}

function filterByMitreId(id) {
  closePanel();
  currentMitreFilter = id;
  currentMitreTacticFilter = '';
  currentCat = null;
  currentSearch = '';
  document.getElementById('search-input').value = '';
  reRender();
  updateHash(false);
}

function filterByReg(r) {
  closePanel();
  currentRegulationFilter = r;
  currentClauseFilter = 'all';
  currentCat = null;
  currentSearch = '';
  document.getElementById('search-input').value = '';
  reRender();
  updateHash(false);
}

function filterByRegEnc(enc) {
  try { filterByReg(decodeURIComponent(enc)); } catch (e) {}
}

function filterByClause(reg, clauseCanonical) {
  // Jumps straight into the catalogue filtered by one specific
  // (regulation, version, clause) tuple. Used by the clause-filter
  // button on the UC detail panel's compliance table so an auditor
  // reading "UC-X covers GDPR Art.5" can click through and see
  // every other UC that also covers GDPR Art.5 without manually
  // re-selecting both dropdowns. The regulation dropdown's
  // ``onchange`` normally clears the clause filter, so we set
  // regulation first and clause second.
  closePanel();
  currentRegulationFilter = reg;
  currentClauseFilter = clauseCanonical || 'all';
  currentCat = null;
  currentSearch = '';
  var siEl = document.getElementById('search-input');
  if (siEl) siEl.value = '';
  reRender();
  updateHash(false);
}

function filterByClauseEnc(regEnc, clauseEnc) {
  try { filterByClause(decodeURIComponent(regEnc), decodeURIComponent(clauseEnc)); } catch (e) {}
}

function openUCById(id) {
  panelUCList = currentDisplayedList.length ? currentDisplayedList : getFilteredUCs();
  var idx = panelUCList.findIndex(function(e) { return String(e.uc.i) === String(id); });
  if (idx < 0) {
    var entry = ucIndex[id];
    if (!entry) return;
    panelUCList = allUCs;
    idx = entry.flatIdx;
  }
  openPanel(idx);
}

function openMitreMap() {
  var body = document.getElementById('mitre-map-body');
  if (!body || !FILTER_FACETS.mitre) return;
  var filtered = getFilteredUCs();
  var isFiltered = filtered.length < allUCs.length;
  var techCounts = {};
  filtered.forEach(function(e) {
    if (Array.isArray(e.uc.mitre)) e.uc.mitre.forEach(function(t) { techCounts[t] = (techCounts[t] || 0) + 1; });
  });
  var html = '';
  if (isFiltered) html += '<div class="mitre-filtered-note">Showing counts for ' + filtered.length + ' filtered use cases</div>';
  html += '<div class="mitre-map-grid">';
  FILTER_FACETS.mitre.forEach(function(group) {
    var techSet = {};
    group.techniques.forEach(function(t) { techSet[t.id] = true; });
    var tacticCount = 0;
    filtered.forEach(function(e) {
      if (Array.isArray(e.uc.mitre) && e.uc.mitre.some(function(t) { return techSet[t]; })) tacticCount++;
    });
    html += '<div class="mitre-map-col"><div class="mitre-map-tactic" onclick="mapSelectTactic(\'' + esc(group.tactic) + '\')"><span class="mm-count">' + tacticCount + '</span>' + esc(group.label) + '</div>';
    group.techniques.forEach(function(t) {
      var c = techCounts[t.id] || 0;
      html += '<div class="mitre-map-tech' + (c === 0 ? ' zero' : '') + '" onclick="mapSelectTech(\'' + esc(t.id) + '\')"><span class="mm-tc">' + c + '</span> ' + esc(t.id) + ' ' + esc(t.name || '') + '</div>';
    });
    html += '</div>';
  });
  html += '</div>';
  body.innerHTML = html;
  document.getElementById('mitre-map-overlay').classList.add('open');
  document.body.classList.add('overlay-open');
}

function closeMitreMap() {
  document.getElementById('mitre-map-overlay').classList.remove('open');
  _maybeClearOverlayClass();
}

function mapSelectTactic(tactic) {
  closeMitreMap();
  currentMitreTacticFilter = tactic;
  currentMitreFilter = '';
  reRender();
  updateHash(false);
}

function mapSelectTech(id) {
  closeMitreMap();
  currentMitreFilter = id;
  currentMitreTacticFilter = '';
  reRender();
  updateHash(false);
}
var _srcBuilt = false;
function buildSourceCatalog() {
  if (_srcBuilt) return;
  _srcBuilt = true;
  var b = document.getElementById('src-body');
  var h = '';

  function badge(s) { return '<span class="src-badge ' + s + '">' + s.charAt(0).toUpperCase() + s.slice(1) + '</span>'; }
  function link(url, label) { return '<a href="https://' + url + '" target="_blank" rel="noopener noreferrer">' + (label || url) + '</a>'; }

  h += '<div class="src-section"><div class="src-section-head">Splunk Official Documentation &amp; Portals</div>';

  h += '<div class="src-group"><div class="src-group-title">Splunk Lantern</div>';
  h += '<table class="src-table"><tr><th>Section</th><th>Status</th><th>Notes</th></tr>';
  [['lantern.splunk.com/Security_Use_Cases','Security Use Cases','used','Threat Investigation, Security Monitoring, Compliance, Threat Hunting'],
   ['lantern.splunk.com/Security_Use_Cases/Compliance','Security &mdash; Compliance','used','PCI DSS, HIPAA, GDPR, NERC CIP, MiFID II'],
   ['lantern.splunk.com/Security_Use_Cases/Threat_Hunting','Security &mdash; Threat Hunting','used','Cisco SNA + ES + RBA integration'],
   ['lantern.splunk.com/Security/UCE','Security &mdash; Use Case Explorer','used','Foundational Visibility, Security Monitoring, Advanced Threat Detection'],
   ['lantern.splunk.com/Observability_Use_Cases','Observability Use Cases','used','Optimize Performance, Troubleshoot, Monitor Business'],
   ['lantern.splunk.com/Observability/Product_Tips/Infrastructure_Monitoring','Observability &mdash; Infrastructure Monitoring','used','VMware, AWS RDS, K8s, PostgreSQL, HPA'],
   ['lantern.splunk.com/Industry_Use_Cases/Financial_Services_and_Insurance','Industry &mdash; Financial Services','used','Fraud Analytics, Behavioral Profiling, Data Compliance'],
   ['lantern.splunk.com/Industry_Use_Cases/Public_Sector','Industry &mdash; Public Sector','used','FedRAMP, CMMC, FISMA, CJIS'],
   ['lantern.splunk.com/Splunk_and_Cisco_Use_Cases','Splunk &amp; Cisco Use Cases','used','Identity Intelligence, switches/routers/WLAN, gRPC'],
   ['lantern.splunk.com/Data_Descriptors','Data Descriptors','used','Data source best practices and TA links'],
  ].forEach(function(r) {
    h += '<tr><td>' + link(r[0], r[1]) + '</td><td>' + badge(r[2]) + '</td><td>' + r[3] + '</td></tr>';
  });
  h += '</table></div>';

  h += '<div class="src-group"><div class="src-group-title">Splunk Security Content (ESCU)</div>';
  h += '<table class="src-table"><tr><th>Source</th><th>Status</th><th>Notes</th></tr>';
  [['research.splunk.com/stories','Analytic Stories','used','2,000+ detections across 300+ stories'],
   ['research.splunk.com/stories/tactics','Stories by MITRE Tactic','used','ATT&CK-mapped detections'],
   ['research.splunk.com/stories/source','Stories by Data Source','used','Mapped to TAs and sourcetypes'],
   ['github.com/splunk/security_content','GitHub: security_content','used','Raw YAML detections, contentctl tool'],
  ].forEach(function(r) {
    h += '<tr><td>' + link(r[0], r[1]) + '</td><td>' + badge(r[2]) + '</td><td>' + r[3] + '</td></tr>';
  });
  h += '</table></div>';

  h += '<div class="src-group"><div class="src-group-title">Splunk Documentation &amp; Blogs</div>';
  h += '<table class="src-table"><tr><th>Source</th><th>Status</th><th>Notes</th></tr>';
  [['docs.splunk.com/Documentation/CIM/latest','CIM Manual','used','CIM data model reference'],
   ['docs.splunk.com/Documentation/ITSI/latest','ITSI Docs','used','Service modeling, KPIs, Glass Tables'],
   ['docs.splunk.com/Documentation/ES/latest','Enterprise Security Docs','used','Notable events, correlation searches'],
   ['docs.splunk.com/Documentation/EdgeHub','Edge Hub Docs','used','MQTT, OPC-UA, Modbus via Edge Hub'],
   ['splunk.com/en_us/blog/security','Security Blog','used','ESCU updates, threat research, detection stories'],
   ['splunk.com/en_us/blog/observability','Observability Blog','used','DORA operational resilience, APM'],
   ['community.splunk.com','Splunk Community (Answers)','used','User-contributed SPL, troubleshooting'],
  ].forEach(function(r) {
    h += '<tr><td>' + link(r[0], r[1]) + '</td><td>' + badge(r[2]) + '</td><td>' + r[3] + '</td></tr>';
  });
  h += '</table></div>';
  h += '</div>';

  h += '<div class="src-section"><div class="src-section-head">Splunkbase Apps &amp; Technology Add-ons</div>';

  h += '<div class="src-group"><div class="src-group-title">Core Platform TAs</div>';
  h += '<table class="src-table"><tr><th>TA / App</th><th>Approx. UCs</th><th>Categories</th></tr>';
  [['Splunk Security Essentials (SSE) &amp; ES Content Update (ESCU)','~2,074','10.2&ndash;10.9'],
   ['Splunk Add-on for Microsoft Windows','~210','1, 2, 6, 8, 9'],
   ['Splunk Add-on for Unix and Linux','~141','1'],
   ['Splunk Add-on for Amazon Web Services (AWS)','~230','4, 6, 7, 10, 20'],
   ['Splunk Add-on for Microsoft Cloud Services','~121','4, 7, 9, 10, 11'],
   ['Splunk Add-on for Google Cloud Platform','~51','4, 7'],
   ['Splunk Add-on for VMware','~89','2, 10, 18, 19'],
   ['Splunk Add-on for ServiceNow','~33','5, 16, 20, 22, 23'],
   ['Splunk Add-on for Palo Alto Networks','~80','5, 10, 17'],
   ['Fortinet FortiGate Add-On for Splunk','~66','5, 10, 17'],
   ['Splunk Add-on for Okta Identity Cloud','~48','9, 10'],
   ['Splunk Add-on for Google Workspace','~25','10, 11'],
   ['Splunk Add-on for Cisco Identity Services (ISE)','~45','5, 10, 11, 17'],
  ].forEach(function(r) {
    h += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>';
  });
  h += '</table></div>';

  h += '<div class="src-group"><div class="src-group-title">Cisco TAs</div>';
  h += '<table class="src-table"><tr><th>TA / App</th><th>Splunkbase</th><th>Categories</th></tr>';
  [['Cisco Meraki Add-on for Splunk','5580','5.1, 5.2, 5.4, 5.8, 14.1, 15.3'],
   ['Cisco ThousandEyes App for Splunk','7719','5.9, 11.3'],
   ['Cisco Security Cloud','7404','5.2, 9.5, 10.1, 10.7, 17.2'],
   ['Cisco Catalyst Add-on for Splunk','7538','5.5, 15.3'],
  ].forEach(function(r) {
    h += '<tr><td>' + r[0] + '</td><td>' + link('splunkbase.splunk.com/app/' + r[1], '#' + r[1]) + '</td><td>' + r[2] + '</td></tr>';
  });
  h += '</table></div>';

  h += '<div class="src-group"><div class="src-group-title">Security Vendor TAs</div>';
  h += '<table class="src-table"><tr><th>Vendor</th><th>Approx. UCs</th><th>Categories</th></tr>';
  [['Palo Alto Networks','~84','5.2, 10.1, 10.6, 10.11, 17.2, 17.3'],
   ['Fortinet (FortiGate/FortiManager)','~66','5.2, 10.1, 10.11, 17.2, 17.3'],
   ['Check Point','~56','5.2, 10.11, 13.3, 17.3'],
   ['CrowdStrike','~484','10.2, 10.3, 10.6, 10.7, 10.11'],
   ['Carbon Black','~24','10.3, 10.7, 10.11'],
   ['Tanium','~13','10.11, 10.16'],
   ['Tenable','~17','10.6, 10.11, 22.2'],
   ['Zscaler','~35','10.5, 10.11, 17.3'],
  ].forEach(function(r) {
    h += '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td>' + r[2] + '</td></tr>';
  });
  h += '</table></div>';
  h += '</div>';

  h += '<div class="src-section"><div class="src-section-head">Frameworks &amp; Standards</div>';
  h += '<table class="src-table"><tr><th>Framework</th><th>Status</th><th>Usage</th></tr>';
  [['attack.mitre.org','MITRE ATT&CK Enterprise','used','Mapped in 10.2&ndash;10.7 via ESCU'],
   ['attack.mitre.org/techniques/ics','MITRE ATT&CK for ICS','used','OT Security detections in 10.14'],
   ['pcisecuritystandards.org','PCI DSS v4.0','used','10.12.7, 10.12.15'],
   ['hhs.gov/hipaa','HIPAA Security Rule','used','10.12.16&ndash;30'],
   ['csrc.nist.gov/publications/detail/sp/800-53/rev-5/final','NIST 800-53 Rev 5','used','10.12.41'],
   ['nerc.com/pa/Stand/Pages/CIPStandards.aspx','NERC CIP Standards','used','14.2.11 + planned expansion'],
   ['gdpr-info.eu','GDPR Full Text','used','22.1'],
   ['eur-lex.europa.eu','NIS2 Directive','used','22.2'],
   ['eur-lex.europa.eu','DORA Regulation','used','22.3'],
  ].forEach(function(r) {
    h += '<tr><td>' + link(r[0], r[1]) + '</td><td>' + badge(r[2]) + '</td><td>' + r[3] + '</td></tr>';
  });
  h += '</table></div>';

  h += '<div class="src-section"><div class="src-section-head">External &amp; Vendor Documentation</div>';
  h += '<table class="src-table"><tr><th>Source</th><th>Status</th><th>Notes</th></tr>';
  [   ['docs.thousandeyes.com','Cisco ThousandEyes Docs','used','OTel Data Model v2 metrics, Splunk integration'],
   ['elastic.co/guide/en/elasticsearch/reference/current/monitor-elasticsearch-cluster.html','Elasticsearch Cluster Monitoring','used','Cluster health, node stats, shard allocation, ILM, CCR'],
   ['learn.microsoft.com/en-us/azure/azure-monitor/','Azure Monitor Docs','used','Activity Log, metrics, diagnostics for 15+ Azure services'],
   ['docs.docker.com/engine/daemon/prometheus','Docker Monitoring Docs','used','Daemon metrics, health checks, events API, system df'],
   ['opcfoundation.org','OPC Foundation','used','OPC-UA in 14.5'],
   ['modbus.org','Modbus.org','used','Modbus protocol in 14.2'],
   ['docs.zeek.org','Zeek ICS Protocol Analyzers','used','Protocol-specific ICS detections'],
   ['github.com/cisagov/ICSNPP','CISA ICSNPP Parsers','used','Zeek ICS protocol parsers'],
  ].forEach(function(r) {
    h += '<tr><td>' + link(r[0], r[1]) + '</td><td>' + badge(r[2]) + '</td><td>' + r[3] + '</td></tr>';
  });
  h += '</table></div>';

  h += '<div class="src-section"><div class="src-section-head">Splunk Solutions &amp; Industry Pages</div>';
  h += '<table class="src-table"><tr><th>Page</th><th>Status</th><th>Notes</th></tr>';
  [['splunk.com/en_us/solutions/compliance.html','Compliance','used','GDPR, PCI, HIPAA, compliance automation'],
   ['splunk.com/solutions/industries/financial-services','Financial Services','used','Fraud, AML, operational resilience'],
   ['splunk.com/solutions/industries/public-sector','Public Sector','used','FedRAMP, CMMC'],
   ['splunk.com/solutions/industries/energy-and-utilities','Energy &amp; Utilities','used','OT monitoring, grid security'],
   ['splunk.com/solutions/industries/healthcare','Healthcare','used','EHR monitoring, HIPAA'],
   ['splunk.com/solutions/industries/manufacturing','Manufacturing','used','OT visibility, predictive maintenance'],
  ].forEach(function(r) {
    h += '<tr><td>' + link(r[0], r[1]) + '</td><td>' + badge(r[2]) + '</td><td>' + r[3] + '</td></tr>';
  });
  h += '</table></div>';

  b.innerHTML = h;
}

function openSourceCatalog() {
  buildSourceCatalog();
  document.getElementById('src-overlay').classList.add('open');
  document.body.classList.add('overlay-open');
}
function closeSourceCatalog() {
  document.getElementById('src-overlay').classList.remove('open');
  _maybeClearOverlayClass();
}
function openReleaseNotes() {
  document.getElementById('rn-overlay').classList.add('open');
  document.body.classList.add('overlay-open');
}
function closeReleaseNotes() {
  document.getElementById('rn-overlay').classList.remove('open');
  _maybeClearOverlayClass();
}
function _maybeClearOverlayClass() {
  if (!document.getElementById('src-overlay').classList.contains('open') && !document.getElementById('rn-overlay').classList.contains('open')
    && !document.getElementById('inv-overlay').classList.contains('open') && !document.getElementById('mitre-map-overlay').classList.contains('open')
    && !document.getElementById('help-overlay').classList.contains('open') && !panelOpen)
    document.body.classList.remove('overlay-open');
}

var HELP_BANNER_KEY = 'umc.helpBannerDismissed';
var HELP_TABS = ['web', 'api', 'ai', 'packs', 'tools'];

function renderHelpBanner() {
  try { if (localStorage.getItem(HELP_BANNER_KEY) === '1') return ''; } catch (e) {}
  return '<div class="c-help-banner" role="region" aria-label="Getting started" id="help-banner">' +
    '<div class="c-help-banner-ico" aria-hidden="true">?</div>' +
    '<div class="c-help-banner-text"><strong>New here?</strong>' +
    'Learn how to find use cases fast, pull them via the JSON API, and ground AI agents in the catalog.</div>' +
    '<button type="button" class="c-help-banner-cta" onclick="openHelpGuide()">Show me how &rarr;</button>' +
    '<button type="button" class="c-help-banner-close" onclick="dismissHelpBanner()" aria-label="Dismiss">&times;</button>' +
    '</div>';
}

function dismissHelpBanner() {
  try { localStorage.setItem(HELP_BANNER_KEY, '1'); } catch (e) {}
  var el = document.getElementById('help-banner');
  if (el && el.parentNode) el.parentNode.removeChild(el);
}

function openHelpGuide(tab) {
  var id = (tab && HELP_TABS.indexOf(tab) !== -1) ? tab : 'web';
  switchHelpTab(id);
  document.getElementById('help-overlay').classList.add('open');
  document.body.classList.add('overlay-open');
  setTimeout(function() {
    var btn = document.querySelector('#help-overlay .help-tab-btn.active');
    if (btn) btn.focus();
  }, 0);
}

function closeHelpGuide() {
  document.getElementById('help-overlay').classList.remove('open');
  _maybeClearOverlayClass();
  if ((location.hash || '').replace(/^#/, '').indexOf('help') === 0) {
    history.replaceState(null, '', '#overview');
  }
}

function switchHelpTab(id) {
  if (HELP_TABS.indexOf(id) === -1) id = 'web';
  var root = document.getElementById('help-overlay');
  if (!root) return;
  root.querySelectorAll('.help-tab-btn').forEach(function(b) {
    var active = b.getAttribute('data-tab') === id;
    b.classList.toggle('active', active);
    b.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  root.querySelectorAll('.help-tab-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'help-panel-' + id);
  });
  var bd = root.querySelector('.c-modal-bd');
  if (bd) bd.scrollTop = 0;
}

var _invUCCounts = {};
function _invComputeUCCounts() {
  _invUCCounts = {};
  allUCs.forEach(function(e) {
    (e.uc.e || []).forEach(function(eid) { _invUCCounts[eid] = (_invUCCounts[eid] || 0) + 1; });
    (e.uc.em || []).forEach(function(mid) { _invUCCounts[mid] = (_invUCCounts[mid] || 0) + 1; });
  });
}
function _invDsaCount(id) {
  var m = window.DSA_EQUIPMENT_MAP;
  return (m && m[id]) ? m[id].filter(function(s) { return s; }).length : 0;
}
function _invBuildBody(filterText) {
  var ft = (filterText || '').toLowerCase().trim();
  if (!Object.keys(_invUCCounts).length) _invComputeUCCounts();
  var html = '';
  var totalGroups = 0;
  EQUIPMENT_GROUPS.forEach(function(grp, gi) {
    var items = [];
    grp.ids.forEach(function(eid) {
      var eq = _eqById[eid];
      if (!eq) return;
      var matchesFilter = !ft || eq.label.toLowerCase().indexOf(ft) !== -1 || eq.id.toLowerCase().indexOf(ft) !== -1;
      var modelMatches = [];
      if (eq.models) eq.models.forEach(function(m) {
        var mid = eq.id + '_' + m.id;
        if (!ft || m.label.toLowerCase().indexOf(ft) !== -1 || mid.toLowerCase().indexOf(ft) !== -1 || matchesFilter) modelMatches.push(m);
      });
      if (matchesFilter || modelMatches.length) items.push({ eq: eq, modelMatches: modelMatches.length && !matchesFilter ? modelMatches : eq.models, matchesFilter: matchesFilter });
    });
    if (!items.length) return;
    totalGroups++;
    var grpSelectedCount = 0;
    items.forEach(function(it) {
      if (_invTempSelections.has(it.eq.id)) grpSelectedCount++;
      if (it.eq.models) it.eq.models.forEach(function(m) { if (_invTempSelections.has(it.eq.id + '_' + m.id)) grpSelectedCount++; });
    });
    var grpCountBadge = grpSelectedCount > 0 ? '<span class="inv-group-count">' + grpSelectedCount + '</span>' : '';
    html += '<div class="inv-group' + (ft ? ' open' : '') + '" data-grp="' + gi + '">'
      + '<div class="inv-group-header" onclick="invToggleGroup(this)">'
      + '<span class="inv-chevron">&#9654;</span>'
      + '<span style="flex:1">' + esc(grp.name) + '</span>'
      + grpCountBadge
      + '<button type="button" class="inv-selall" onclick="event.stopPropagation();invToggleGroupAll(' + gi + ')">Select all</button>'
      + '</div>'
      + '<div class="inv-items" data-grp-items="' + gi + '">';
    items.forEach(function(it) {
      var checked = _invTempSelections.has(it.eq.id);
      var dsaCnt = _invDsaCount(it.eq.id);
      var ucCnt = _invUCCounts[it.eq.id] || 0;
      var modelCnt = it.eq.models ? it.eq.models.length : 0;
      html += '<div class="inv-card' + (checked ? ' selected' : '') + '" onclick="invCardClick(event,\'' + it.eq.id + '\')">'
        + '<div class="inv-card-cb"><input type="checkbox" data-inv-id="' + it.eq.id + '"' + (checked ? ' checked' : '') + ' onchange="invItemChg(this)" onclick="event.stopPropagation()"></div>'
        + '<div class="inv-card-info">'
        + '<div class="inv-card-name">' + esc(it.eq.label) + '</div>'
        + '<div class="inv-card-meta">';
      if (ucCnt > 0) html += '<span class="inv-card-tag ucs">' + ucCnt + ' use case' + (ucCnt !== 1 ? 's' : '') + '</span>';
      if (dsaCnt > 0) html += '<span class="inv-card-tag dsa">' + dsaCnt + ' data source' + (dsaCnt !== 1 ? 's' : '') + '</span>';
      if (modelCnt > 0) html += '<span class="inv-card-tag models">' + modelCnt + ' model' + (modelCnt !== 1 ? 's' : '') + '</span>';
      html += '</div></div></div>';
      if (it.eq.models && it.modelMatches && it.modelMatches.length) {
        html += '<div class="inv-models-drawer">';
        it.modelMatches.forEach(function(m) {
          var mid = it.eq.id + '_' + m.id;
          var mc = _invTempSelections.has(mid);
          var mDsa = _invDsaCount(mid);
          var mUc = _invUCCounts[mid] || 0;
          html += '<div class="inv-model-row"><label>'
            + '<input type="checkbox" data-inv-id="' + mid + '"' + (mc ? ' checked' : '') + ' onchange="invItemChg(this)">'
            + esc(m.label)
            + '</label>';
          if (mUc > 0) html += '<span class="inv-card-tag ucs">' + mUc + ' UCs</span>';
          if (mDsa > 0) html += '<span class="inv-card-tag dsa">' + mDsa + ' src</span>';
          html += '</div>';
        });
        html += '</div>';
      }
    });
    html += '</div></div>';
  });
  if (!totalGroups) {
    return '<div style="text-align:center;padding:40px 20px;color:var(--text-tertiary);">'
      + '<div style="font-size:32px;margin-bottom:12px;">🔍</div>'
      + '<div style="font-size:14px;font-weight:600;">No equipment matches &ldquo;' + esc(ft) + '&rdquo;</div>'
      + '<div style="font-size:12px;margin-top:4px;">Try a different search term</div></div>';
  }
  return html;
}

function _invUpdateFooter() {
  var n = _invTempSelections.size;
  document.getElementById('inv-footer-count').textContent = n + ' selected';
  var dsaTotal = 0;
  _invTempSelections.forEach(function(id) { dsaTotal += _invDsaCount(id); });
  var dsaEl = document.getElementById('inv-footer-dsa');
  if (dsaEl) dsaEl.textContent = dsaTotal > 0 ? '(' + dsaTotal + ' data source' + (dsaTotal !== 1 ? 's' : '') + ' for sizing)' : '';
  var btn = document.getElementById('inv-estimate-btn');
  if (btn) btn.disabled = dsaTotal === 0;
}
function openInventoryModal() {
  _invTempSelections = new Set(inventorySelections);
  document.getElementById('inv-body').innerHTML = _invBuildBody('');
  document.getElementById('inv-search').value = '';
  _invUpdateFooter();
  document.getElementById('inv-overlay').classList.add('open');
  document.body.classList.add('overlay-open');
}
function closeInventoryModal() {
  document.getElementById('inv-overlay').classList.remove('open');
  _maybeClearOverlayClass();
}
function invToggleGroup(headerEl) {
  var group = headerEl.closest('.inv-group');
  if (group) group.classList.toggle('open');
}
function invToggleGroupAll(gi) {
  var grp = EQUIPMENT_GROUPS[gi];
  if (!grp) return;
  var allIds = [];
  grp.ids.forEach(function(eid) {
    var eq = _eqById[eid];
    if (!eq) return;
    allIds.push(eq.id);
    if (eq.models) eq.models.forEach(function(m) { allIds.push(eq.id + '_' + m.id); });
  });
  var allOn = allIds.every(function(id) { return _invTempSelections.has(id); });
  allIds.forEach(function(id) { if (allOn) _invTempSelections.delete(id); else _invTempSelections.add(id); });
  document.getElementById('inv-body').innerHTML = _invBuildBody(document.getElementById('inv-search').value.trim());
  _invUpdateFooter();
}
function invCardClick(ev, id) {
  if (ev.target.tagName === 'INPUT' || ev.target.tagName === 'BUTTON') return;
  var cb = ev.currentTarget.querySelector('input[type="checkbox"]');
  if (cb) { cb.checked = !cb.checked; invItemChg(cb); }
}
function invItemChg(cb) {
  var id = cb.getAttribute('data-inv-id');
  if (cb.checked) _invTempSelections.add(id); else _invTempSelections.delete(id);
  var card = cb.closest('.inv-card');
  if (card) { if (cb.checked) card.classList.add('selected'); else card.classList.remove('selected'); }
  _invUpdateFooter();
}
function applyInventory() {
  inventorySelections = Array.from(_invTempSelections);
  _saveInventory();
  _updateInventoryBadge();
  selectedEquipmentId = '';
  var es = document.getElementById('equipment-select');
  var ms = document.getElementById('equipment-model-select');
  var mw = document.getElementById('equipment-model-wrap');
  if (es) es.value = '';
  if (ms) ms.innerHTML = '<option value="">All models</option>';
  if (mw) mw.style.display = 'none';
  closeInventoryModal();
  _updateSizingTray();
  if (inventorySelections.length) ovGroupFilter = 'alluc';
  reRender();
}
function clearInventory() {
  _invTempSelections.clear();
  document.getElementById('inv-body').innerHTML = _invBuildBody(document.getElementById('inv-search').value.trim());
  _invUpdateFooter();
}
function exportInventory() {
  var data = { equipment: Array.from(_invTempSelections), updated: new Date().toISOString().slice(0, 10) };
  var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'splunk-inventory-' + data.updated + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function importInventory() { document.getElementById('inv-file-input').click(); }

function exportFiltered(fmt) {
  var list = currentDisplayedList || getFilteredUCs();
  if (!list.length) { showToast('No use cases match the current filters.'); return; }
  var date = new Date().toISOString().slice(0, 10);
  if (fmt === 'json') {
    var rows = list.map(function(e) {
      return {
        id: e.uc.i, title: e.uc.n, category: e.cat.n, subcategory: e.sc.n,
        criticality: e.uc.c, difficulty: e.uc.f,
        monitoring_type: Array.isArray(e.uc.mtype) ? e.uc.mtype.join(', ') : '',
        app_ta: e.uc.t, value: e.uc.v
      };
    });
    var blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
    _downloadBlob(blob, 'splunk-use-cases-' + date + '.json');
  } else {
    var header = ['ID','Title','Category','Subcategory','Criticality','Difficulty','Monitoring Type','App/TA','Value'];
    var lines = [header.join(',')];
    list.forEach(function(e) {
      var row = [
        e.uc.i, _csvQ(e.uc.n), _csvQ(e.cat.n), _csvQ(e.sc.n),
        e.uc.c, e.uc.f,
        _csvQ(Array.isArray(e.uc.mtype) ? e.uc.mtype.join('; ') : ''),
        _csvQ(e.uc.t), _csvQ(e.uc.v)
      ];
      lines.push(row.join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    _downloadBlob(blob, 'splunk-use-cases-' + date + '.csv');
  }
}
function _csvQ(s) {
  if (!s) return '""';
  return '"' + String(s).replace(/"/g, '""') + '"';
}
function showToast(msg) {
  var el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:var(--text-primary,#1a1a1a);color:#fff;padding:10px 20px;border-radius:8px;font-size:13px;z-index:9999;opacity:0;transition:opacity .3s;pointer-events:none;'; document.body.appendChild(el); }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(el._t); el._t = setTimeout(function() { el.style.opacity = '0'; }, 3000);
}
function _downloadBlob(blob, name) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _dataSizingURL(query) {
  var base = window.__SITE_BASE_PATH || '';
  var path = base + '/tools/data-sizing/index.html';
  return query ? path + '?' + query : path;
}

function launchDSAFromInventory() {
  var dsaSet = new Set();
  var eqMap = window.DSA_EQUIPMENT_MAP || {};
  _invTempSelections.forEach(function(eqId) {
    var sources = eqMap[eqId];
    if (sources) sources.forEach(function(s) { if (s) dsaSet.add(s); });
  });
  if (dsaSet.size === 0) return;
  var params = ['sources=' + Array.from(dsaSet).join(',')];
  var eqIds = Array.from(_invTempSelections);
  if (eqIds.length) params.push('equipment=' + eqIds.join(','));
  window.open(_dataSizingURL(params.join('&')), '_blank');
}

function updateHash(replace) {
  var hash = '#overview';
  if (document.getElementById('panel-backdrop').classList.contains('open')) return;
  if (currentSearch) hash = '#search=' + encodeURIComponent(currentSearch);
  else if (currentCat != null) {
    hash = '#cat-' + currentCat;
    if (currentSubcat) hash += '/' + currentSubcat;
  } else if (currentRegulationFilter && currentRegulationFilter !== 'all') {
    // Phase 3b — regulation- and clause-scoped view. Persisted into
    // the URL fragment so ``clause-navigator.html`` deep links and
    // browser back/forward both restore the same filtered catalogue
    // state. Clause value is kept in its canonical ``{v}#{c}`` form
    // but URL-encoded so the embedded ``#`` doesn't terminate the
    // fragment prematurely.
    hash = '#reg=' + encodeURIComponent(currentRegulationFilter);
    if (currentClauseFilter && currentClauseFilter !== 'all') {
      hash += '&clause=' + encodeURIComponent(currentClauseFilter);
    }
  } else if (ovGroupFilter !== 'all') hash = '#' + ovGroupFilter;
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
}

function restoreFromHash() {
  var h = (location.hash || '').replace(/^#/, '');
  var hm = h.match(/^help(?:=([a-z]+))?$/);
  if (hm) {
    currentCat = null; currentSubcat = null; currentSearch = ''; ovGroupFilter = 'all'; ovHeroGroupFilter = null;
    document.getElementById('search-input').value = '';
    reRender();
    openHelpGuide(hm[1] || 'web');
    return;
  }
  if (!h || h === 'overview') {
    currentCat = null; currentSubcat = null; currentSearch = ''; ovGroupFilter = 'all'; ovHeroGroupFilter = null;
    document.getElementById('search-input').value = '';
    reRender();
    return;
  }
  var sm = h.match(/^search=(.+)/);
  if (sm) {
    currentSearch = decodeURIComponent(sm[1]);
    currentCat = null;
    document.getElementById('search-input').value = currentSearch;
    reRender();
    return;
  }
  if (['alluc','subcats','quickwins','recent'].indexOf(h) !== -1) {
    currentCat = null; currentSearch = ''; ovGroupFilter = h;
    document.getElementById('search-input').value = '';
    reRender();
    return;
  }
  var cm = h.match(/^cat-(\d+)(?:\/(.+))?$/);
  if (cm) {
    var catId = parseInt(cm[1], 10);
    if (cm[2]) {
      currentCat = catId;
      currentSubcat = cm[2];
      catShowAllUCs = true;
      currentSearch = '';
      document.getElementById('search-input').value = '';
      reRender();
      setTimeout(function() { scrollToSubcat(cm[2]); }, 80);
    } else {
      selectCat(catId, true);
    }
    return;
  }
  var um = h.match(/^uc-([\d.]+)/);
  if (um) {
    openUCById(um[1]);
    buildSidebar();
    return;
  }
  // Deep-link from the clause navigator (Phase 3b) or from third-party
  // evidence packs. Two shapes are accepted:
  //
  //   #reg=<regName>
  //   #reg=<regName>&clause=<version>#<clause>
  //
  // <regName> is URL-encoded; <clause> uses the canonical
  // ``{version}#{clause}`` form the catalogue stores internally but
  // with the embedded ``#`` also URL-encoded so it survives as a
  // single URL-fragment param. The auditor/buyer flow expects the
  // catalogue to land on the filtered view with the dropdowns
  // pre-populated — no further clicks needed to see coverage.
  var regM = h.match(/^reg=([^&]+)(?:&clause=(.+))?$/);
  if (regM) {
    var regVal;
    try { regVal = decodeURIComponent(regM[1]); } catch (_) { regVal = regM[1]; }
    currentRegulationFilter = regVal;
    if (regM[2]) {
      try { currentClauseFilter = decodeURIComponent(regM[2]); }
      catch (_) { currentClauseFilter = regM[2]; }
    } else {
      currentClauseFilter = 'all';
    }
    currentCat = null; currentSubcat = null; currentSearch = '';
    var siEl = document.getElementById('search-input');
    if (siEl) siEl.value = '';
    reRender();
  }
}

function goHome() {
  currentCat = null; currentSubcat = null; catShowAllUCs = false; currentSearch = '';
  ovHeroGroupFilter = null; ovGroupFilter = 'all';
  document.getElementById('search-input').value = '';
  currentFilter = 'all'; currentDiffFilter = 'all'; currentIndustryFilter = 'all'; currentMtypeFilter = 'all';
  currentPillarFilter = 'all'; currentRegulationFilter = 'all'; currentEscuFilter = 'all'; currentDtypeFilter = 'all';
  currentPremiumFilter = 'all'; currentCimFilter = 'all'; currentSappFilter = 'all'; currentMitreFilter = '';
  currentStatusFilter = 'all'; currentFreshFilter = 'all';
  currentMitreTacticFilter = ''; currentDsGroup = ''; currentDatasourceFilter = ''; currentTrendFilter = false;
  selectedEquipmentId = '';
  var es = document.getElementById('equipment-select');
  var ms = document.getElementById('equipment-model-select');
  var mw = document.getElementById('equipment-model-wrap');
  if (es) es.value = '';
  if (ms) ms.innerHTML = '<option value="">All models</option>';
  if (mw) mw.style.display = 'none';
  inventorySelections = [];
  try { localStorage.removeItem(INVENTORY_STORAGE_KEY); } catch (e) {}
  _updateInventoryBadge();
  advFiltersOpen = false;
  reRender();
  updateHash(false);
}

function selectCat(id, skipHash) {
  sidebarManualToggle = false;
  currentCat = id;
  currentSubcat = null;
  catShowAllUCs = false;
  currentSearch = '';
  document.getElementById('search-input').value = '';
  reRender();
  if (!skipHash) updateHash(false);
  closeMobileSidebar();
}

function setNonTechnicalView(on) {
  nonTechnicalView = on;
  try { localStorage.setItem('cisco-ui-nontech', on ? '1' : '0'); } catch (e) {}
  document.body.classList.toggle('non-technical-view', on);
  var bT = document.getElementById('view-tech');
  var bN = document.getElementById('view-nontech');
  if (bT) { bT.classList.toggle('active', !on); bT.setAttribute('aria-pressed', String(!on)); }
  if (bN) { bN.classList.toggle('active', on); bN.setAttribute('aria-pressed', String(on)); }
  document.querySelectorAll('.technical-only').forEach(function(el) { el.style.display = on ? 'none' : ''; });
  reRender();
}

function renderNonTechnicalOverview() {
  window.scrollTo(0, 0);
  var nt = window.NON_TECHNICAL || {};
  var main = document.getElementById('main');
  var totalUCs = allUCs.length;
  var totalSubs = DATA.reduce(function(a, c) { return a + c.s.length; }, 0);
  var html = '<div class="nt-hero"><h2>Monitoring outcomes</h2><p>Plain-language view of what we watch across your environment.</p>';
  html += '<div class="nt-stats"><div><strong>' + DATA.length + '</strong><span>Areas</span></div><div><strong>' + totalSubs + '</strong><span>Focus topics</span></div><div><strong>' + totalUCs.toLocaleString() + '</strong><span>Checks</span></div></div>';
  html += '<div style="margin-top:12px"><input type="text" id="nt-search" placeholder="Search outcomes\u2026" oninput="filterNTCards(this.value)" style="width:100%;max-width:400px;padding:8px 12px;border-radius:8px;border:1px solid var(--border-subtle);font-size:14px;background:var(--bg-card);color:var(--text-primary)"></div>';
  html += '</div>';
  html += '<div class="c-cat-grid" id="nt-grid">';
  DATA.forEach(function(cat) {
    var block = nt[String(cat.i)];
    if (!block) return;
    var text = (block.outcomes || []).join(' ') + ' ' + (block.areas || []).map(function(a) {
      return a.name + ' ' + (a.description || '') + ' ' + (a.whatItIs || '') + ' ' + (a.whoItAffects || '') + ' ' + (a.splunkValue || '') + ' ' + (a.ucs || []).map(function(u) { return u.why; }).join(' ');
    }).join(' ');
    html += '<div class="c-cat-card nt-card" data-nt-text="' + esc(text.toLowerCase()) + '" onclick="selectCat(' + cat.i + ')"><h3>' + esc(cat.n) + '</h3>';
    (block.outcomes || []).forEach(function(o) { html += '<p class="nt-out">' + esc(o) + '</p>'; });
    html += '</div>';
  });
  html += '</div>';
  main.innerHTML = html;
  document.getElementById('back-btn').style.display = 'none';
}

function filterNTCards(q) {
  q = q.toLowerCase().trim();
  var cards = document.querySelectorAll('#nt-grid .nt-card');
  cards.forEach(function(c) { c.style.display = (!q || (c.getAttribute('data-nt-text') || '').indexOf(q) !== -1) ? '' : 'none'; });
}
var NTV_REPO_BASE = 'https://github.com/fenre/splunk-monitoring-use-cases/blob/main/';
function ntResolveLink(relativePath) {
  if (!relativePath) return '';
  var s = String(relativePath);
  if (/^https?:\/\//i.test(s)) return s;
  s = s.replace(/^\/+/, '');
  // Route regulatory primer paths to the dashboard-styled reader so the
  // plain-language content renders in a design-system-matching view with
  // navigation, search, dark mode, and print support instead of GitHub's
  // raw markdown view. Anchors are preserved so per-section links still work.
  var primerMatch = s.match(/^docs\/regulatory-primer\.md(#.*)?$/);
  if (primerMatch) {
    return 'regulatory-primer.html' + (primerMatch[1] || '');
  }
  return NTV_REPO_BASE + s;
}
function renderNonTechnicalCategory(catId) {
  window.scrollTo(0, 0);
  var cat = getCatById(catId);
  var block = (window.NON_TECHNICAL || {})[String(catId)];
  var main = document.getElementById('main');
  if (!cat || !block) { renderNonTechnicalOverview(); return; }
  var html = '<div class="c-section-header"><div class="c-section-title">' + esc(cat.n) + '</div></div><div class="nt-areas">';
  (block.areas || []).forEach(function(ar) {
    html += '<div class="nt-area"><h4>' + esc(ar.name) + '</h4><p>' + esc(ar.description || '') + '</p>';
    var hasMeta = ar.whatItIs || ar.whoItAffects || ar.splunkValue;
    if (hasMeta) {
      html += '<dl class="nt-area-meta">';
      if (ar.whatItIs)      html += '<div><dt>What it is</dt><dd>' + esc(ar.whatItIs) + '</dd></div>';
      if (ar.whoItAffects)  html += '<div><dt>Who it affects</dt><dd>' + esc(ar.whoItAffects) + '</dd></div>';
      if (ar.splunkValue)   html += '<div><dt>How Splunk helps</dt><dd>' + esc(ar.splunkValue) + '</dd></div>';
      html += '</dl>';
    }
    var hasLinks = ar.primer || ar.evidencePack;
    if (hasLinks) {
      html += '<div class="nt-area-links">';
      if (ar.primer)        html += '<a href="' + esc(ntResolveLink(ar.primer)) + '" title="Open this section of the regulatory primer">Regulatory primer &rarr;</a>';
      if (ar.evidencePack)  html += '<a href="' + esc(ntResolveLink(ar.evidencePack)) + '" target="_blank" rel="noopener noreferrer" title="Open the auditor evidence pack in a new tab">Evidence pack &rarr;</a>';
      html += '</div>';
    }
    html += '<ul>';
    (ar.ucs || []).forEach(function(u) {
      html += '<li><strong>' + esc(u.id) + '</strong> — ' + esc(u.why || '') + '</li>';
    });
    html += '</ul></div>';
  });
  html += '</div>';
  main.innerHTML = html;
  document.getElementById('back-btn').style.display = 'flex';
}

function reRender() {
  buildSidebar();
  if (nonTechnicalView) {
    if (currentCat == null) renderNonTechnicalOverview();
    else renderNonTechnicalCategory(currentCat);
    return;
  }
  if (currentSearch) renderSearchResults();
  else if (currentCat != null) {
    if (catShowAllUCs) renderCategory();
    else renderSubcategoryView();
  }
  else renderOverview();
}

function populateEquipmentSelect() {
  var sel = document.getElementById('equipment-select');
  if (!sel) return;
  var html = '<option value="">All equipment</option>';
  (EQUIPMENT || []).slice().sort(function(a, b) { return a.label.localeCompare(b.label); }).forEach(function(eq) {
    html += '<option value="' + esc(eq.id) + '">' + esc(eq.label) + '</option>';
  });
  sel.innerHTML = html;
}

function onEquipmentChange() {
  var val = (document.getElementById('equipment-select').value || '').trim();
  var eq = val ? _eqById[val] : null;
  var mw = document.getElementById('equipment-model-wrap');
  var ms = document.getElementById('equipment-model-select');
  if (eq && eq.models && eq.models.length) {
    mw.style.display = 'flex';
    ms.innerHTML = '<option value="">All models</option>';
    eq.models.forEach(function(m) { ms.innerHTML += '<option value="' + esc(m.id) + '">' + esc(m.label) + '</option>'; });
    selectedEquipmentId = val;
  } else {
    mw.style.display = 'none';
    ms.innerHTML = '<option value="">All models</option>';
    selectedEquipmentId = val;
  }
  if (inventorySelections.length) { inventorySelections = []; _saveInventory(); _updateInventoryBadge(); }
  reRender();
}

function onModelChange() {
  var eqVal = (document.getElementById('equipment-select').value || '').trim();
  var modelVal = (document.getElementById('equipment-model-select').value || '').trim();
  selectedEquipmentId = eqVal + (modelVal ? '_' + modelVal : '');
  if (inventorySelections.length) { inventorySelections = []; _saveInventory(); _updateInventoryBadge(); }
  reRender();
}

/* Text size: 5 steps -2..+2 */
var TEXT_KEY = 'uc-text-size-step';
var TEXT_STEPS = [-2, -1, 0, 1, 2];
function applyTextSizeStep(step) {
  var s = Math.max(-2, Math.min(2, parseInt(step, 10) || 0));
  document.documentElement.style.fontSize = (15 + s) + 'px';
  try { localStorage.setItem(TEXT_KEY, String(s)); } catch (e) {}
}
function textSizeDelta(d) {
  var cur = 0;
  try { cur = parseInt(localStorage.getItem(TEXT_KEY) || '0', 10) || 0; } catch (e2) {}
  applyTextSizeStep(cur + d);
}

function toggleColorblind() {
  var on = document.getElementById('cb-toggle').checked;
  document.documentElement.classList.toggle('cb-friendly', on);
  try { localStorage.setItem('uc-colorblind-friendly', on ? '1' : '0'); } catch (e) {}
}

function toggleTheme() {
  document.documentElement.classList.toggle('dark');
  var d = document.documentElement.classList.contains('dark');
  try { localStorage.setItem('cisco-ui-theme', d ? 'dark' : 'light'); } catch (e) {}
  document.getElementById('theme-label').textContent = d ? 'Light' : 'Dark';
  var ico = document.getElementById('theme-ico');
  if (ico) ico.textContent = d ? '☀' : '☾';
}

document.addEventListener('click', function(ev) {
  var w = document.getElementById('mitre-dd-wrap');
  if (w && !w.contains(ev.target)) {
    var dd = document.getElementById('mitre-dd');
    if (dd) { dd.classList.remove('open'); var b = dd.previousElementSibling; if (b) b.classList.remove('open'); }
  }
});

function isInputFocused() {
  var el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
}

/* ─── UC Selection & DSA Integration ─── */
function _saveUCSelections() {
  try {
    if (selectedUCIds.size > 0) {
      localStorage.setItem(UC_SELECTION_STORAGE_KEY, JSON.stringify(Array.from(selectedUCIds)));
    } else {
      localStorage.removeItem(UC_SELECTION_STORAGE_KEY);
    }
  } catch (e) {}
}

function _restoreUCSelections() {
  try {
    var raw = localStorage.getItem(UC_SELECTION_STORAGE_KEY);
    if (raw) {
      var arr = JSON.parse(raw);
      if (Array.isArray(arr)) selectedUCIds = new Set(arr);
    }
  } catch (e) {}
}

function toggleUCSelection(ucId) {
  if (selectedUCIds.has(ucId)) {
    selectedUCIds.delete(ucId);
  } else {
    selectedUCIds.add(ucId);
  }
  _saveUCSelections();
  _updateSizingTray();
  var cb = document.querySelector('.uc-card input[onchange*="' + ucId + '"]');
  if (cb) cb.checked = selectedUCIds.has(ucId);
}

function clearUCSelections() {
  selectedUCIds.clear();
  _saveUCSelections();
  inventorySelections = [];
  _saveInventory();
  _updateInventoryBadge();
  selectedEquipmentId = '';
  var es = document.getElementById('equipment-select');
  var ms = document.getElementById('equipment-model-select');
  var mw = document.getElementById('equipment-model-wrap');
  if (es) es.value = '';
  if (ms) ms.innerHTML = '<option value="">All models</option>';
  if (mw) mw.style.display = 'none';
  _updateSizingTray();
  document.querySelectorAll('.uc-select-cb input[type="checkbox"], .uc-tbl-cb input[type="checkbox"]').forEach(function(cb) { cb.checked = false; });
  reRender();
}

function _updateSizingTray() {
  var tray = document.getElementById('uc-sizing-tray');
  if (!tray) return;
  var count = selectedUCIds.size;
  var invCount = inventorySelections.length;
  var hasSelection = count > 0 || invCount > 0;
  tray.classList.toggle('has-selection', hasSelection);
  var countEl = tray.querySelector('.uc-sizing-tray-count');
  var estimateBtn = tray.querySelector('.uc-sizing-tray-btn.primary');
  var clearBtn = tray.querySelector('.uc-sizing-tray-btn.ghost');
  if (countEl) {
    if (hasSelection) {
      var parts = [];
      if (count > 0) parts.push(count + ' use case' + (count !== 1 ? 's' : ''));
      if (invCount > 0) parts.push(invCount + ' equipment');
      var dsaSources = buildDSASources();
      var hasDsaSources = dsaSources.size > 0;
      var ucsMapped = 0, ucsUnmapped = 0;
      var ucMap = window.DSA_UC_MAP || {};
      selectedUCIds.forEach(function(ucId) {
        if (ucMap[ucId] && ucMap[ucId].length) ucsMapped++; else ucsUnmapped++;
      });
      var summary = parts.join(' + ') + ' selected';
      if (hasDsaSources) {
        summary += ' \u2014 ' + dsaSources.size + ' data source' + (dsaSources.size !== 1 ? 's' : '') + ' for sizing';
      }
      countEl.innerHTML = summary;
      if (!hasDsaSources && count > 0 && invCount === 0) {
        countEl.innerHTML += '<br><span style="font-size:11px;color:var(--text-tertiary);font-weight:400">'
          + 'These use cases don\u2019t have data sources mapped yet. Add equipment via '
          + '<a href="#" onclick="event.preventDefault();openInventoryModal()" style="color:var(--cisco-blue);text-decoration:underline">My Equipment</a>'
          + ' to include data sources, or open the <a href="' + _dataSizingURL('') + '" target="_blank" style="color:var(--cisco-blue);text-decoration:underline">Data Sizing Tool</a>'
          + ' to select industrial data sources directly.</span>';
      } else if (ucsUnmapped > 0 && hasDsaSources) {
        countEl.innerHTML += '<br><span style="font-size:11px;color:var(--text-tertiary);font-weight:400">'
          + ucsUnmapped + ' of ' + count + ' selected use case' + (count !== 1 ? 's' : '') + ' don\u2019t have data sources mapped. '
          + 'Their data volume can be estimated by adding relevant equipment in '
          + '<a href="#" onclick="event.preventDefault();openInventoryModal()" style="color:var(--cisco-blue);text-decoration:underline">My Equipment</a>'
          + '.</span>';
      }
    } else {
      countEl.textContent = 'Select use cases or inventory to estimate data sizing';
    }
  }
  if (estimateBtn) {
    var dsaCheck = buildDSASources();
    estimateBtn.disabled = dsaCheck.size === 0;
    estimateBtn.title = dsaCheck.size === 0
      ? 'No data sources mapped to your selections. Add equipment via My Equipment to enable sizing.'
      : 'Open Data Sizing Assessment with ' + dsaCheck.size + ' data sources';
  }
  if (clearBtn) clearBtn.style.display = hasSelection ? '' : 'none';
}

function buildDSASources() {
  var dsaSet = new Set();
  var eqMap = window.DSA_EQUIPMENT_MAP || {};
  var ucMap = window.DSA_UC_MAP || {};
  inventorySelections.forEach(function(eqId) {
    var sources = eqMap[eqId];
    if (sources) sources.forEach(function(s) { dsaSet.add(s); });
  });
  selectedUCIds.forEach(function(ucId) {
    var sources = ucMap[ucId];
    if (sources) sources.forEach(function(s) { dsaSet.add(s); });
  });
  return dsaSet;
}

function launchDSAEstimate() {
  var dsaSources = buildDSASources();
  var params = [];
  if (dsaSources.size > 0) {
    params.push('sources=' + Array.from(dsaSources).join(','));
  }
  if (inventorySelections.length > 0) {
    params.push('equipment=' + inventorySelections.join(','));
  }
  if (dsaSources.size === 0) {
    var msg = 'No data sources could be mapped from your current selections.\n\n';
    if (selectedUCIds.size > 0 && inventorySelections.length === 0) {
      msg += 'The selected use cases don\u2019t have specific data sources linked. '
        + 'To get a data volume estimate:\n\n'
        + '1. Click "My Equipment" and select the equipment in your environment\n'
        + '2. Or open the Data Sizing Tool directly to browse all ' + '206+ data sources';
    } else {
      msg += 'Add equipment via "My Equipment" or select use cases that have data sources mapped.';
    }
    alert(msg);
    return;
  }
  window.open(_dataSizingURL(params.join('&')), '_blank');
}

function initApp() {
  _loadInventory();
  _updateInventoryBadge();
  _restoreUCSelections();
  populateEquipmentSelect();
  try {
    if (localStorage.getItem('cisco-ui-theme') === 'dark') {
      document.documentElement.classList.add('dark');
      document.getElementById('theme-label').textContent = 'Light';
      var ic = document.getElementById('theme-ico');
      if (ic) ic.textContent = '☀';
    }
  } catch (e) {}
  try {
    var ts = localStorage.getItem(TEXT_KEY);
    if (ts != null) applyTextSizeStep(ts);
  } catch (e2) {}
  try {
    if (localStorage.getItem('uc-colorblind-friendly') === '1') {
      document.getElementById('cb-toggle').checked = true;
      document.documentElement.classList.add('cb-friendly');
    }
  } catch (e3) {}
  try {
    if (localStorage.getItem('cisco-ui-nontech') === '1') setNonTechnicalView(true);
  } catch (e4) {}
  document.getElementById('footer-author').textContent = SITE.siteAuthor ? 'Author: ' + SITE.siteAuthor : '';
  var fl = document.getElementById('footer-feedback');
  if (fl && SITE.siteRepoUrl) fl.href = SITE.siteRepoUrl;

  var headerLogo = document.getElementById('header-logo');
  headerLogo.addEventListener('click', goHome);
  headerLogo.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });
  document.getElementById('theme-btn').addEventListener('click', toggleTheme);
  document.getElementById('hamburger').addEventListener('click', function() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-backdrop').classList.toggle('open');
  });
  document.getElementById('sidebar-backdrop').addEventListener('click', closeMobileSidebar);
  (function() {
    var mBtn = document.getElementById('mobile-search-btn');
    var mBar = document.getElementById('mobile-search-bar');
    var mInput = document.getElementById('mobile-search-input');
    var deskInput = document.getElementById('search-input');
    mBtn.addEventListener('click', function() {
      var open = mBar.classList.toggle('open');
      if (open) mInput.focus();
    });
    var mst;
    mInput.addEventListener('input', function(ev) {
      clearTimeout(mst);
      mst = setTimeout(function() {
        currentSearch = ev.target.value.trim();
        searchShowAll = false;
        deskInput.value = currentSearch;
        if (currentSearch) { currentCat = null; }
        reRender();
        updateHash(false);
      }, 200);
    });
  })();
  document.getElementById('equipment-select').addEventListener('change', onEquipmentChange);
  document.getElementById('equipment-model-select').addEventListener('change', onModelChange);
  document.getElementById('inv-search').addEventListener('input', function(ev) {
    document.getElementById('inv-body').innerHTML = _invBuildBody(ev.target.value);
  });
  document.getElementById('inv-file-input').addEventListener('change', function(ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var r = new FileReader();
    r.onload = function() {
      try {
        var d = JSON.parse(r.result);
        if (d && Array.isArray(d.equipment)) {
          _invTempSelections = new Set(d.equipment);
          document.getElementById('inv-body').innerHTML = _invBuildBody('');
          document.getElementById('inv-footer-count').textContent = _invTempSelections.size + ' selected';
        }
      } catch (e) {}
    };
    r.readAsText(f);
    ev.target.value = '';
  });

  var siEl = document.getElementById('search-input');
  var st;
  siEl.addEventListener('input', function(ev) {
    clearTimeout(st);
    st = setTimeout(function() {
      currentSearch = ev.target.value.trim();
      searchShowAll = false;
      if (currentSearch) { currentCat = null; }
      reRender();
      if (currentSearch) updateHash(false);
      else updateHash(false);
    }, 250);
  });

  document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); if (!nonTechnicalView) siEl.focus(); return; }
    if (e.key === '/' && !isInputFocused() && !nonTechnicalView) { e.preventDefault(); siEl.focus(); return; }
    if (e.key === 'Escape') {
      if (document.getElementById('help-overlay').classList.contains('open')) { closeHelpGuide(); return; }
      if (document.getElementById('inv-overlay').classList.contains('open')) { closeInventoryModal(); return; }
      if (document.getElementById('src-overlay').classList.contains('open')) { closeSourceCatalog(); return; }
      if (document.getElementById('rn-overlay').classList.contains('open')) { closeReleaseNotes(); return; }
      if (document.activeElement === siEl && siEl.value) { siEl.value = ''; siEl.blur(); currentSearch = ''; selectCat(null); return; }
      if (document.getElementById('panel-backdrop').classList.contains('open')) { closePanel(); return; }
      if (document.getElementById('mitre-map-overlay').classList.contains('open')) { closeMitreMap(); return; }
      closeMobileSidebar();
      return;
    }
    if (document.getElementById('panel-backdrop').classList.contains('open')) {
      if (e.key === 'ArrowLeft') navPanel(-1);
      if (e.key === 'ArrowRight') navPanel(1);
    }
  });

  document.getElementById('panel-backdrop').addEventListener('click', function(ev) { if (ev.target === this) closePanel(); });
  document.getElementById('panel').addEventListener('click', function(ev) { ev.stopPropagation(); });

  window.addEventListener('popstate', function() { restoreFromHash(); });

  _updateSizingTray();
  restoreFromHash();
}

function closeMobileSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
}

// initApp depends on window.DATA / window.EQUIPMENT / window.CAT_META
// being populated, which the loader handles asynchronously in production
// (lazy mode) and synchronously in legacy mode (when data.js was loaded
// as a separate <script> tag). Wait for the catalog:ready handshake.
if (window.__catalogReady && typeof window.__catalogReady.then === 'function') {
  window.__catalogReady.then(function() {
    try { initApp(); } catch (err) { console.error('[app] initApp failed:', err); }
  });
} else {
  // Defensive fallback for direct-from-disk file:// loads where the
  // loader IIFE may not have evaluated yet (or window features differ).
  initApp();
}

/* Cisco UI catalog — chunk 6: lazy-loaded sharded search index.
 *
 * Replaces the in-memory ``_searchBlob`` linear scan over the legacy 39 MB
 * data.js payload with a static, sharded inverted index built at build
 * time and served from /assets/.
 *
 * Wire-up
 * -------
 * The catalog (00-loader.js) populates window.DATA + _searchBlob first.
 * The filter pipeline (02-filters.js) runs synchronously on every
 * keystroke and does the *substring* match against _searchBlob — that
 * keeps the UI feeling instant, but only matches stub-level fields
 * (UC name, summary, source names, app names, regulation IDs).
 *
 * THIS module adds the heavy-field overlay: full SPL, full markdown
 * narrative, expanded MITRE/CIM tags. On every (debounced) query it
 * returns a Set<UCID> of additional matches found in those fields. The
 * filter pipeline UNIONS the two sets, so a UC matches the search if
 * EITHER scan finds it.
 *
 * Public API
 * ----------
 *   window.__searchIndex.query(q)            -> Promise<Set<UCID>>
 *   window.__searchIndex.warmup()            -> kick off vocab prefetch
 *   window.__searchAsyncResults              -> { q, set, when } latest
 *   window.__onSearchResults(q, set)         -> wired by 02-filters.js,
 *                                               called once shard fetch
 *                                               resolves; triggers reRender.
 *
 * Cache strategy
 * --------------
 * vocab.json: stable filename, fetched fresh per session (cache normal HTTP).
 * search-shard-NN.<hash>.json: fingerprinted, safe to cache forever.
 * In-memory: vocab + every shard requested are kept in JS for the
 * lifetime of the page; queryCache memoises {q -> Set<UCID>}.
 *
 * Failure modes
 * -------------
 * If vocab or any shard fetch fails (offline, 404, JSON parse error),
 * we log to console and return an empty set. The substring scan in
 * 02-filters.js still runs, so search continues to work over the
 * stub-level fields — this module is a strict additive layer.
 */

(function() {
  if (typeof window === 'undefined') return;

  // Root-absolute paths so the SPA works from any depth (e.g. /browse/).
  // Override via window.__CATALOG_ASSETS_BASE if hosting under a non-root prefix.
  var ASSETS_BASE = (typeof window.__CATALOG_ASSETS_BASE === 'string' && window.__CATALOG_ASSETS_BASE)
    ? window.__CATALOG_ASSETS_BASE.replace(/\/+$/, '') + '/'
    : '/assets/';

  var VOCAB_URL = ASSETS_BASE + 'search-vocab.json';
  var SHARD_BASE = ASSETS_BASE;

  var vocabPromise = null;
  var vocab = null;
  var shardCache = {};
  var queryCache = {};
  var debounceTimer = null;
  var DEBOUNCE_MS = 80;
  var MAX_PREFIX_EXPANSION = 32;
  var MAX_QUERY_TOKENS = 8;

  function _shardUrl(shardId) {
    if (!vocab || !vocab.shardFiles) return null;
    var name = vocab.shardFiles[shardId];
    return name ? SHARD_BASE + name : null;
  }

  function _fetchVocab() {
    if (vocabPromise) return vocabPromise;
    vocabPromise = fetch(VOCAB_URL, { credentials: 'same-origin' })
      .then(function(r) {
        if (!r.ok) throw new Error('vocab HTTP ' + r.status);
        return r.json();
      })
      .then(function(v) {
        if (!v || v.version !== 2 || v.hash !== 'fnv1a32' || !Array.isArray(v.tokens)) {
          throw new Error('vocab schema mismatch');
        }
        vocab = v;
        return v;
      })
      .catch(function(err) {
        console.error('[search] vocab fetch failed:', err);
        vocabPromise = null;
        throw err;
      });
    return vocabPromise;
  }

  function _fetchShard(shardId) {
    if (shardCache[shardId]) return shardCache[shardId];
    var url = _shardUrl(shardId);
    if (!url) return Promise.resolve({});
    shardCache[shardId] = fetch(url, { credentials: 'same-origin' })
      .then(function(r) {
        if (!r.ok) throw new Error('shard HTTP ' + r.status);
        return r.json();
      })
      .then(function(s) { return s.postings || {}; })
      .catch(function(err) {
        console.error('[search] shard ' + shardId + ' fetch failed:', err);
        delete shardCache[shardId];
        return {};
      });
    return shardCache[shardId];
  }

  /* ------------------------------------------------------------------
   * Query pipeline
   * ------------------------------------------------------------------ */

  function _tokenize(q) {
    if (!q) return [];
    return q.toLowerCase().split(/[^a-z0-9_]+/).filter(function(t) {
      return t.length >= 3 && t.length <= 30;
    });
  }

  function _expandPrefix(token, sortedTokens) {
    if (!sortedTokens || !sortedTokens.length) return [];
    // Exact match wins — no need to expand.
    if (_binarySearch(sortedTokens, token) !== -1) return [token];
    // Otherwise treat as a prefix: collect tokens that start with `token`.
    var lo = _lowerBound(sortedTokens, token);
    var out = [];
    for (var i = lo; i < sortedTokens.length; i++) {
      var t = sortedTokens[i];
      if (t.indexOf(token) !== 0) break;
      out.push(t);
      if (out.length >= MAX_PREFIX_EXPANSION) break;
    }
    return out;
  }

  function _binarySearch(arr, needle) {
    var lo = 0, hi = arr.length - 1;
    while (lo <= hi) {
      var mid = (lo + hi) >>> 1;
      var v = arr[mid];
      if (v === needle) return mid;
      if (v < needle) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  function _lowerBound(arr, needle) {
    var lo = 0, hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >>> 1;
      if (arr[mid] < needle) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  function _postingFromString(str) {
    if (!str) return [];
    var parts = str.split(',');
    var out = new Array(parts.length);
    for (var i = 0; i < parts.length; i++) out[i] = +parts[i];
    return out;
  }

  function _intersect(a, b) {
    var out = [];
    var i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { out.push(a[i]); i++; j++; }
      else if (a[i] < b[j]) i++;
      else j++;
    }
    return out;
  }

  function _union(arrs) {
    if (arrs.length === 1) return arrs[0];
    var s = new Set();
    for (var i = 0; i < arrs.length; i++) {
      var a = arrs[i];
      for (var j = 0; j < a.length; j++) s.add(a[j]);
    }
    var out = Array.from(s);
    out.sort(function(x, y) { return x - y; });
    return out;
  }

  function _runQuery(q) {
    if (queryCache[q]) return Promise.resolve(queryCache[q]);
    return _fetchVocab().then(function() {
      var tokens = _tokenize(q).slice(0, MAX_QUERY_TOKENS);
      if (!tokens.length) {
        var emptySet = new Set();
        queryCache[q] = emptySet;
        return emptySet;
      }
      var perTokenExpansion = tokens.map(function(t) {
        return _expandPrefix(t, vocab.tokens);
      });
      // Any query token with zero vocab matches => no UC can satisfy AND
      // semantics. Bail with an empty set rather than fetching shards.
      for (var i = 0; i < perTokenExpansion.length; i++) {
        if (perTokenExpansion[i].length === 0) {
          var s = new Set();
          queryCache[q] = s;
          return s;
        }
      }
      var shardIds = {};
      perTokenExpansion.forEach(function(arr) {
        arr.forEach(function(t) { shardIds[_shardForToken(t)] = true; });
      });
      var ids = Object.keys(shardIds).map(Number);
      return Promise.all(ids.map(_fetchShard)).then(function(shardData) {
        var byId = {};
        for (var k = 0; k < ids.length; k++) byId[ids[k]] = shardData[k];
        var perTokenPostings = perTokenExpansion.map(function(expanded) {
          var lists = expanded.map(function(t) {
            var sid = _shardForToken(t);
            var raw = byId[sid] && byId[sid][t];
            return raw ? _postingFromString(raw) : [];
          });
          return _union(lists);
        });
        var matched = perTokenPostings.reduce(function(a, b) {
          return _intersect(a, b);
        });
        var ucIds = matched.map(function(idx) { return vocab.ucIds[idx]; });
        var resultSet = new Set(ucIds);
        queryCache[q] = resultSet;
        return resultSet;
      });
    });
  }

  function _publish(q, set) {
    window.__searchAsyncResults = { q: q, set: set, when: Date.now() };
    if (typeof window.__onSearchResults === 'function') {
      try { window.__onSearchResults(q, set); } catch (e) { /* swallow */ }
    }
  }

  /* ------------------------------------------------------------------
   * Public API
   * ------------------------------------------------------------------ */

  window.__searchIndex = {
    /** Schedule a (debounced) async query and return its Promise<Set>. */
    query: function(q) {
      var key = String(q || '').toLowerCase().trim();
      if (queryCache[key]) {
        _publish(key, queryCache[key]);
        return Promise.resolve(queryCache[key]);
      }
      clearTimeout(debounceTimer);
      return new Promise(function(resolve) {
        debounceTimer = setTimeout(function() {
          _runQuery(key).then(function(set) {
            // The user may have typed more chars while we were fetching.
            // Only publish if this query is still the latest the loader saw.
            _publish(key, set);
            resolve(set);
          }).catch(function() { resolve(new Set()); });
        }, DEBOUNCE_MS);
      });
    },
    /** Best-effort vocab prefetch. Called once after catalog:ready. */
    warmup: function() {
      var ric = window.requestIdleCallback;
      if (typeof ric === 'function') {
        ric(function() { _fetchVocab().catch(function() {}); }, { timeout: 2000 });
      } else {
        setTimeout(function() { _fetchVocab().catch(function() {}); }, 250);
      }
    },
    /** True if vocab is loaded and the index is ready to answer queries. */
    isReady: function() { return vocab !== null; }
  };

  if (window.__catalogReady && typeof window.__catalogReady.then === 'function') {
    window.__catalogReady.then(function() { window.__searchIndex.warmup(); });
  } else {
    window.__searchIndex.warmup();
  }

  /* ------------------------------------------------------------------
   * FNV-1a 32-bit token hash (for shard routing).
   *
   * Mirrors render_search.py::_shard_for. FNV-1a chosen over BLAKE2b
   * because the JS implementation is 7 lines vs ~150 with no dependence
   * on Web Crypto. Distribution is uniform to within 5% across the
   * 12k-token vocabulary — plenty for static shard routing.
   * ------------------------------------------------------------------ */

  function _shardForToken(token) {
    if (!vocab) return 0;
    var hash = 0x811C9DC5;
    for (var i = 0; i < token.length; i++) {
      var code = token.charCodeAt(i);
      // Encode codepoint as UTF-8 bytes — vocab is ASCII (^[a-z0-9_]+$),
      // but we still go through the encoder for correctness.
      if (code < 0x80) {
        hash ^= code;
        hash = Math.imul(hash, 0x01000193) >>> 0;
      } else if (code < 0x800) {
        hash ^= 0xC0 | (code >> 6);
        hash = Math.imul(hash, 0x01000193) >>> 0;
        hash ^= 0x80 | (code & 0x3F);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      } else {
        hash ^= 0xE0 | (code >> 12);
        hash = Math.imul(hash, 0x01000193) >>> 0;
        hash ^= 0x80 | ((code >> 6) & 0x3F);
        hash = Math.imul(hash, 0x01000193) >>> 0;
        hash ^= 0x80 | (code & 0x3F);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
    }
    return (hash >>> 0) % vocab.shardCount;
  }
})();
