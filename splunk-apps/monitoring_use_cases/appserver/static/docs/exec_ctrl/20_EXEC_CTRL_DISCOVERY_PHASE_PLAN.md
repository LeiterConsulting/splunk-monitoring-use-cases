# Exec-Ctrl Discovery Phase Plan

## Phase Control Rule

The active phase is the earliest phase that is not `complete`.

Later work may be designed, but the next implementation move is controlled by
the active phase.

## Phase Ladder

| Phase | Name | Status | Exit control |
| --- | --- | --- | --- |
| 0 | Inventory and runtime model | `complete` | The repo inventory, integration points, and default runtime model are explicit |
| 1 | Schemas and storage baseline | `complete` | Generator-owned schema and KV scaffolding exist for the discovery track |
| 2 | Requirement normalization | `complete` | Deterministic requirement profiles are emitted from the catalog source |
| 3 | Discovery engine | `in_progress` | Bounded inventory, telemetry, broadened degraded-run scaffolding, and summary-level snapshot preservation exist; live failure-path validation is still in progress |
| 4 | Mapping engine | `not_started` | Effective mapping state, evidence, and precedence rules are computed deterministically |
| 5 | Orchestration interface | `not_started` | The app can start scans and read results through the chosen saved-search and KV model |
| 6 | UX integration | `not_started` | Catalog badges, filters, results views, and admin refinement surfaces work inside Splunk chrome |
| 7 | Verification and handoff | `not_started` | Tests, packaging, install validation, and operator docs prove the feature is ready |

## Phase Detail

### Phase 0 - Inventory and runtime model

Objective:

- identify the actual integration points and choose the default runtime model before implementation expands scope

Required scope:

- inventory the current `monitoring_use_cases` app structure
- identify discovery, mapping, and results insertion points
- compare the proposed endpoint model with the repo's proven Splunk-native precedent
- choose the default runtime model for this enhancement track

Current status:

- `complete`

Current blocker:

- none

Exit gate:

- the repo has authoritative control docs that state where the feature fits and why the saved-search, KV-store, and browser-orchestration model is the default path

### Phase 1 - Schemas and storage baseline

Objective:

- create generator-owned schema and storage scaffolding for the discovery track

Required scope:

- define the baseline schemas for requirement profiles, discovered datasets, mappings, overrides, scan runs, scan logs, and adjacency hints
- emit KV Store collection definitions for those records into `monitoring_use_cases`
- ensure the app metadata exports the collections correctly
- keep the storage contract generator-owned rather than hand-edited inside `splunk-apps/`

Current status:

- `complete`

Current blocker:

- none

Exit gate:

- `scripts/generate_monitoring_use_cases_app.py` emits a stable `default/collections.conf`, `metadata/default.meta` exports collections, and `appserver/static/api/v1/discovery/bootstrap.json` records the schema and runtime contract for later phases

### Phase 2 - Requirement normalization

Objective:

- turn the current catalog content into deterministic runtime requirement profiles

Required scope:

- derive normalized requirement records from the catalog source of truth
- persist those profiles in a generator-owned runtime artifact that later discovery and mapping phases can consume
- validate profile counts, schema versioning, and stability across generator reruns

Current status:

- `complete`

Current blocker:

- none

Exit gate:

- the app can load deterministic requirement profiles from `appserver/static/api/v1/discovery/requirements.json`, those profiles cover the catalog using canonical sidecars plus compact-catalog fallback records, and generator reruns remain stable

### Phase 3 - Discovery engine

Objective:

- collect deterministic local-environment findings and persist them as discovered datasets

Required scope:

- inventory indexes, sourcetypes, sources, hosts, CIM state, and bounded field prevalence signals
- normalize raw findings into discovered dataset records
- preserve prior successful scan results when a later scan fails

Current status:

- `in_progress`

Current blocker:

