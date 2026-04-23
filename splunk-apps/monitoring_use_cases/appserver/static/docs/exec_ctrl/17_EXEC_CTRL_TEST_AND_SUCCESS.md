# Exec-Ctrl Test And Success

## Test Policy

A phase cannot move to `complete` without evidence.

Accepted evidence types:

- automated test output
- narrow compile, syntax, or type validation when appropriate
- generator drift or deterministic build validation
- live browser verification inside the remote Splunk target when the app is installable
- explicit blocker evidence when completion is not yet possible

## System-Level Success Definition

The project succeeds when all of the following are true:

1. An operator can install the generated `monitoring_use_cases` app and open the compiled catalog inside Splunk.
1. An operator can install the generated `monitoring_use_cases` app and reach the compiled catalog inside Splunk through the static app path and chosen host model.
2. The packaged app resolves its static pages, API payloads, and fingerprinted assets under the Splunk app base path.
3. Overview, search, filtering, detail panels, companion pages, and SPL deep links behave closely enough to the compiled public site for operator use.
4. The app remains generator-owned and reproducible from repo source.
5. The shipped UX is responsive, accessible, and aligned with standard enterprise monitoring workflows.

## Phase Test Matrix

### Phase 0 tests

- `P0-T1`: control docs reflect the real current repo state rather than an aspirational architecture
- `P0-T2`: the compiled site source and Splunk app base-path contract are explicit

Current evidence:

- `docs/architecture.md` confirms the public site is compiled into `dist/`
- `tools/build/build.py` is the real build entrypoint for that compiled site
- `docs/enterprise-deployment.md` already points to `/static/app/monitoring_use_cases/index.html` as the Splunk-hosted URL shape
- `src/scripts/00-loader.js` and `src/scripts/06-search.js` support non-root API and asset base overrides

### Phase 1 tests

- `P1-T1`: the compiled site builds reproducibly with the Splunk app base path
- `P1-T2`: the generator emits the built site into the app package without manual edits in `splunk-apps/`

Current evidence:

- `python3 tools/build/build.py --out dist` succeeded locally
- compiled `dist/index.html` exposes `window.__SITE_BASE_PATH`, `window.__CATALOG_API_BASE`, and `window.__CATALOG_ASSETS_BASE`
- `python3 scripts/generate_monitoring_use_cases_app.py` succeeded and emitted `splunk-apps/monitoring_use_cases/`
- `python3 scripts/generate_monitoring_use_cases_app.py --check` succeeded, so the generated app tree is deterministic
- the generator now copies `custom-text.js` into the packaged static root and injects a `window.i18n_register` shim into generated HTML so Splunk-served JS wrappers can execute

### Phase 2 tests

- `P2-T1`: the packaged host view opens `/static/app/monitoring_use_cases/index.html#overview`
- `P2-T2`: packaged API and asset requests resolve with no broken path assumptions

Current evidence:

- the generated app now includes scripted dashboard host views for `catalog` and companion routes that point at the packaged static pages under `/static/app/monitoring_use_cases/`
- the generated app now includes `default/data/ui/nav/default.xml` with generated companion-view routes inside the Splunk app
- remote install via Splunk App Management succeeded from the authenticated browser session against the `.env`-defined target
- live validation of `/en-US/static/app/monitoring_use_cases/index.html#overview` showed `SITE_CUSTOM`, `NON_TECHNICAL`, `PROVENANCE`, and `i18n_register` all initialized with no console, page, or HTTP errors
- live validation of `/en-US/app/monitoring_use_cases/catalog` showed the app route renders the compiled catalog inline inside Splunk chrome through the scripted host
- live validation of a hosted UC detail panel showed `Open in Splunk Search` actions on SPL-like code blocks and same-window navigation into `/en-US/app/search/search?q=...`

### Phase 3 tests

- `P3-T1`: companion pages and the data sizing tool resolve correctly inside the app static root
- `P3-T2`: internal links and hash-based navigation remain functional inside Splunk

Current evidence:

- the generated app packages `scorecard.html`, `regulatory-primer.html`, `clause-navigator.html`, `compliance-story.html`, `api-docs.html`, and `tools/data-sizing/`
- the generated app now packages `appserver/static/api/v1/compliance/story/index.json` and the supporting `api/v1/compliance/clauses/*` payloads required by `compliance-story.html`
- live validation of `/en-US/app/monitoring_use_cases/scorecard`, `/regulatory_primer`, `/clause_navigator`, `/compliance_story`, `/api_docs`, and `/data_sizing` showed each packaged companion surface renders inside Splunk chrome
- live validation from `/en-US/app/monitoring_use_cases/catalog` showed internal primer navigation remains inside the Splunk app host while the iframe target changes to `regulatory-primer.html`

