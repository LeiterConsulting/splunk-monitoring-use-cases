# Monitoring Use Cases Catalog

App ID: `monitoring_use_cases`  
App version: **7.1.0**  
Generated: `2026-04-21T09:24:26+02:00`  
Source commit: `b596297ad3e94720fe9e3a2d1e0b9af34feb5baf`  
Catalog size: **6,447** use cases

This app packages the compiled Monitoring Use Cases site into an installable
Splunk app. The runtime entry point is:

- `/static/app/monitoring_use_cases/index.html#overview`

The app is generated from `python3 tools/build/build.py --reproducible`
with `SITE_URL` set to `https://example.invalid/static/app/monitoring_use_cases` so the compiled site resolves assets,
API files, and companion pages from the Splunk static app root.

## What ships in this app

- the compiled overview experience from `index.html`
- API-backed search/filtering assets under `appserver/static/api/`
- companion pages including `scorecard.html`, `regulatory-primer.html`, `clause-navigator.html`, `compliance-story.html`, and `api-docs.html`
- discovery bootstrap schemas and runtime contract under `appserver/static/api/v1/discovery/bootstrap.json`
- deterministic requirement profiles for discovery and mapping under `appserver/static/api/v1/discovery/requirements.json`
- generator-owned KV store definitions in `default/collections.conf` for the upcoming discovery and mapping feature track
- generator-owned discovery inventory saved searches in `default/savedsearches.conf` for the first bounded Phase 3 metadata scan scaffold
- supporting docs, reports, data files, and the data sizing tool under `tools/data-sizing/`

To keep the app package smaller, the generator intentionally excludes the
largest non-essential export trees for Release 1: `integrity.json/`, `samples/`, `schemas/`, `splunk-apps/`, `ta/`, `templates/`, `uc/`, `use-cases/`.

## Generate

```bash
python3 scripts/generate_monitoring_use_cases_app.py
python3 scripts/generate_monitoring_use_cases_app.py --check
```

## Package

```bash
scripts/package_splunk_apps.sh dist monitoring_use_cases
```

Upload the resulting `.spl` archive via **Settings > Manage Apps > Install app from file**,
then open **Apps > Monitoring Use Cases**.

The Splunk-facing route is a scripted dashboard host that keeps the catalog
and companion pages inside Splunk chrome while loading the compiled site from
`/static/app/monitoring_use_cases/`.

## Files in this app

```text
monitoring_use_cases/
├── app.manifest
├── README.md
├── LICENSE
├── default/
│   ├── app.conf
│   ├── collections.conf
│   ├── transforms.conf
│   ├── savedsearches.conf
│   └── data/ui/
│       ├── nav/default.xml
│       └── views/catalog.xml
├── metadata/default.meta
└── appserver/static/
    ├── index.html
    ├── monitoring_use_cases_host.css
    ├── monitoring_use_cases_host.js
    ├── api/
    │   └── v1/discovery/{bootstrap.json,requirements.json}
    ├── assets/
    ├── docs/
    ├── reports/
    └── tools/data-sizing/
```

---

_This app is generated. Edits in place will be overwritten. File bug
reports and content requests at
<https://github.com/fenre/splunk-monitoring-use-cases/issues>._
