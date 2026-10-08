# Canvas staging folder and divider implementation

Implemented against Lumiverse staging `c975b917223660e5cfc668620087df9b6f7843f9`, from Canvas staging `465f6e2d55358925fa197d393932b17b4eeeb784`. This change follows the [accepted specification](tab-folders-spec.md) and addresses the failures recorded in the [compatibility report](tab-folders-compatibility-report.md).

## Resulting behavior

Canvas's existing drawers now represent folders with a single launcher, retain the selected folder icon while a child is active, and render explicit dividers as thin lines with tooltip labels. Clicking a folder opens a list/grid browser inside the existing drawer panel. Clicking a child returns to its ordinary panel, including reopening a closed OS window. Manually hidden children remain absent.

Configure Tabs keeps its existing columns, footer, tab cards, visibility switches, and mode controls. It adds compact folder/divider creation, expandable folder rows, indented existing child cards, rename and delete controls, preset/custom icon editing, pointer dragging, and accessible move controls. Folder deletion spills its children in place. Group moves carry hidden, closed, and unavailable members without treating the folder as a window.

Start follows organization order and groups children under folder disclosures. Launching an entry opens it in its owning drawer and retains its position and folder membership, even when Start was invoked from the other drawer. Folder browsers have independent saved selection and remembered leaf state; dismissing one collapses its drawer without closing its children.

## Authority and persistence

`core/organization.ts` defines version-1 organization records alongside the existing version-2 layout model. Roots are tabs, folders, or dividers; folder children are stable TabKey references. Unknown native addresses remain address references until the identity resolver can associate them with a live tab. The sanitizer enforces unique membership and container IDs and rejects nesting.

The reducer derives flat ownership from organization changes. Browsing clears the displayed leaf while keeping its reopen memory; host activity echoes cannot replace a selected browser. Deleting or moving a selected container resolves selection in the same transaction. Folder moves use placement before model publication, verify the moved roots, and reverse completed placements if a required member fails. The existing commit error surface reports the failure.

Each existing layout/profile serialization carries organization, browser selection, remembered leaves, OS-close hiding provenance, and stable leaf state. Stable state retains hidden/closed/menu-hidden members when their extensions are unavailable. Last-known addresses support native projection without deriving fabricated live IDs from extension keys. Legacy flat layouts remain valid, and single-drawer folding keeps all organization reachable.

Lumiverse staging's former OOC/Feedback addresses resolve to its actual Council inventory entry through `tabs/identity.ts`. The staging Configure catalog matches the current 23 built-ins and uses the new Presets title. Folder presets use the native 13-icon set with the host's Lucide paths. Custom SVG input accepts supported structured shapes and attributes, excludes executable/external content, and limits imported files/paste to 32 KB.

The [UI review](tab-folders-ui-review.md) records the next-pass polish and interaction fixes: creation actions share the section heading, row actions expand inline, and keyboard/touch behavior retains focus. Queued organization gestures use the latest committed organization to avoid undoing earlier edits.

## Host integration

Lumiverse's folder child buttons are noninteractive mounting anchors. Canvas preserves them and calls the host's navigation action for these children rather than clicking an inert button. Leaving the native folder browser also clears its local React folder selection, covering the remembered-tab/same-ID case where a store update alone does not leave that browser.

Explicit host navigation leaves Canvas folder browsing. Canvas's internal content-mounting calls are distinguished from user navigation so quiet group placement does not dismiss a browser. Native `configureTabs` modal actions route to Canvas's editor while the host action API is available; existing context-menu interception remains in place.

At enable, native layout is compared against the recorded Canvas projection, including a saved projection fallback if the host marker is absent. Verified outside edits are adopted into the active main organization. The second drawer and inactive profiles retain their saved organization. Native containers originally projected from the protected second drawer are retained there rather than imported as colliding or accumulating empty copies; new main/unknown children inside those native counterparts remain reachable at main root. Newly imported main folders remain valid even when filtering second-drawer members leaves them empty.

At disable, Canvas projects both drawers into a valid native single-drawer layout with folders, dividers, canonical extension addresses, and matching flat tab order. Publishing uses raw host actions during teardown, with the existing settings bridge as a fallback. The Canvas profiles retain their dual/OS state.

## Verification

| Check | Result |
| --- | --- |
| Prescribed `npm test` runner | 168 test files pass; zero failures. |
| New organization regression suite | 27 tests pass, 71 assertions. Covers membership, deletion/spill, group/leaf moves, selection, unavailable state, native adoption, projection detection, protected second containers, and icon sanitization. |
| TypeScript | Zero non-test errors. Full typecheck still reports test-only typing diagnostics: 254 baseline diagnostics plus the same missing `bun:test` declaration in the new suite, for 255 total. |
| Actual staging ViewportDrawer harness | Built-in and extension child anchors discovered; hidden-child navigation works; same-ID native and Canvas browser exit works; internal mounting preserves Canvas selection; owned order preserves native anchors; raw disable publication retains folders and canonical extension addresses. |
| Browser interaction preview | List/grid, exclusive highlight, child launch, focused Configure opening, rename without dismissing the browser, divider creation, pointer folder drop, folder deletion/spill, and closed-child reopen pass without page exceptions. |
| Physical group placement preview | Production placement code moves two persistent roots to the second drawer and back. A forced failure on the second member reverses the first placement, preserves the selected source browser/model ownership, and displays an error. Uses a mocked Spindle DOM fallback. |
| OS Start preview | Folder grouping and opposite-Start launch retain the owning drawer and membership; reduced-motion path passes. |
| Appearance/geometry | Paired flat/organized screenshots; dark/light and compact/labeled previews; responsive mobile browser/editor; Top/Bottom pin geometry and divider orientation checked. |
| Whitespace/source checks | `git diff --check` passes. |

The evidence is stored in `/workspace/reports/`: `folders-polish-tests.txt`, `folders-organization-tests.txt`, `folders-polish-typecheck.txt`, `folders-host-contract.txt`, `folders-ui-contract.txt`, `folders-groups-contract.txt`, `folders-matrix-contract.txt`, and `folders-locations-contract.txt`.

The standalone preview in `/workspace/reports/folders-preview/` renders production Canvas shells, browser/editor controls, Start, and placement code. Screenshots include `baseline-browser.png`, `baseline-configure.png`, `browser.png`, `configure-expanded.png`, `grid.png`, `light-browser.png`, `light-configure.png`, `compact.png`, `mobile-browser.png`, `mobile-configure.png`, `start-grouped.png`, `top.png`, and `bottom.png`.

## Practical limits and runtime handoff

The paired harness uses actual staging drawer code with mocked heavy panels and store/data services. The browser preview uses deterministic content, a fake identity host, and mocked persistent roots. Neither is an authenticated full Lumiverse session. Backend persistence across real reloads, real panel data loading after cross-drawer placement, actual Spindle permission behavior, and complete device/mode cycling require live application verification. Existing Canvas mode, OS, restore, and mobile tests pass; the previews do not establish that every full-app combination has been exercised.

Deployment completed with the prescribed `npm run deploy`. It built the extension and copied it to `/home/agent/Lumiverse/data/extensions/canvas/repo/`; frontend/backend checksums match the repository artifacts, and the runtime manifest matches `spindle.json`. Frontend SHA-256: `8aa967b429193e9813bf80dfadcc4be7f5881de54303a39f63a3df6a1be53b5c`. Lumiverse must be hard-refreshed with Ctrl+F5 to load that runtime bundle. This task does not promote or release the change to either compatibility branch.
