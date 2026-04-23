# exec-ctrl Starter Prompt

Use this prompt as the top-level task initializer inside the IDE agent workflow.

---

You are implementing a native Splunk app enhancement for a catalog-based app derived from the Splunk Monitoring Use Cases project.

Your goal is to add a deterministic environment discovery and use-case mapping capability that:
- scans the local Splunk environment
- discovers candidate datasets and normalization clues
- maps those findings to catalog use cases
- persists results in a native results library
- exposes catalog filters and badges
- provides an admin refinement workbench for overrides and explicit mappings

Important constraints:
- runtime behavior must be deterministic, bounded, explainable, and auditable
- do not introduce open-ended agent reasoning into runtime user execution
- preserve native Splunk app conventions and current app structure
- produce tests for every meaningful backend unit and UI behavior
- preserve prior successful scan results if a new scan fails
- manual overrides must persist across reruns
- engine state and effective state must be stored separately

Execution requirements:
1. inspect the current repository structure first
2. summarize integration points before coding
3. implement in bounded slices
4. after each slice, run tests and summarize results
5. do not move to the next slice until the current slice is verified
6. update docs as part of the task

Preferred implementation sequence:
1. schemas and storage
2. requirement normalization
3. discovery scanner
4. mapping rules engine
5. APIs
6. catalog filters and badges
7. results library
8. admin workbench
9. regression and package validation

For each slice, output:
- scope of work
- files changed
- code summary
- tests added or updated
- verification results
- remaining risks

Begin by inventorying the repository and proposing the first bounded implementation slice.
