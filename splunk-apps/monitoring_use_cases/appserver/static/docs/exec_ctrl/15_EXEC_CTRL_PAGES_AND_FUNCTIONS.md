# Exec-Ctrl Pages And Functions

## Page Inventory

This matrix defines the required operator surfaces for the packaged catalog app.

| Surface | Purpose | Required actions | Current state | Release target |
| --- | --- | --- | --- | --- |
| Catalog host page | Launch or otherwise reach the compiled catalog from inside Splunk | open app, reach `/static/app/monitoring_use_cases/index.html#overview`, preserve a supported host-page model | `complete` | Release 1 |
| Static catalog entry point | Render the same overview and drill-in experience as the compiled site | search, filter, sort, inspect use cases, deep-link into detail | `complete` | Release 1 |
| Companion pages | Preserve linked pages used from the main catalog | open API docs, scorecard, primer, clause navigator, compliance story, data sizing tool | `complete` | Release 1 |
| Packaging and install surface | Turn the compiled site into an installable Splunk app | build site, generate app tree, package `.spl`, install on remote host | `complete` | Release 1 |

## Backend Function Inventory

| Function | Current owner | Current state | Notes |
| --- | --- | --- | --- |
| Static site build | `python3 tools/build/build.py --out dist` | `complete` | This is the real compiled app artifact. |
| Splunk catalog app generation | `python3 scripts/generate_monitoring_use_cases_app.py` | `complete` | Creates `splunk-apps/monitoring_use_cases/` from a reproducible site build. |
| Base-path adaptation | build-time `SITE_URL` + runtime override globals | `complete` | The generator bakes `/static/app/monitoring_use_cases` into the packaged site build. |
| Host view generation | `python3 scripts/generate_monitoring_use_cases_app.py` | `complete` | Writes scripted dashboard host views for the catalog and companion routes; live validation shows the packaged static pages now render inside Splunk chrome. |
| Splunk Search deep-link generation | `src/scripts/04-panel.js` + `src/scripts/02-filters.js` | `complete` | SPL-like code blocks now expose same-window `Open in Splunk Search` actions inside the hosted catalog. |
| Package archiving | `scripts/package_splunk_apps.sh` | `complete` | Emits plain-tar `.spl` archives and strips macOS metadata before packaging. |
| Remote install validation | authenticated browser session against the `.env`-defined target | `complete` | Remote install, the hosted catalog route, same-window Search deep links, all companion routes, and in-host internal catalog navigation are now proven. |

## API Or Interface Inventory

The packaged app depends on these current interfaces:

- compiled site output under `dist/`
- static asset base path under `/static/app/monitoring_use_cases/`
- compiled API payloads under `/static/app/monitoring_use_cases/api/`
- compiled asset payloads under `/static/app/monitoring_use_cases/assets/`
- companion static pages under the same app static root
- the workspace root `.env` file for remote Splunk target, certificate, and authentication settings

## Required New Function Groups

- deterministic app generator for `splunk-apps/monitoring_use_cases/` completed by `scripts/generate_monitoring_use_cases_app.py`
- site build wrapper that sets the correct Splunk app base path completed inside the generator via `SITE_URL=/static/app/monitoring_use_cases`
- Splunk host pages and navigation for the packaged static catalog generated in the app tree and proven across catalog and companion routes on the remote target
- companion-page smoke validation for the packaged app completed on the remote Splunk target

## Operator Flow Ownership

The execution control rule for this project is:

- every operator action must map to one of the surfaces above
- every surface action must map to a data interface or backend capability listed above
- every emitted asset in `splunk-apps/monitoring_use_cases/` must map back to `dist/` or generator-owned app metadata rather than a manual one-off edit