- bounded failure handling now covers explicit `muc_scan_logs level="error"` carry-forward with telemetry-recency gating plus telemetry-missing, index-missing, sourcetype, source, host, data-model, and field-sampling gap checks; the summary now also synthesizes structured gap failure records via `gap_error_message`, `gap_error_details`, and `failure_record_json` so bounded degraded runs preserve prior successful counts while still emitting a sanitized gap `error_record`; preserved latest-snapshot dataset rows now retain `snapshot_source`, and the field-sampling join plus summary `datasets_discovered` and stage counts now scope to `snapshot_source="current"` rows so carried-forward prior rows cannot mask a current-stage gap; the telemetry snapshot preserves prior explicit error rows across `muc_scan_logs` rewrites, the latest `muc_scan_runs` summary counts only non-error telemetry rows while preserving prior successful counts on failed or degraded reruns, and stale preserved errors stop controlling the summary once a newer non-error telemetry refresh exists; latest-snapshot inventory stages preserve the prior origin slice when a stage emits no current rows and retain unmatched prior rows on partial reruns; the generator emits `default/transforms.conf` KV lookup definitions for the discovery collections, preserves the full static API tree during app render, and emits a generated install `build` so same-version browser reinstalls refresh the deployed config; and the redeployed remote Splunk app now passes synthetic zero-output slice-preservation, partial-rerun slice-preservation, current-gap-versus-healthy summary counting, degraded-summary, explicit-error-summary, telemetry-error-row preservation, stale-versus-fresh explicit-error recovery, deployed `failed_stage` telemetry/index/data-model validation, and exact-expression field-sampling gap-versus-healthy structured-error-record validation. Additional failure-mode coverage is still missing

Exit gate:

- a bounded local scan can populate dataset and scan-run records without breaking prior successful state

### Phase 4 - Mapping engine

Objective:

- map normalized requirements to discovered datasets with explainable evidence and precedence rules

Required scope:

- implement direct, adjacent, partial, and none matching logic
- separate engine state from effective state
- persist evidence, missing requirements, and precedence reasoning
- preserve admin overrides across reruns

Current status:

- `not_started`

Current blocker:

- none

Exit gate:

- deterministic mappings exist with explainable evidence and override-safe effective state

### Phase 5 - Orchestration interface

Objective:

- let the app start discovery work and read results through the chosen runtime model

Required scope:

- add saved-search and browser orchestration for scans and result refresh
- expose stable logical response shapes for the UI, even if they are not implemented as custom REST endpoints yet
- constrain mutations to admin-authorized paths only

Current status:

- `not_started`

Current blocker:

- none

Exit gate:

- the UI can trigger scans and load results without violating the chosen Cloud-safe runtime model

### Phase 6 - UX integration

Objective:

- surface discovery and mapping results inside the native Splunk-hosted catalog experience

Required scope:

- add discovery entry points to the catalog host
- add mapping badges, filters, evidence surfaces, results library views, and admin refinement surfaces
- keep the experience inside Splunk chrome and aligned with the host-page model already proven for Release 1

Current status:

- `not_started`

Current blocker:

- none

Exit gate:

- operators can discover, inspect, filter, and refine mapping results inside the app without leaving the supported host model

### Phase 7 - Verification and handoff

Objective:

- prove the discovery enhancement is packaged, installable, and operator-ready

Required scope:

- unit, integration, and synthetic-environment validation exists for every implemented slice
- generated app packaging still works cleanly
- remote install validation and operator guidance match the shipped behavior

Current status:

- `not_started`

Current blocker:

- none

Exit gate:

- tests, package output, install validation, and operator docs agree on the shipped discovery capability

## Current Next Phase

Phase 3 remains the active phase. The next implementation move is to broaden
bounded failure coverage beyond the now-live explicit-error recency semantics
and current telemetry/index/sourcetype/source/host/data-model/field-sampling
gap paths with structured gap error records, using the same local-test,
redeploy, and exact-expression validation pattern for the next highest-value
failure branch.