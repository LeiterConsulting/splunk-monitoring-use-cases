# exec-ctrl Delivery Plan

## Purpose
Use `exec-ctrl` to orchestrate agentic implementation loops for this feature in VS Code or another IDE.

## Principle
`exec-ctrl` manages the engineering process.
It does not replace the runtime product logic.

## Delivery loop model

### Loop 1. Design
Inputs:
- feature brief
- current app structure
- runtime constraints
- Splunk app conventions

Outputs:
- architecture docs
- API contract drafts
- schema definitions
- implementation sequencing

### Loop 2. Build
Inputs:
- approved design docs
- selected task slice

Outputs:
- code changes
- tests
- migration scripts
- UI components

### Loop 3. Verify
Inputs:
- code output from build loop

Outputs:
- test results
- lint results
- install/package results
- diff notes

### Loop 4. Correct
Inputs:
- failures or gaps from verify loop

Outputs:
- patch tasks
- code fixes
- regression checks

### Loop 5. Package
Inputs:
- verified feature slices

Outputs:
- packaged app
- release notes
- migration guidance

## exec-ctrl responsibilities
- decompose feature into bounded tasks
- enforce artifact-driven work
- require tests for each task
- require verification for each task
- maintain state across loops
- stop drift and scope bleed

## Recommended artifacts per task
Every task should emit:
- implementation notes
- changed files list
- tests added or updated
- verification result
- known limitations

## Gate model
A task is not complete until:
- code exists
- tests exist
- tests pass
- packaging still works
- no obvious regression found
- documentation updated if needed

## Suggested loop granularity
Use small slices, for example:
- schema only
- discovery inventory only
- one endpoint only
- one UI filter only
- override persistence only

Avoid giant cross-cutting prompts that attempt the whole feature at once.

## Branch strategy
Recommended branch shape:
- feature/discovery-engine
- feature/mapping-rules
- feature/results-library
- feature/admin-workbench
- feature/catalog-filters
- feature/verification-harness

## Definition of done
The overall feature is done when:
- runtime works deterministically
- UI is integrated and native
- mappings persist
- overrides persist
- verification suite passes
- package installs cleanly
