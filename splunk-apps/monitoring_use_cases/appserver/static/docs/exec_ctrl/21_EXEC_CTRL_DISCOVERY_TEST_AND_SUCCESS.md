# Exec-Ctrl Discovery Test And Success

## Test Policy

A phase cannot move to `complete` without evidence.

Accepted evidence types:

- automated test output
- narrow generator or drift validation for emitted app content
- static packaging checks for new Splunk app config surfaces
- focused browser verification inside the remote Splunk target when UI behavior becomes installable
- explicit blocker evidence when completion is not yet possible

## System-Level Success Definition

The discovery enhancement succeeds when all of the following are true:

1. The app can discover deterministic local-environment signals without introducing open-ended runtime reasoning.
2. Requirement profiles, discovered datasets, mappings, and overrides are persisted in generator-owned, app-owned storage contracts.
3. Engine state and effective state remain separate and explainable.
4. Operators can inspect discovery results, mapping evidence, and override effects inside Splunk chrome.
5. Package generation, install flow, and remote validation continue to pass for `monitoring_use_cases`.

## Phase Test Matrix

### Phase 0 tests

- `D0-T1`: the repo inventory identifies the real target app and integration points
- `D0-T2`: the default runtime model is explicit and grounded in current repo evidence rather than aspirational architecture

Current evidence:

- `splunk-apps/monitoring_use_cases/default/` currently contains generator-owned app config and view metadata; discovery runtime surfaces must be introduced intentionally
- `splunk-apps/splunk-uc-recommender/default/collections.conf` and `default/savedsearches.conf` prove a native Splunk discovery pattern with no primary-app `bin/` or `restmap.conf` requirement
- `docs/exec_ctrl/make the app discover/13-exec-ctrl-starter-prompt.md` explicitly starts this effort with repo inventory and a bounded first slice

### Phase 1 tests

- `D1-T1`: the generator emits stable storage definitions for the discovery track
- `D1-T2`: the app packages a stable discovery bootstrap contract for later runtime phases

Current evidence:

- `python3 scripts/generate_monitoring_use_cases_app.py` emits `splunk-apps/monitoring_use_cases/default/collections.conf`
- the generator emits `splunk-apps/monitoring_use_cases/appserver/static/api/v1/discovery/bootstrap.json` with the runtime model, state vocabulary, collections, and schema definitions for the discovery track
- `metadata/default.meta` now exports `[collections]` so the new KV scaffolding is app-owned rather than a hidden local edit
- `python3 scripts/generate_monitoring_use_cases_app.py --check` is required to pass after regeneration so the discovery scaffolding remains deterministic

### Phase 2 tests

- `D2-T1`: requirement profile output count matches the intended catalog coverage for the chosen source slice
- `D2-T2`: emitted profiles conform to the schema and remain stable across reruns
- `D2-T3`: normalization rules are covered by unit tests for representative categories and compliance-heavy use cases

Current evidence:

- `python3 -m unittest discover -s tests -p 'test_discovery_requirements.py'` passes and covers canonical sidecar extraction plus compact-catalog fallback coverage
- `python3 scripts/generate_monitoring_use_cases_app.py` emits `splunk-apps/monitoring_use_cases/appserver/static/api/v1/discovery/requirements.json`
- the emitted requirement artifact currently records `profileCount: 6472`, `canonicalSidecarCount: 6447`, and `catalogFallbackCount: 25`
- `python3 scripts/generate_monitoring_use_cases_app.py --check` passes after regeneration, proving the requirement artifact is stable across reruns

### Phase 3 tests

- `D3-T1`: discovery scans populate deterministic dataset and scan-run records using bounded local signals
- `D3-T2`: failure paths preserve the last successful scan state
- `D3-T3`: scan logs and telemetry are emitted for every stage

Current evidence:

