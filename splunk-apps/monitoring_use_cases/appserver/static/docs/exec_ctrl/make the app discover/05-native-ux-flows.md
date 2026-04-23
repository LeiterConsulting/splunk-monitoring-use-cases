# Native UX Flows

## UX objective
Make the feature feel like it has always belonged in the app.

## Primary entry points

### Catalog header actions
Add:
- `Run Environment Discovery`
- `View Discovery Results`
- `Admin Mapping Workbench` (admin only)

### Catalog filters
Add filters such as:
- direct matches only
- adjacent matches only
- partial matches only
- no detected support
- admin asserted
- admin rejected
- updated by latest scan

## Use case card enhancements
Each card can show:
- discovery badge
- matched dataset count
- last scan age
- admin override indicator

Example badges:
- Direct data found
- Adjacent data found
- Partial support
- Not detected
- Admin mapped

## Use case details drawer
Include a discovery panel:
- effective mapping state
- engine mapping state
- why this was matched
- matched sourcetypes / indexes / fields
- missing requirements
- actions: confirm, reject, map manually

## Discovery results page
Sections:
- summary tiles
- newly matched use cases
- adjacent opportunities
- unsupported use cases
- discovered dataset inventory
- notable gaps

## Library page
Persistent view of the discovery knowledge base.

Tabs:
- datasets
- mappings
- overrides
- scan history
- unresolved

## Admin mapping workbench
Purpose-built UI for refinement.

Capabilities:
- search use cases
- search datasets
- compare engine result vs admin result
- create explicit mappings
- reject noisy suggestions
- attach notes

## First-run experience
If no scan has been run:
- show a clear empty state
- explain what discovery does
- provide a single obvious button

## Large environment behavior
Do not overwhelm the user.

Use:
- progressive summaries
- counts before details
- paginated or lazy-loaded inventory tables
- summarized evidence by default with drilldown

## Native tone
Avoid making this feel like an external AI plugin.

Terminology should emphasize:
- discovery
- alignment
- evidence
- support
- readiness
- refinement

Not:
- reasoning
- agent judgment
- autonomous decisions
