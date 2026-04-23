# Exec-Ctrl Overview

## Purpose

This exec-ctrl series turns the current repository state into an authoritative
execution system for packaging the compiled monitoring-use-cases catalog as an
installable Splunk app.

It exists to:

- define the correct product boundary from the live repo state
- define the required app surfaces, generator boundary, and package path
- define the delivery ladder and the gate for each phase
- define what evidence is required before a phase can be marked complete
- define the next implementation move based on actual completion status

## What This Series Controls

Docs in this folder control the live work for:

- the compiled site emitted by `python3 tools/build/build.py --out dist`
- the future Splunk app package `monitoring_use_cases`
- the generator that will materialize `splunk-apps/monitoring_use_cases/`
- package, install, and remote-runtime validation for that app
- the workspace root `.env` file as the local authority for remote Splunk web, REST, HEC, certificate, and authentication settings used during validation

These docs do not replace the repo's existing architecture or build docs. They
sit on top of them and convert the work into an execution discipline.

## Authority Order

Use this order whenever docs disagree:

1. explicit user direction in the active conversation
2. `18_EXEC_CTRL_STATUS.md`
3. `16_EXEC_CTRL_PHASE_PLAN.md`
4. `17_EXEC_CTRL_TEST_AND_SUCCESS.md`
5. `14_EXEC_CTRL_TARGET_PRODUCT.md`
6. `15_EXEC_CTRL_PAGES_AND_FUNCTIONS.md`
7. existing repo docs that describe the current system, especially `README.md`, `docs/architecture.md`, `docs/enterprise-deployment.md`, `tools/build/build.py`, and `src/scripts/00-loader.js`

## Required Update Behavior

When implementation changes, the authoritative docs in this folder must be
updated in the same work cycle.

Minimum rule set:

- update `18_EXEC_CTRL_STATUS.md` whenever real completion status changes
- update `16_EXEC_CTRL_PHASE_PLAN.md` whenever a phase gate or blocker changes
- update `17_EXEC_CTRL_TEST_AND_SUCCESS.md` whenever a new test or evidence source becomes required
- update `15_EXEC_CTRL_PAGES_AND_FUNCTIONS.md` whenever a major package surface or function owner changes
- update `14_EXEC_CTRL_TARGET_PRODUCT.md` if the release target or non-goals materially change

## Status Vocabulary

Use only these execution states:

- `not_started`
- `in_progress`
- `blocked`
- `complete`
- `deferred`

## Advancement Rule

The active phase is the earliest phase that is not `complete`.

Rules:

- later phases may be designed while an earlier phase is open
- later phases may not be claimed complete while an earlier dependent phase is incomplete
- a blocked phase remains the active phase until the blocker is removed or direction changes
- evidence is required before any phase changes to `complete`

## Document Roles

- `14_EXEC_CTRL_TARGET_PRODUCT.md`: finished product definition for the Splunk-hosted catalog app
- `15_EXEC_CTRL_PAGES_AND_FUNCTIONS.md`: required surfaces, interfaces, and capability ownership
- `16_EXEC_CTRL_PHASE_PLAN.md`: gated delivery ladder for the packaging effort
- `17_EXEC_CTRL_TEST_AND_SUCCESS.md`: authoritative test and evidence model
- `18_EXEC_CTRL_STATUS.md`: live snapshot and controller for the next implementation move

## Current Control Point

What is already real:

- the Release 1 packaging ladder for the in-Splunk catalog app is complete and remains controlled by `14_EXEC_CTRL_TARGET_PRODUCT.md` through `18_EXEC_CTRL_STATUS.md`
- the public catalog is compiled by `tools/build/build.py` into `dist/`, and `python3 scripts/generate_monitoring_use_cases_app.py` materializes the generated app tree under `splunk-apps/monitoring_use_cases/`
- the generated app is installable, generator-owned, reproducible, and validated against the remote Splunk target defined by the workspace root `.env` file
- the next feature design pack under `docs/exec_ctrl/make the app discover/` has been fully read and mapped onto the current repo structure
- `monitoring_use_cases` remains static-first and generator-owned, while `splunk-uc-recommender` already proves a Cloud-safe local inventory model based on `default/collections.conf`, `default/savedsearches.conf`, and browser-side SplunkJS without a primary-app `bin/` or `restmap.conf`
- the new discovery enhancement track is now controlled by `19_EXEC_CTRL_DISCOVERY_OVERVIEW.md` through `22_EXEC_CTRL_DISCOVERY_STATUS.md`

What is not yet real:

- deterministic local discovery scans and persisted dataset records inside `monitoring_use_cases`
- use-case mapping results, override handling, results-library views, and admin refinement surfaces

The Release 1 ladder is closed. Active follow-on work now starts in the
discovery enhancement series, where Phase 3 discovery-engine work is the next
implementation gate after the runtime-model, schema/storage baseline, and
requirement-normalization artifact are generator-owned.