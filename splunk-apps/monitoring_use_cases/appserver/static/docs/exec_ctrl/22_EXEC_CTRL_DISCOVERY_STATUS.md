# Exec-Ctrl Discovery Status

## Snapshot Date

2026-04-23

## Executive Status

The Release 1 catalog-hosting ladder is complete, and the next enhancement
track is now active for deterministic environment discovery and use-case
mapping inside `monitoring_use_cases`. Repo inventory confirms that the target
app is generator-owned and static-first, while `splunk-uc-recommender` already
proves a Cloud-safe discovery pattern using KV Store collections, scheduled
saved searches, and browser-side SplunkJS without a primary-app `bin/` or
`restmap.conf` surface. That runtime model is now the default for this track.
Phase 0 and Phase 1 are complete: the control docs capture the chosen runtime
model, and the generator now emits discovery bootstrap schemas plus KV Store
collection scaffolding into `monitoring_use_cases`. Phase 2 is also complete:
the generator now emits deterministic requirement profiles into the packaged
app using canonical sidecars plus compact-catalog fallback records. Phase 3
discovery-engine work is now in progress: the generator emits bounded metadata
and data-model inventory saved searches, bounded field sampling, stage
telemetry, a `default/transforms.conf` KV lookup bridge for the discovery
collections, plus a latest-snapshot scan summary with bounded failure handling
for explicit scan-log errors and telemetry, index, sourcetype, source, host,
data-model, and field-sampling gap paths, prior-success summary carry-forward
in `muc_scan_runs`, sanitized `error_record` carry-forward in `summary_json`,
structured `gap_error_message`, `gap_error_details`, and `failure_record_json`
emission for bounded degraded paths, preservation of prior explicit error rows
across telemetry refreshes, explicit-error recency gating so stale preserved
errors stop pinning later healthy snapshots to `failed`, zero-output latest-
snapshot slice preservation for inventory-stage dataset records, and current-
only summary counting via preserved-row `snapshot_source` tracking so carried-
forward prior rows cannot mask a current-stage gap. The redeployed remote app
now proves those bounded paths live through synthetic validation, but the rest
of the discovery engine is still incomplete.

## Current Phase State

| Phase | Status | Summary |
| --- | --- | --- |
| 0 - Inventory and runtime model | `complete` | The target app, integration points, and default Cloud-safe runtime model are explicit. |
| 1 - Schemas and storage baseline | `complete` | The generator now emits discovery bootstrap schemas and KV collection definitions. |
| 2 - Requirement normalization | `complete` | The app now emits deterministic requirement profiles with canonical sidecar coverage plus compact-catalog fallback records. |
| 3 - Discovery engine | `in_progress` | The app now emits bounded metadata and data-model inventory searches, bounded field sampling, stage telemetry, generated KV lookup definitions, a latest-snapshot scan summary with bounded explicit-error plus telemetry/index/sourcetype/source/host/data-model/field-sampling `failed_stage`, `failed` or `degraded` signaling, prior-success summary preservation, sanitized `error_record` carry-forward, structured gap `failure_record_json` emission, preservation of explicit error rows across telemetry refreshes, explicit-error recency gating so stale preserved errors stop controlling later healthy snapshots, latest-snapshot inventory-slice preservation for zero-output and partial reruns, and preserved-row `snapshot_source` tracking with current-only summary counts so prior rows cannot mask a current-stage gap, and those bounded paths are now live-validated after redeploy. Additional failure coverage is still missing. |
| 4 - Mapping engine | `not_started` | No deterministic mapping state or evidence model exists yet. |
| 5 - Orchestration interface | `not_started` | No scan orchestration or logical result-reading interface exists yet. |
| 6 - UX integration | `not_started` | No discovery badges, results library, or admin refinement views exist yet. |
| 7 - Verification and handoff | `not_started` | Discovery-specific tests, install evidence, and operator docs do not exist yet. |

## What Is Already True