- `python3 -m unittest tests.test_monitoring_use_cases_generator tests.test_discovery_requirements` passes
- `python3 -m unittest tests.test_monitoring_use_cases_generator` now passes with six focused tests covering stale-error recovery markers in the summary SPL, latest-snapshot `snapshot_source` preservation and current-only count markers in the summary SPL, full static API-tree preservation during app render, and generated install-build emission in `default/app.conf`
- `python3 scripts/generate_monitoring_use_cases_app.py --check` passes
- `python3 -m unittest tests.test_monitoring_use_cases_generator` now covers generated `default/transforms.conf` KV lookup definitions for `muc_requirement_profiles`, `muc_discovered_datasets`, `muc_use_case_mappings`, `muc_mapping_overrides`, `muc_scan_runs`, `muc_scan_logs`, and `muc_adjacency_registry`
- `python3 scripts/generate_monitoring_use_cases_app.py` now emits `splunk-apps/monitoring_use_cases/default/savedsearches.conf` with bounded metadata inventory searches for indexes, sourcetypes, sources, hosts, data models, field sampling, and stage telemetry plus a latest-snapshot scan summary search
- `python3 scripts/generate_monitoring_use_cases_app.py` now emits `splunk-apps/monitoring_use_cases/default/transforms.conf`, registering the discovery KV collections as lookup definitions so `inputlookup` and `outputlookup` can resolve them at runtime after redeploy
- `splunk-apps/monitoring_use_cases/default/savedsearches.conf` now keeps the prior latest-snapshot origin slice for index, sourcetype, source, host, and data-model inventory stages when a stage emits no current rows or only partially reruns a slice, via generator-owned `_slice_priority`, `_preserve_scope`, `sort 0 _preserve_scope - _slice_priority`, and `dedup _preserve_scope` precedence in the emitted SPL; the preserved rows now retain `snapshot_source`, and the field-sampling join plus summary `datasets_discovered` and stage counts now scope to `snapshot_source="current"` rows so prior preserved rows cannot masquerade as a healthy current refresh; the generator also flattens saved-search SPL onto single-line `search = ...` values so Splunk persists the full search body instead of truncating at the first physical line
- `splunk-apps/monitoring_use_cases/default/savedsearches.conf` now emits bounded failure markers in the inventory-summary search for explicit `muc_scan_logs level="error"` rows plus telemetry-missing, index-missing, sourcetype, source, host, data-model, and field-sampling gap paths, including `max(eval(case(level!="error", logged_at, true(), null()))) as latest_telemetry_logged_at`, `eval logged_error_at=logged_at, logged_error_details=coalesce(details_json, "null")`, `active_logged_failed_stage=if(...)`, `failed_stage=coalesce(active_logged_failed_stage, gap_failed_stage)`, `status=case(isnotnull(active_logged_failed_stage), "failed", isnotnull(gap_failed_stage), "degraded", true(), status)`, `gap_error_message=case(...)`, `gap_error_details=if(isnotnull(gap_failed_stage), ...)`, `failure_record_json=case(isnotnull(active_logged_failed_stage), ...)`, prior-success summary carry-forward via `prior_datasets_discovered`, and escaped `summary_json=printf("{\\"datasets_discovered\\":...")` with `telemetry_stage_count`, `rest_data_model_count`, and `error_record` included in the emitted payload; the telemetry snapshot search also preserves prior `level="error"` rows during `muc_scan_logs` rewrites, the summary counts only non-error telemetry rows via `count(eval(level!="error"))`, and stale preserved explicit errors stop controlling `failed_stage`, `status`, `error_summary`, and `summary_json` once a newer healthy telemetry refresh exists
- `splunk-apps/monitoring_use_cases/appserver/static/api/v1/discovery/bootstrap.json` now records the Phase 3 scaffold contract, including `latestSnapshotRunId`, scan modes, inventory caps, discovered-dataset schema fields for `fields`, `datamodels`, and `supporting_apps`, `scanLog` schema fields for `record_count` and `details_json`, and `scanRun` schema fields for `failed_stage`, `summary_json`, and `status="degraded"`
- `splunk-apps/monitoring_use_cases/default/app.conf` now emits `build = 202604210924260200`, `splunk-apps/monitoring_use_cases/appserver/static/api/v1` again contains `7731` regular files with first-level entries `README.md`, `compliance`, `context.jsonld`, `discovery`, `equipment`, `manifest.json`, `mitre`, `openapi.yaml`, `oscal`, and `recommender`, and the refreshed archive `dist/monitoring_use_cases-7.1.0.spl` packages the full `8147`-file app payload so same-version browser reinstalls refresh the complete deployed app
- the refreshed archive `dist/monitoring_use_cases-7.1.0.spl` was reinstalled successfully through Splunk App Management in the logged-in browser session after the stale-error recovery and packaging-path repairs were packaged
- live runtime validation against the redeployed app now proves `inputlookup muc_discovered_datasets` and `inputlookup muc_scan_runs` resolve inside the `monitoring_use_cases` app namespace and the `Monitoring Use Cases - Discovery Sourcetype Inventory` saved search is visible through the runtime config endpoint with `_slice_priority`, `sort 0 _preserve_scope - _slice_priority`, and `dedup _preserve_scope` present in the deployed search body and no `current_slice_count` gate remaining
- a live synthetic zero-output probe now passes inside Splunk: a seeded `metadata_sourcetype` row in `muc_discovered_datasets` survived the shipped preservation pattern unchanged for validation run id `inventory_snapshot_validation_1776878442`
- a live synthetic partial-rerun probe now passes inside Splunk for validation origin `metadata_sourcetype_partial_validation_1776881801`: two seeded latest-snapshot rows for `synthetic::keep` and `synthetic::replace` were rewritten so `synthetic::keep` remained `prior keep` while `synthetic::replace` became `current replace`
- a live synthetic degraded-summary probe now passes inside Splunk for validation run id `inventory_snapshot_validation_1776878442`: `muc_scan_runs` stored `status=degraded`, `failed_stage=inventory_sourcetypes`, preserved `datasets_discovered=7` from the prior successful row, and `summary_json` recorded `observed_datasets_discovered` separately with `preserved_snapshot=true`
- the deployed `Monitoring Use Cases - Discovery Inventory Summary` search body is now visible through Splunk REST with `telemetry_stage_count`, `rest_data_model_count`, `inventory_telemetry`, `inventory_indexes`, and `inventory_cim` present in the installed search definition
- live synthetic probes that execute the exact deployed `failed_stage=case(...)` expression now pass inside Splunk: a telemetry-missing scenario resolves to `inventory_telemetry`, an index-missing scenario resolves to `inventory_indexes`, and a data-model-missing scenario resolves to `inventory_cim`
- the deployed `Monitoring Use Cases - Discovery Inventory Summary` search body is now also visible through Splunk REST with `max(eval(case(level!="error", logged_at, true(), null()))) as latest_telemetry_logged_at`, `eval logged_error_at=logged_at, logged_error_details=coalesce(details_json, "null")`, `active_logged_failed_stage=if(isnotnull(logged_failed_stage) AND (isnull(latest_telemetry_logged_at) OR latest_telemetry_logged_at="" OR logged_error_at>=latest_telemetry_logged_at), logged_failed_stage, null())`, `failed_stage=coalesce(active_logged_failed_stage, gap_failed_stage)`, `status=case(isnotnull(active_logged_failed_stage), "failed", isnotnull(gap_failed_stage), "degraded", true(), status)`, and `\"error_record\":%s` present in the installed search definition
- a live synthetic explicit-error probe now passes against the deployed summary expressions inside Splunk: `logged_failed_stage="inventory_sources"` forced `status=failed`, preserved `datasets_discovered=7` and `use_cases_direct=11` from the prior successful row, returned `error_summary="Synthetic stage failure"`, and wrote `summary_json` with `"error_record":{"reason":"synthetic validation"}` and `"preserved_snapshot":true`
- live stale-versus-fresh explicit-error recency probes now also pass against the exact deployed summary expressions inside Splunk: Scenario A with `logged_error_at="2026-04-22T16:05:00Z"` and `latest_telemetry_logged_at="2026-04-22T16:10:00Z"` resolves `active_logged_failed_stage=""`, `failed_stage=""`, `status=complete`, `datasets_discovered=2`, `use_cases_direct=1`, no matching `error_record`, and no `preserved_snapshot=true`; Scenario B with `logged_error_at="2026-04-22T16:15:00Z"` resolves `active_logged_failed_stage="inventory_sources"`, `failed_stage="inventory_sources"`, `status=failed`, preserved `datasets_discovered=7`, `use_cases_direct=11`, `error_summary="Fresh failure"`, and `summary_json` with the matching fresh `error_record` plus `preserved_snapshot=true`
- a live synthetic field-sampling gap-versus-healthy probe now also passes against the exact deployed summary expressions inside Splunk: Scenario A with `field_sampled_count=0` resolves `failed_stage="inventory_fields"`, `status=degraded`, preserves `datasets_discovered=2` while `summary_json` records `observed_datasets_discovered=7`, returns `error_summary="Field sampling produced no records; preserving prior successful snapshot summary where available."`, and writes both `failure_record_json` and `summary_json.error_record` as a structured gap object with `kind="gap"`, `stage="inventory_fields"`, the bounded gap message, and the stage-count telemetry fields plus `preserved_snapshot=true`; Scenario B with `field_sampled_count=8` resolves `status=complete`, keeps `datasets_discovered=7`, clears `failed_stage`, and leaves both `failure_record_json` and `summary_json.error_record` null with `preserved_snapshot=false`
- the deployed `Monitoring Use Cases - Discovery Field Sample`, `Monitoring Use Cases - Discovery Telemetry Snapshot`, and `Monitoring Use Cases - Discovery Inventory Summary` search bodies are now also visible through Splunk REST with `search origin=metadata_sourcetype scan_run_id="inventory_snapshot_latest" snapshot_source="current"` present in the installed field-sample definition, `search scan_run_id="inventory_snapshot_latest" snapshot_source="current" | stats count(eval(origin="metadata_index")) as metadata_index_count` present in the installed telemetry-snapshot definition, and `search scan_run_id="inventory_snapshot_latest" snapshot_source="current" | stats count as datasets_discovered` present in the installed inventory-summary definition
- a live synthetic current-gap-versus-healthy probe now also passes against the exact deployed summary expressions inside Splunk: Scenario A with current counts forced to zero and `prior_datasets_discovered=27` resolves `status=degraded`, `failed_stage="inventory_indexes"`, preserves `datasets_discovered=27`, returns the bounded index-gap `error_summary`, and writes `summary_json` with `"observed_datasets_discovered":0` plus `"preserved_snapshot":true`; Scenario B with healthy current counts resolves `status=complete`, clears `failed_stage`, keeps `datasets_discovered=11`, and writes `summary_json` with `"observed_datasets_discovered":11` plus `"preserved_snapshot":false`
- the deployed `Monitoring Use Cases - Discovery Telemetry Snapshot` search body is now also visible through Splunk REST with `fields _key log_id scan_run_id stage level logged_at message record_count details_json` and `append [ | inputlookup muc_scan_logs | search scan_run_id="inventory_snapshot_latest" level="error" | fields _key log_id scan_run_id stage level logged_at message record_count details_json ]` present in the installed search definition, while the deployed inventory summary search now also proves `count(eval(level!="error")) as telemetry_stage_count`
- a live telemetry-preservation probe now passes against the deployed searches inside Splunk: after seeding a synthetic `level="error"` row into `muc_scan_logs` and running the exact deployed telemetry search body as a real job, the error row survived the refresh, post-refresh stats returned `total_rows=7`, `error_rows=1`, and `telemetry_stage_count=6`, and cleanup removed the synthetic row successfully
- live probe cleanup also passed: synthetic rows for validation run id `inventory_snapshot_validation_1776878442` were removed from `muc_discovered_datasets`, `muc_scan_logs`, and `muc_scan_runs`, and follow-up queries returned zero remaining rows in all three collections
- live partial-rerun probe cleanup also passed: synthetic rows for validation origin `metadata_sourcetype_partial_validation_1776881801` were removed from `muc_discovered_datasets`, and follow-up total-row queries returned the expected zero-row baseline for `muc_discovered_datasets`, `muc_scan_logs`, and `muc_scan_runs`