### Phase 4 tests

- `P4-T1`: generated navigation and host views resolve to the packaged static catalog path
- `P4-T2`: no required runtime path depends on manual edits to generated output

Current evidence:

- `scripts/package_splunk_apps.sh dist monitoring_use_cases` succeeded after the shared archive helper was corrected to emit plain-tar `.spl` files
- `tar -tf dist/monitoring_use_cases-7.1.0.spl | grep 'monitoring_use_cases/appserver/static/api/v1/compliance/story/index.json'` returned the packaged story index
- `tar -tf dist/monitoring_use_cases-7.1.0.spl | grep -Ec '(^|/)(\._[^/]*|\.DS_Store|__MACOSX)(/|$)'` returned `0`
- the current archive checksum is recorded in `dist/monitoring_use_cases-7.1.0.spl.sha256`

### Phase 5 tests

- `P5-T1`: accessibility and responsive smoke checks pass for the packaged catalog app
- `P5-T2`: AppInspect-relevant static app checks pass to the degree supported by the environment

Current evidence:

- the generated app has been installed successfully on the remote Splunk target through the authenticated browser session
- live browser verification now exists for the hosted catalog route, the main static route, all planned companion routes, and same-window Search deep links inside the remote Splunk target
- a full installed-route sweep across `catalog`, `scorecard`, `regulatory_primer`, `clause_navigator`, `compliance_story`, `api_docs`, and `data_sizing` now shows no package-origin HTTP 4xx/5xx responses, no package-origin console errors, and no horizontal overflow at desktop width
- the focused narrow-frame probe on `/en-US/app/monitoring_use_cases/data_sizing` now passes at an effective `390px` iframe width with `scrollWidth == clientWidth`, `overflowX: false`, and the wrapped mobile header layout intact
- all shipped installed surfaces now expose working skip links that resolve to a real main-content target inside the iframe document
- focused static checks against `splunk-apps/monitoring_use_cases/` now pass with no `commands.conf`, `restmap.conf`, or `authentication.conf`; no `[expose:*]` `web.conf` stanzas; no `[script://]` inputs; no `python.version = python2`; no `bin/` payloads or native binaries; `app.manifest` present; and no `.DS_Store`, `__MACOSX`, or `._*` entries in the packaged archive

### Phase 6 tests

- `P6-T1`: the app packages successfully into an installable artifact and installs in the remote test Splunk environment
- `P6-T2`: release docs and operator guidance match the shipped app behavior

Current evidence:

- the refreshed archive `dist/monitoring_use_cases-7.1.0.spl` installs successfully on the remote Splunk target when uploaded through App Management with `Upgrade app` selected
- remote smoke validation now exists for the catalog route, all planned companion routes, and in-host internal catalog navigation after reinstall
- `docs/enterprise-deployment.md` now documents the packaged `monitoring_use_cases` app as a first-class release artifact, including build, install, SHC extraction, verification routes, and the supported in-Splunk host model
- `README.md` now lists `monitoring_use_cases-<ver>.spl` alongside the other shipped Splunk packages and points operators to the deployment guide for runtime behavior and install flow

## Evidence Already Established In This Workspace

- `tools/build/build.py` emits the real compiled site into `dist/`
- `dist/index.html` already carries supported base-path override globals
- `scripts/package_splunk_apps.sh` can package explicit app IDs once the app tree exists
- `docs/enterprise-deployment.md` documents the intended Splunk-hosted URL shape for the catalog app
- `scripts/generate_monitoring_use_cases_app.py` now generates the app tree under `splunk-apps/monitoring_use_cases/`
- the workspace root `.env` file is the local authority for remote Splunk validation settings
- the packaged archive `dist/monitoring_use_cases-7.1.0.spl` now exists and installs on the remote Splunk target
- the packaged main static route now smokes cleanly in the remote Splunk runtime
- the packaged app now includes the `api/v1/compliance/story` and `api/v1/compliance/clauses` payloads required by the compliance story companion page
- all planned companion routes now smoke cleanly in the remote Splunk runtime

## Known Evidence Gap

- deployment-aware interactions beyond Search deep links still need scope and validation if they are promoted into Release 1