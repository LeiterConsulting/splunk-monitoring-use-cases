# Exec-Ctrl Status

## Snapshot Date

2026-04-21

## Executive Status

The repo already ships a compiled public catalog site and several Splunk app
artifacts, but the correct target for this work is the compiled catalog itself,
not the recommender app. The packaging source is `dist/` from
`tools/build/build.py`, and the intended Splunk host path is
/static/app/monitoring_use_cases/index.html#overview`. Foundation, packaging,
remote validation, readiness hardening, and handoff alignment are now complete:
the repo has a deterministic generator, `splunk-apps/monitoring_use_cases/`, an
installable `.spl` archive, verified in-chrome host routes, same-window SPL
Search deep links, companion-page coverage, responsive and accessibility smoke
evidence, AppInspect-relevant static-packaging evidence, and operator guidance
that matches the shipped catalog app behavior.

## Current Phase State

| Phase | Status | Summary |
| --- | --- | --- |
| 0 - Foundation baseline | `complete` | The correct product boundary, packaging source, and app id are now explicit. |
| 1 - Catalog app generator | `complete` | `scripts/generate_monitoring_use_cases_app.py` now emits `splunk-apps/monitoring_use_cases/`. |
| 2 - Host view and static routing | `complete` | The remote static route and scripted in-chrome host route are now proven. |
| 3 - Companion page coverage | `complete` | All planned companion routes and the data sizing tool now smoke cleanly in Splunk chrome. |
| 4 - Package coherence and archive output | `complete` | The archive is plain tar, free of macOS metadata, contains the compliance story payloads, and reinstalls cleanly. |
| 5 - UX hardening and readiness | `complete` | Responsive, accessibility, and static-packaging evidence now exist for the shipped app. |
| 6 - Remote install and handoff | `complete` | Remote install evidence and operator guidance now match the shipped app behavior. |

## What Is Already True

- the workspace is cloned locally on `main`
- `python3 tools/build/build.py --out dist` succeeds locally
- the compiled site in `dist/` is the correct packaging source for the live catalog app
- the compiled site already supports non-root hosting through base-path override globals
- the workspace root `.env` file is the local source of truth for the remote Splunk target, certificate mode, and auth settings used during validation
- the deployment guide already assumes a Splunk app path under `/static/app/monitoring_use_cases/`
- `python3 scripts/generate_monitoring_use_cases_app.py` succeeds locally
- `python3 scripts/generate_monitoring_use_cases_app.py --check` succeeds locally
- `scripts/package_splunk_apps.sh dist monitoring_use_cases` succeeds locally
- `dist/monitoring_use_cases-7.1.0.spl` now exists for remote install as a plain-tar `.spl` archive with macOS metadata stripped
- the generated app now includes `appserver/static/api/v1/compliance/story/index.json` plus the supporting `api/v1/compliance/clauses/*` payloads required by the compliance story route
- the generated app installs on the remote Splunk target through App Management in the authenticated browser session
- the remote static route `/en-US/static/app/monitoring_use_cases/index.html#overview` now loads with `SITE_CUSTOM`, `NON_TECHNICAL`, `PROVENANCE`, and `i18n_register` present and no console, page, or HTTP errors
- the app route `/en-US/app/monitoring_use_cases/catalog` now renders the packaged catalog inline inside Splunk chrome
- hosted UC detail panels now expose same-window `Open in Splunk Search` actions that navigate into the Search app
- the companion routes `/en-US/app/monitoring_use_cases/scorecard`, `/regulatory_primer`, `/clause_navigator`, `/compliance_story`, `/api_docs`, and `/data_sizing` now render the packaged static surfaces inside Splunk chrome
- internal catalog navigation to the primer now stays inside `/en-US/app/monitoring_use_cases/catalog` while the iframe target changes to `regulatory-primer.html`
- the installed-route readiness sweep now shows no package-origin HTTP errors, no package-origin console errors, working skip links on every shipped surface, and no desktop horizontal overflow across the planned route set
- the focused `390px` iframe probe for `/en-US/app/monitoring_use_cases/data_sizing` now passes with no horizontal overflow after the wrapped mobile-header fix
- focused static checks against `splunk-apps/monitoring_use_cases/` pass for AppInspect-relevant packaging risks: no forbidden config files, no `web.conf` expose stanzas, no scripted inputs, no python2, no bundled binaries, and no macOS archive detritus
- `docs/enterprise-deployment.md` and `README.md` now document the packaged `monitoring_use_cases` app as a shipped installable artifact with the verified host-route model

## Current Constraint

None inside the current exec-ctrl ladder. The verified Release 1 package,
runtime behavior, and operator guidance are now aligned.

## Required Next Implementation Move

No further implementation move is required to close the current ladder. Any
follow-on work should be treated as a new enhancement track rather than an open
release blocker. The active follow-on track is now the deterministic discovery
and mapping series controlled by `19_EXEC_CTRL_DISCOVERY_OVERVIEW.md` through
`22_EXEC_CTRL_DISCOVERY_STATUS.md`.

## Immediate Follow-On Backlog After The Active Phase Closes

1. implement Phase 3 discovery-engine scaffolding in the new discovery track so the app can persist bounded local inventory findings deterministically
2. add mapping-state evaluation and orchestration on top of the saved-search, KV-store, and browser-orchestration model already proven by `splunk-uc-recommender`
3. validate that future discovery work preserves the generator-owned packaging contract for `monitoring_use_cases`

## Update Rule

This file must be updated whenever:

- a phase state changes
- the active blocker changes
- the recommended default path changes
- live evidence changes the next implementation move