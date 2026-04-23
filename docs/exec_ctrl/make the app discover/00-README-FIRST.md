# Splunk Use Case Catalog Native Mapping Engine Pack

## Purpose
This pack defines a native Splunk app enhancement that adds deterministic environment discovery, use-case-to-dataset mapping, an admin refinement workflow, and a persistent results library to a Splunk app derived from the Splunk Monitoring Use Cases catalog.

It also defines how `exec-ctrl` should be used as the engineering orchestration loop for agentic delivery in VS Code or another IDE.

This pack is written for GPT-5.4, Cursor, Copilot, Claude Code, or similar agents working in a code workspace.

## Important framing
`exec-ctrl` is **not** the runtime engine inside the Splunk app.

`exec-ctrl` is the **development control framework** used to drive:
- design loops
- implementation loops
- testing loops
- verification loops
- correction loops
- packaging loops

The runtime feature inside Splunk must remain:
- deterministic
- bounded
- explainable
- auditable
- admin-governed

## Desired user experience
A Splunk admin opens the app and sees a new control:

**Run Environment Discovery**

One click later, the app:
1. inspects the local Splunk environment
2. inventories data assets and normalization clues
3. maps those findings to use cases in the catalog
4. persists results in a native library
5. exposes new filters and badges inside the catalog
6. allows admins to refine, override, confirm, or reject mappings

## Deliverables in this pack
- `01-product-architecture.md`
- `02-runtime-design.md`
- `03-deterministic-mapping-model.md`
- `04-data-model-and-storage.md`
- `05-native-ux-flows.md`
- `06-admin-refinement-workbench.md`
- `07-verification-and-test-strategy.md`
- `08-exec-ctrl-delivery-plan.md`
- `09-agent-task-graph.md`
- `10-implementation-backlog.md`
- `11-api-contracts-and-endpoints.md`
- `12-risks-and-guardrails.md`

## Recommended implementation order
1. Define schemas and storage
2. Implement discovery scanner
3. Implement deterministic rules engine
4. Persist results and scan runs
5. Expose read APIs
6. Add catalog filters and badges
7. Add admin refinement workbench
8. Add verification harnesses
9. Package and validate

## Success criteria
The feature is successful when:
- the scan is one-click simple
- results are explainable
- mappings are persisted
- admins can refine results without editing source code
- reruns preserve history and do not destroy overrides
- catalog filtering becomes materially more useful
- the app still feels fully native to Splunk
