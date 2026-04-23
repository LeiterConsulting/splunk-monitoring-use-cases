# Exec-Ctrl Phase Plan

## Phase Control Rule

The active phase is the earliest phase that is not `complete`.

Later work may be designed, but the next implementation move is controlled by
the active phase.

## Phase Ladder

| Phase | Name | Status | Exit control |
| --- | --- | --- | --- |
| 0 | Foundation baseline | `complete` | Correct product boundary, app id, and packaging source are explicit |
| 1 | Catalog app generator | `complete` | The compiled `dist/` site becomes a materialized Splunk app tree |
| 2 | Host view and static routing | `complete` | Splunk host view opens the packaged catalog correctly |
| 3 | Companion page coverage | `complete` | Linked static pages and tools resolve correctly inside the app |
| 4 | Package coherence and archive output | `complete` | Generated app, packaging, and default metadata are coherent end to end |
| 5 | UX hardening and readiness | `complete` | Responsiveness, accessibility, pathing, and AppInspect-relevant checks have evidence |
| 6 | Remote install and handoff | `complete` | Installable package, remote smoke validation, and operator guidance are complete |

## Phase Detail

### Phase 0 - Foundation baseline

Objective:

- define the real source-of-truth boundaries and the first technical gate

Required scope:

- activate the exec-ctrl project-pack docs
- define the product target and non-goals
- identify the compiled site source of truth: `tools/build/build.py --out dist`
- define the Splunk app id and static host path: `monitoring_use_cases`

Current status:

- control docs are active
- the compiled site source and base-path override mechanism are identified
- the package-first workflow is explicit for a remote Splunk target
- the workspace root `.env` file is established as the local authority for remote-target validation settings

Current blocker:

- none

Exit gate:

- the repo has authoritative control docs and a concrete packaging contract that implementation can follow immediately

### Phase 1 - Catalog app generator

Objective:

- create the generator that turns the compiled site into a Splunk app tree

Required scope:

- add a generator for `splunk-apps/monitoring_use_cases/`
- build the site with a base path for `/static/app/monitoring_use_cases`
- copy the compiled site into `appserver/static/`
- generate app metadata, nav, and host view files
- keep the workflow package-first so local development does not rely on the Splunk host running on this machine

Current status:

- `complete`

Current blocker:

- none

Exit gate:

- a reproducible site build emits the correct base-path-adjusted `dist/`, and the generator places it into the installable app tree

### Phase 2 - Host view and static routing

Objective:

- make the packaged app open the compiled catalog correctly inside Splunk

Required scope:

- add the default host view and navigation entry
- ensure `index.html#overview` loads under `/static/app/monitoring_use_cases/`
- ensure API and asset paths resolve from inside Splunk
- settle on a Splunk-supported host-page model if SimpleXML strips the generated `iframe`

Current status:

- `complete`

Current blocker:

- none

Exit gate:

- operators can open the app in Splunk and reach the compiled catalog overview through a supported host model without path or asset failures

### Phase 3 - Companion page coverage

Objective:

- preserve the linked companion pages used by the catalog

Required scope:

- ensure API docs, scorecard, regulatory primer, clause navigator, compliance story, and data sizing pages resolve inside the app static root
- verify links and hash-based navigation survive Splunk hosting

Current status:

- `complete`

Current blocker:

- none

Exit gate:

- all planned Release 1 linked static surfaces exist in the packaged app

### Phase 4 - Package coherence and archive output

Objective:

- make the generated app tree and archive output coherent end to end

Required scope:

- generated app metadata, nav, host view, and static files are consistent
- explicit packaging command emits a `.spl` archive for the new app
- generated output no longer depends on manual edits inside emitted app files

Current status:

- `complete`

Current blocker:

- none

Exit gate:

- the generated app package has a single coherent runtime path for Release 1

### Phase 5 - UX hardening and readiness

Objective:

- bring the packaged catalog app to operator-ready quality

Required scope:

- responsive behavior works in the supported Splunk host-page or launch model
- accessibility and readability checks are satisfied for the packaged catalog
- AppInspect-relevant static app constraints are reviewed against the new package path

Current status:

- `complete`

Current blocker:

- none

Exit gate:

- quality evidence exists for the shipped package structure and user-visible behavior

### Phase 6 - Remote install and handoff

Objective:

- prove the app is ready to install and hand off

Required scope:

- package build is reproducible
- install and smoke validation is recorded against the remote Splunk environment that will receive the app package
- release and operator docs match actual shipped behavior

Current status:

- `complete`

Current blocker:

- none

Exit gate:

- install evidence, release packaging, and operator guidance all exist and agree

## Current Next Phase

There is no remaining active phase in the current ladder. Phases 0 through 6
are complete. Post-Release-1 discovery and mapping work now continues in
`19_EXEC_CTRL_DISCOVERY_OVERVIEW.md` through `22_EXEC_CTRL_DISCOVERY_STATUS.md`.