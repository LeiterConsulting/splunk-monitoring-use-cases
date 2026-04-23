# Exec-Ctrl Target Product

## Product Outcome

Deliver a generated, installable Splunk app named `monitoring_use_cases` that
hosts the compiled monitoring-use-cases catalog inside Splunk through the
static app path and a supported host launch surface while preserving the
current catalog behavior, deep links, API-backed lazy loading, and static site
information architecture.

## Release Model

- Release 1 packages the runtime-critical subset of the compiled catalog site from `dist/`; it does not start from the recommender app.
- The Splunk app remains generator-owned: source changes happen in repo source files, and generated output under `splunk-apps/` is disposable.
- GitHub Pages and the Splunk-hosted app are two delivery channels for the same compiled catalog, but the Splunk package may omit heavyweight export trees that are not required for the in-app operator experience.
- The development machine is not the Splunk host, so Release 1 uses a package-first workflow: build locally, emit an installable artifact, then validate against a remote Splunk environment.
- The workspace root `.env` file is the local source of truth for the remote Splunk endpoints, self-signed-certificate mode, and authentication material used in validation.

## Primary Users

- Splunk platform administrators and operators who want the full catalog inside Splunk
- observability and operations engineers browsing monitoring coverage from the Splunk UI
- compliance and audit operators using the regulation and clause navigation surfaces
- architects and program leads who need the same catalog experience available in an internal Splunk environment

## Product Principles

1. Artifact fidelity first: the Splunk-hosted app should render the same compiled catalog that the public site ships.
2. Generator-owned packaging: the emitted app tree is never the long-term source of truth.
3. Package-first remote validation: build locally, package deterministically, validate against the remote Splunk host.
4. Stable site contract: the compiled `dist/` output from `tools/build/build.py` is the packaging source, not the legacy repo root snapshot.
5. Minimal adaptation: prefer supported base-path overrides over invasive rewrites of catalog behavior.
6. Progressive enhancement later: a Splunk UI Framework reimplementation can happen after the static catalog app is packaged and validated.

## Required Finished Capabilities

1. An installable Splunk app package emitted by repo tooling, not by manual edits inside `splunk-apps/`.
2. A host view inside Splunk that renders the catalog and companion pages inside Splunk chrome through a Splunk-supported surface.
3. A deterministic build path that compiles `dist/` with the Splunk app base path baked in.
4. Bundled static assets, API payloads, and companion pages required for the live catalog experience.
5. Search, filter, detail, and deep-link behavior that matches the compiled site closely enough for operator use, including same-window deep links from SPL examples into Splunk Search.
6. A validation path for deterministic build output, app packaging, and remote Splunk smoke verification.

## Explicit Non-Goals For The First Release

- redesign the catalog into the recommender app
- replace the `tools/build/build.py` site pipeline
- rewrite the catalog into Splunk UI Framework for Release 1
- change the TA or compliance app family as part of the initial catalog-hosting work
- ship the heavyweight `uc/` export tree or other non-essential publication artefacts inside the first Splunk package if they are not required for the core in-app experience

## Default Working Recommendation

- Use `python3 tools/build/build.py --out dist` as the source artifact step.
- Generate a new app tree under `splunk-apps/monitoring_use_cases/`.
- Build the site with a base path matching `/static/app/monitoring_use_cases` so bundled pages and lazy-loaded assets resolve correctly inside Splunk.
- Copy the runtime-critical site subset into `appserver/static/` and exclude heavyweight publication trees that do not drive the core Splunk-hosted experience.
- Use the workspace root `.env` file as the authority for remote-host URLs, certificate mode, and auth during validation.
- Provide a lightweight scripted Splunk dashboard host that injects the packaged static entry point and companion pages into Splunk chrome; do not depend on HTML-panel-authored iframes surviving sanitization.
- Use same-window Search app deep links for SPL examples, and defer deeper deployment interaction patterns to later phases.
- Do not assume `$SPLUNK_HOME` or local app-linking on the development machine; prefer build, package, and remote-install validation.