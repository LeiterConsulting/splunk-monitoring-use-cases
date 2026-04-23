# Exec-Ctrl Discovery Overview

## Purpose

This exec-ctrl series activates the next enhancement track for
`monitoring_use_cases`: deterministic environment discovery, use-case mapping,
results persistence, and admin refinement inside the native Splunk app.

It exists to:

- convert the design pack in `docs/exec_ctrl/make the app discover/` into live repo-controlled work
- lock the runtime model before deeper implementation starts
- define the gated delivery ladder and required evidence for each phase
- keep follow-on work aligned with the generator-owned packaging model already proven for Release 1

## What This Series Controls

Docs in this folder control the live work for:

- generator-owned enhancements to `splunk-apps/monitoring_use_cases/`
- deterministic storage, discovery, mapping, and override persistence for the native Splunk app
- catalog-integrated discovery actions, badges, filters, results views, and admin refinement surfaces
- package, install, and regression validation for the discovery enhancement

## Authority Order

Use this order whenever docs disagree:

1. explicit user direction in the active conversation
2. `22_EXEC_CTRL_DISCOVERY_STATUS.md`
3. `20_EXEC_CTRL_DISCOVERY_PHASE_PLAN.md`
4. `21_EXEC_CTRL_DISCOVERY_TEST_AND_SUCCESS.md`
5. the design pack in `docs/exec_ctrl/make the app discover/`, especially `01-product-architecture.md`, `02-runtime-design.md`, `04-data-model-and-storage.md`, `08-exec-ctrl-delivery-plan.md`, `09-agent-task-graph.md`, and `11-api-contracts-and-endpoints.md`
6. existing repo docs and implementation surfaces, especially `scripts/generate_monitoring_use_cases_app.py`, `docs/recommender-app.md`, `splunk-apps/splunk-uc-recommender/default/collections.conf`, and `splunk-apps/splunk-uc-recommender/default/savedsearches.conf`

## Runtime Model Decision

- `monitoring_use_cases` is generator-owned and static-first. Before this track it had no native storage or discovery runtime surface beyond generated views and static assets.
- `splunk-uc-recommender` already proves a Cloud-safe local-discovery model using KV Store collections, scheduled saved searches, and browser-side SplunkJS without a primary-app `bin/` or `restmap.conf` surface.
- This track therefore defaults to saved-search, KV-store, and browser orchestration for local discovery and mapping.
- `11-api-contracts-and-endpoints.md` is treated as the logical frontend contract shape. It is not, by itself, approval to introduce custom REST endpoints into the app.
- Custom REST surfaces are deferred until a later phase proves the saved-search and KV-store model is insufficient.

## Required Update Behavior

When implementation changes, the authoritative docs in this track must be
updated in the same work cycle.

Minimum rule set:

- update `22_EXEC_CTRL_DISCOVERY_STATUS.md` whenever real completion status changes
- update `20_EXEC_CTRL_DISCOVERY_PHASE_PLAN.md` whenever a phase gate or blocker changes
- update `21_EXEC_CTRL_DISCOVERY_TEST_AND_SUCCESS.md` whenever a new test or evidence source becomes required

## Current Control Point

What is already real:

- the Release 1 catalog-hosting ladder is complete and stable
- the design pack has been read in full and reconciled with the current repo structure
- Phase 0 inventory is complete: `monitoring_use_cases` is the target app, its runtime is generator-owned, and the closest native discovery precedent is `splunk-uc-recommender`
- Phase 1 schema and storage scaffolding is now generator-owned: `scripts/generate_monitoring_use_cases_app.py` emits `default/collections.conf`, `default/transforms.conf`, `metadata/default.meta` collection export, and `appserver/static/api/v1/discovery/bootstrap.json`
- Phase 2 requirement normalization is now generator-owned: `scripts/discovery_requirements.py` and `scripts/generate_monitoring_use_cases_app.py` emit `appserver/static/api/v1/discovery/requirements.json` with deterministic catalog coverage using canonical sidecars plus compact-catalog fallback records
- Phase 3 has advanced to a generator-owned metadata, data-model, field-sampling, telemetry, and bounded failure-handling scaffold: `scripts/generate_monitoring_use_cases_app.py` now emits `default/savedsearches.conf` for bounded index, sourcetype, source, host, data-model, field-prevalence, and scan-telemetry searches plus a latest-snapshot `muc_scan_runs` summary record with stage-specific `failed_stage`, `status=failed` when `muc_scan_logs` reports an active explicit stage error, `status=degraded` for bounded gap paths, explicit `gap_error_message`, `gap_error_details`, and `failure_record_json` synthesis for bounded gap failures, escaped `summary_json` including `error_record`, prior-success summary carry-forward across explicit error rows plus telemetry-missing, index-missing, sourcetype, source, host, data-model, and field-sampling gap paths, and bounded latest-snapshot origin-slice preservation for index, sourcetype, source, host, and data-model inventories when a stage emits no current rows or only partially refreshes a slice, by preferring current rows per `dataset_key` and retaining unmatched prior rows; those preserved dataset rows now retain `snapshot_source` so later searches can distinguish current rows from carried-forward prior rows, the field-sampling join and inventory-summary counts now read only `snapshot_source="current"` rows, the telemetry snapshot now also preserves prior explicit `level="error"` rows when it rewrites `muc_scan_logs`, while the summary derives `telemetry_stage_count` and stage counts from non-error rows only so preserved error rows do not distort bounded gap detection, and preserved explicit errors only remain active when their `logged_error_at` is at least as new as the latest non-error telemetry refresh; `bootstrap.json` exposes the scan-mode, inventory-cap, and saved-search contract for later UI orchestration, the generator now serializes saved-search SPL onto single-line `search = ...` values so Splunk persists the full search body, preserves the full static API tree during app render, emits a generated install `build` value so same-version Splunk reinstalls refresh deployed config, and the redeployed remote app now proves the bounded zero-output slice-preservation, partial-rerun slice-preservation, current-gap-versus-healthy summary counting, degraded-summary, explicit error-summary carry-forward, telemetry error-row preservation, stale-versus-fresh explicit-error recovery, and deployed `failed_stage` telemetry/index/data-model plus structured field-sampling gap-versus-healthy `error_record` branches live inside Splunk through synthetic validation

What is not yet real:

- browser orchestration or operator-triggered discovery scans in `monitoring_use_cases`
- broader failure-mode handling for the discovery engine beyond the current explicit scan-log error path plus telemetry, index, sourcetype, source, host, data-model, and field-sampling gap checks
- persisted mappings, overrides, results-library pages, or admin refinement views

The active phase is Phase 3 because the repo inventory, runtime-model decision,
schema/storage baseline, and requirement-normalization artifact are now
explicit and generator-owned.