- the Release 1 package and remote Splunk validation path for `monitoring_use_cases` remain complete
- the design pack in `docs/exec_ctrl/make the app discover/` has been read in full and reconciled with current repo structure
- `splunk-apps/monitoring_use_cases/default/` now contains generator-owned discovery storage scaffolding through `collections.conf`
- `splunk-apps/monitoring_use_cases/default/transforms.conf` now contains generator-owned KV lookup definitions for the discovery collections, which the saved-search scaffold needs for `inputlookup` and `outputlookup`
- `splunk-apps/monitoring_use_cases/default/savedsearches.conf` now contains generator-owned metadata and data-model inventory scaffolding for indexes, sourcetypes, sources, hosts, data models, bounded field sampling, stage telemetry, and a latest-snapshot scan summary record with bounded failure markers for explicit scan-log errors plus telemetry, index, sourcetype, source, host, data-model, and field-sampling gap paths, prior-success summary carry-forward on failed or degraded runs, `summary_json` error-record carry-forward, structured `gap_error_message`, `gap_error_details`, and `failure_record_json` emission for bounded degraded paths, telemetry-refresh preservation of prior explicit `level="error"` rows while summary stage counts ignore those preserved error rows, and explicit-error recency gating so stale preserved errors stop controlling `failed_stage`, `status`, `error_summary`, and `summary_json` after a newer healthy telemetry refresh; the inventory stages also preserve the prior latest-snapshot origin slice when a stage emits no current rows and retain unmatched prior rows on partial reruns, those preserved rows now retain `snapshot_source`, and the field-sampling join plus summary dataset/stage counts now scope to `snapshot_source="current"` rows so carried-forward prior rows cannot mask a current-stage gap
- `splunk-apps/monitoring_use_cases/default/app.conf` now emits a generated install `build = 202604210924260200`, and `splunk-apps/monitoring_use_cases/appserver/static/api/v1` is again preserved as the full `7731`-file static API surface during app render so browser reinstalls refresh the complete deployed payload rather than only the discovery bootstrap files
- `splunk-apps/monitoring_use_cases/default/savedsearches.conf` now serializes search bodies onto single-line `search = ...` values so Splunk persists the full saved-search body through the runtime config layer
- `splunk-apps/monitoring_use_cases/metadata/default.meta` now exports `[collections]`
- `splunk-apps/monitoring_use_cases/appserver/static/api/v1/discovery/bootstrap.json` now records the runtime-model choice, state vocabulary, collection map, and baseline schema definitions for the discovery track, including `scanRun.failed_stage`, `scanRun.summary_json`, and `status="degraded"`
- `splunk-apps/monitoring_use_cases/appserver/static/api/v1/discovery/requirements.json` now records `6472` deterministic requirement profiles, including `6447` canonical sidecar-backed profiles and `25` compact-catalog fallback profiles
- the default runtime model for this feature is saved-search, KV-store, and browser orchestration; custom REST endpoints are deferred unless later phases prove them necessary
- `python3 -m unittest discover -s tests -p 'test_discovery_requirements.py'` passes and `python3 scripts/generate_monitoring_use_cases_app.py --check` passes, so Phase 2 stability evidence is in place
- `python3 -m unittest tests.test_monitoring_use_cases_generator tests.test_discovery_requirements` passes, so the Phase 3 generator scaffold is covered by focused unit tests, including the broadened degraded-run summary emission contract
- the refreshed archive `dist/monitoring_use_cases-7.1.0.spl` has been reinstalled successfully on the remote Splunk target through App Management after the stale-error recovery and packaging-path repairs
- live runtime validation now proves `inputlookup` works for `muc_discovered_datasets` and `muc_scan_runs` inside the `monitoring_use_cases` app namespace, the `Monitoring Use Cases - Discovery Sourcetype Inventory` saved search is visible at runtime with `_slice_priority`, `sort 0 _preserve_scope - _slice_priority`, and `dedup _preserve_scope` present in the deployed search body, the bounded zero-output inventory-slice preservation path passes, the bounded partial-rerun inventory-slice preservation path passes, the bounded degraded-summary preservation path passes, and the deployed `Monitoring Use Cases - Discovery Field Sample`, `Monitoring Use Cases - Discovery Inventory Summary`, and `Monitoring Use Cases - Discovery Telemetry Snapshot` search bodies now collectively prove `snapshot_source="current"`, `telemetry_stage_count`, `rest_data_model_count`, `inventory_telemetry`, `inventory_indexes`, `inventory_cim`, `latest_telemetry_logged_at`, `active_logged_failed_stage`, `failed_stage=coalesce(active_logged_failed_stage, gap_failed_stage)`, `status=case(isnotnull(active_logged_failed_stage), "failed", isnotnull(gap_failed_stage), "degraded", true(), status)`, `gap_error_message`, `gap_error_details`, `failure_record_json`, `error_record`, and preservation of explicit error rows across telemetry refreshes are installed with exact-expression probes resolving to those bounded failure states inside Splunk, including stale-versus-fresh explicit-error recovery, current-gap-versus-healthy summary counting, and field-sampling gap-versus-healthy structured-error-record validation

## Current Constraint

The app now has the first seven bounded discovery slices: metadata inventory,
data-model inspection, bounded field sampling, stage telemetry, generated KV
lookup definitions, latest-snapshot inventory-slice preservation for zero-
output and partial reruns, and a latest-snapshot scan summary with explicit-
error plus stage-specific degraded-run signaling for telemetry, index,
sourcetype, source, host, data-model, and field-sampling gap paths plus
prior-success summary preservation, sanitized error-record carry-forward,
structured gap error-record emission for bounded degraded runs, preservation of
explicit error rows across telemetry refreshes on failed or degraded runs,
recency gating so stale preserved explicit errors stop pinning later healthy
snapshots to `failed`, and preserved-row `snapshot_source` tracking with
current-only summary counts so prior carried-forward rows cannot hide a
current-stage gap. Those bounded behaviors are now live-validated in the
redeployed remote app. Additional failure-mode coverage is still missing.

## Required Next Implementation Move

Continue Phase 3 discovery engine implementation. Specifically:

1. extend `failed_stage` and failure-handling coverage beyond the current explicit scan-log error path, explicit-error recency gating, and telemetry/index/sourcetype/source/host/data-model/field-sampling gap paths with structured gap error records so later runtime and UI phases can explain where bounded discovery failed
2. keep the live-validated zero-output, partial-rerun, telemetry-error-row-preservation, and stale-versus-fresh explicit-error-recovery slices deterministic as later runtime and orchestration work begins to exercise broader scan paths

## Immediate Follow-On Backlog After The Active Phase Closes

1. add deterministic mapping-state evaluation with separate engine and effective state
2. add saved-search and browser orchestration paths for scan execution and result refresh
3. integrate mapping badges, results views, and admin refinement flows into the Splunk-hosted catalog

## Update Rule

This file must be updated whenever:

- a phase state changes
- the active blocker changes
- the recommended default path changes
- new evidence changes the next implementation move