### Phase 4 tests

- `D4-T1`: direct, adjacent, partial, and none mappings are deterministic for synthetic fixtures
- `D4-T2`: effective state honors admin overrides without mutating engine state
- `D4-T3`: evidence and missing-requirement serialization remain explainable and stable

### Phase 5 tests

- `D5-T1`: the UI can start or observe scans through the chosen saved-search and KV-store model
- `D5-T2`: logical response shapes remain stable even if no custom REST layer exists yet
- `D5-T3`: mutation paths are admin-gated and read paths remain side-effect free

### Phase 6 tests

- `D6-T1`: catalog badges, filters, and evidence surfaces render correctly inside the supported host model
- `D6-T2`: results library and admin refinement views work inside Splunk chrome without route or asset regressions
- `D6-T3`: accessibility and responsive checks pass for the new discovery surfaces

### Phase 7 tests

- `D7-T1`: unit, integration, and synthetic-environment suites pass for the full implemented slice set
- `D7-T2`: package generation and remote install validation still pass for `monitoring_use_cases`
- `D7-T3`: operator and admin docs match the shipped behavior and upgrade path

## Known Evidence Gap

- Phase 3 runtime execution inside Splunk is now validated for the bounded zero-output, partial-rerun, current-gap-versus-healthy summary counting, degraded-summary, explicit-error-summary, telemetry-error-row preservation, stale-versus-fresh explicit-error recovery, and deployed `failed_stage` telemetry/index/data-model/field-sampling paths: the current evidence proves generator-owned inventory scaffolding, generated KV lookup definitions, latest-snapshot slice preservation for inventory stages on zero-output and partial reruns, preserved-row `snapshot_source` tracking, current-only counting for field-sampling and summary-level dataset/stage counts, Splunk-compatible saved-search serialization, full static API-tree preservation in the packaged app, telemetry, bounded failure-handling contract emission for explicit scan-log errors plus telemetry-recency gating and telemetry, index, sourcetype, source, host, data-model, and field-sampling gap paths, summary-level prior-success carry-forward in `muc_scan_runs`, sanitized `error_record` carry-forward in `summary_json`, structured gap `failure_record_json` emission for bounded degraded paths, preservation of explicit error rows across telemetry refreshes, and live synthetic proof of those behaviors after redeploy. Remaining evidence gaps are live operator-triggered scan behavior and additional failure modes beyond the current bounded checks.
- mapping state, orchestration, and discovery UI behavior are still unimplemented beyond the saved-search contract scaffold