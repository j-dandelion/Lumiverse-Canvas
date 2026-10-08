# Lumiverse tab folders: Canvas staging compatibility investigation

**Investigated:** 2026-10-07. **Target:** Canvas staging paired with Lumiverse staging.

## Assessment

Canvas staging needs a substantial compatibility update before it can support Lumiverse's native tab folders. The strongest confirmed failure is functional: Canvas discovers the hidden buttons for folder children and treats them as actionable tabs, but those buttons deliberately have no click handlers. Primary activation returns `ok` while Lumiverse continues showing the previous tab or its folder browser. This affects built-in and extension tabs.

The second confirmed failure is order convergence. Canvas can move root buttons but cannot reorder the nested child anchors. A primary order write can return `ok` with the wrong order still observable. The main mirror, Configure Tabs draft, owned layout model, and saved layouts all describe flat lists; none can represent folders or dividers.

This is more than a selector fix. It does **not** justify rewriting unrelated Canvas subsystems. Keep the existing dispatcher, model ownership, placement-first moves, identity resolver, teardown gates, and mode profiles. Extend their contracts to represent organization and replace DOM-button activation and ordering as sources of truth where those assumptions no longer hold.

No production code, release bundles, runtime installations, remote branches, or user settings were changed during this investigation. This report is an uncommitted document on a local task branch based on Canvas staging.

## 1. Exact source baseline

| Repository / branch | Commit inspected | Observation |
| --- | --- | --- |
| `prolix-oc/Lumiverse` main | `7398fa5f4fc73eaee1aaa767804312765e84ea79` | Flat drawer settings and tab strip; no native `drawerSettings.layout`. |
| `prolix-oc/Lumiverse` staging | `c975b917223660e5cfc668620087df9b6f7843f9` | Native folders, dividers, hidden child anchors, folder browser, canonical layout IDs. |
| `j-dandelion/Lumiverse-Canvas` main | `465f6e2d55358925fa197d393932b17b4eeeb784` | Same source as Canvas staging at investigation time. |
| `j-dandelion/Lumiverse-Canvas` staging | `465f6e2d55358925fa197d393932b17b4eeeb784` | Canvas 2.0.1, flat owned layout model. |

Canvas's two branches are compatibility tracks, even though their current heads coincide. A staging fix belongs on a task branch based on Canvas staging. Stable main should continue to be tested against Lumiverse main.

Relevant Lumiverse staging commits:

| Commit | Change |
| --- | --- |
| `46ac4783` | September 30: initial sidebar folders and sections. |
| `a1951919` | October 1: native sidebar organization implementation. |
| `39bd85e3` | October 3: sidebar resizing and opt-in chat centering. |
| `7e96ea22` | October 3: Council setup / feedback / OOC consolidation. |

These are pinned-source findings, not a guarantee about later branch heads. Repository documentation contains some older implementation descriptions; for example, current Canvas Configure edits commit to the owned model, and current order/hidden reconciliation no longer writes host `tabOrder` / `hiddenTabIds`. The findings below use the source at the commits above.

## 2. What the host changed

### Persisted layout is now structured

Lumiverse staging adds `DrawerSettings.layout`, an ordered array with three item kinds:

```ts
type DrawerLayoutItem =
  | { type: 'tab'; tabId: string }
  | { type: 'divider'; id: string; label?: string }
  | {
      type: 'folder'; id: string; name: string;
      icon?: string; customIcon?: DrawerCustomIconData;
      view?: 'list' | 'grid'; children: string[];
    }
```

Folders are one level deep. Their children are tab IDs, not nested folders. Custom icons are structured, sanitized SVG data, not raw SVG markup. Dividers and folders have their own identity and position. See host sources H1–H3 below.

`tabOrder` remains a **legacy flat projection** for migration and downgrade compatibility. With a nonempty valid `layout`, changing only `tabOrder` does not reorder the existing structured layout. `reconcileDrawerLayout` sanitizes and preserves saved organization, retains temporarily unavailable tab IDs, and appends newly discovered tabs at root. If there is no valid saved layout, it creates a default from known tabs and legacy order, including an Extensions divider when needed.

The native Configure Tabs modal writes `layout` and its flattened `tabOrder` together. Folder view changes do the same. Its edits are immediate host settings writes.

### A folder is a navigation surface, not a tab

The visible folder button has no `data-tab-id`. Clicking it sets React-local `activeFolderId` and opens the drawer without changing `drawerTab`. The panel displays a folder list or grid instead of `TabPanelContent`.

Clicking a native folder tile clears `activeFolderId`, sets the child's runtime tab ID, and opens that tab. Actual tab identity and folder browsing identity are separate states. Host `drawerTab` can still refer to the previous tab while the user is browsing a folder.

An effect clears folder browsing when `drawerTab` **changes**. A store call that sets it to the same value does not trigger this effect. A replacement activation path must therefore handle exiting folder browsing explicitly; replacing `.click()` with an unconditional store setter alone is insufficient.

### Folder children retain hidden mount anchors

The folder slot contains an `organizedTabAnchors` element. Each visible child retains a button with its current `data-tab-id`, icon/label/badge, and `drawer_tab` Spindle mount. This keeps extension decorations mounted despite organization changes.

Those buttons have `aria-hidden`, `tabIndex=-1`, and **no click, context-menu, or touch handlers**. Host CSS hides both anchor container and buttons with `display: none !important`.

This is the central changed contract: a `button[data-tab-id]` can be an identity/mount anchor without being a user interaction target. Inventory discovery still works; clicking inventory elements no longer necessarily performs navigation.

### Extension IDs have two host forms

Live button IDs still include the registration counter, for example:

```text
spindle:fixture:tab:tools:7       # live runtime address
spindle:fixture:tab:tools         # canonical host layout identity
ext:fixture/Tools                # example Canvas TabKey
```

The host strips the trailing registration counter when storing organization and comparing layout/hidden IDs. Canvas's frozen TabKeys are a different identity space. A structured-layout bridge must translate through the existing identity resolver and explicit metadata; treating these strings as interchangeable will corrupt membership or create duplicate identities.

## 3. Findings, severity, and confidence

“Reproduced” means exercised with the actual staging `ViewportDrawer` and actual Canvas APIs in the isolated harness described in section 5. “Source-confirmed” means the behavior follows from the inspected code but was not walked in a full Lumiverse session. “Risk” identifies a dependent outcome needing paired integration validation.

| ID | Severity | Finding | Evidence level |
| --- | --- | --- | --- |
| F1 | Critical | Folder-child activation is a silent no-op with a success result. | Reproduced for built-in and extension children. |
| F2 | High | Canvas mirror flattens folders and drops dividers. | Source-confirmed. |
| F3 | High | Primary order writes cannot achieve arbitrary order across nested children. | Reproduced; reconcile consequences are a risk. |
| F4 | High | Canvas Configure Tabs intercept prevents native organization through the normal context-menu path. | Source-confirmed. |
| F5 | High | Cold activation / root preparation / restoration can fail for foldered tabs. | Source-confirmed dependencies; full move outcomes need live verification. |
| F6 | High | Current model and saved profiles cannot own or restore organization. | Source-confirmed. |
| F7 | Medium | Host folder activity can be confused with actual tab activity. | Source-confirmed; same-ID navigation trap reproduced. |
| F8 | Medium | Folder context menu is misclassified as a tab move target. | Source-confirmed. |
| F9 | Medium | CSS-hidden anchors appear in a helper that claims to read visible tab order. | Source-confirmed. |
| F10 | Staging follow-up | Built-in catalog and geometry behavior have additional upstream drift. | Source-confirmed changes; geometry interaction unverified. |

### F1 — Activation can report success without selecting the tab

**Trigger:** A tab is placed inside a native host folder, and Canvas activates it in the primary drawer.

`DrawerObserver` recursively discovers the hidden child button and preserves its TabKey. `findMainTabButton` returns it by `data-tab-id`. `LumiverseHost.activate('primary', id)` calls `.click()` and then returns `ok` without verifying that the active host tab or content changed. The host intentionally gives this anchor no click handler. See H4 and C1–C3.

The actual Canvas main renderer also clicks the twin directly, then dispatches model activation. This can change Canvas's highlight/header while the host still displays the previous content. OS Start launches also call `host.activate`; they inherit the same activation dependency. The focused harness verified the host-port failure, not the full mirror/OS presentation sequence.

**Reproduced:** With `profile` active and `regex` plus an extension tab inside Utilities, both activation calls returned `ok`; `drawerTab` and rendered content stayed on `profile`. After opening Utilities, calling `activate('primary', 'regex')` left the folder browser visible. Clicking the native folder tile correctly selected `regex`.

**Required fix:** Introduce one folder-independent host navigation operation, use it in all Canvas activation paths, and verify the requested active tab/content outcome. Distinguish degraded navigation from success. A supported host navigation API is preferable to clicking an anchor or manipulating React internals.

Staging exposes `ctx.host.surfaces.invoke` host actions, whose drawer action currently delegates to store `openDrawer`. It is a candidate bridge, **not an established fix**: same-ID navigation still needs validation because folder browsing is React-local. Existing extension placement handles similarly use store setters. A host-side navigation signal or explicit “leave folder browsing and activate tab” action would close this gap cleanly. Avoid a transient switch to a different tab as a permanent workaround: it changes lifecycle and user-visible selection.

### F2 — Canvas's main mirror has no folder/divider representation

The observer inventories tabs, not organization nodes. The visible folder lacks `data-tab-id` and extension-tab class, so it is not an inventory entry. Dividers are not tabs either. The model's `primary` array contains TabKeys; `renderMainMirrorTabs` iterates that array to create one regular button per key. Organization metadata is never consulted. See C1, C3, C4.

When the Canvas main shell is active, its hide stylesheet hides host drawer chrome. The native folder button does not remain a usable parallel surface. The mirror therefore exposes the children as flat buttons, whose clicks hit F1, and loses the host's grouping, divider labels, folder icon, and list/grid browsing behavior.

**Required fix:** Render a structured organization projection in the Canvas shell. Keep tab inventory separate from organization inventory; a folder must never acquire a fabricated `builtin:` or `ext:` TabKey. Keep canonical Spindle mount spans in the host anchors, as the current renderer already does.

### F3 — Direct-child DOM order cannot represent folder-child order

`reorderHostMainTabButtons` searches `:scope > button` and appends matching direct children. It cannot move a nested child anchor. `DrawerObserver.getAllTabs` sorts the recursive tab inventory by DOM document position. `LumiverseHost.setOrder` returns `ok` after the reorder without checking the result. See C1, C2, C5.

**Reproduced:** Requested order:

```text
lorebook, spindle:fixture:tab:tools:7, regex, profile
```

Observed order after successful `setOrder`:

```text
regex, spindle:fixture:tab:tools:7, lorebook, profile
```

The folder's nested child order remained `regex, extension`; direct root buttons moved around its fixed slot. Replacing the selector with a recursive selector and appending all matches would pull React-owned anchors out of their parent and erase the DOM organization. It would still fail to update persisted membership.

The reconciler diffs model order against observed order; host sync rebuilds primary order from observation. Consequently the mismatch can undo a user reorder, cause repeated order writes, or create extra observer/reconcile/persistence activity. A sustained freeze or infinite save loop was **not** reproduced and should not be reported as confirmed.

**Required fix:** Choose an explicit organization/order authority. Derive observed organization from structured state, not incidental DOM traversal. Project the owned order to the host layout where appropriate, preserve membership, and return degraded status if the requested projection cannot be applied.

### F4 — Configure Tabs replaces the host UI but cannot edit its new model

Canvas installs a capture-phase, English-label context-menu intercept whenever loaded, including with the second drawer disabled. “Configure tabs” opens Canvas's modal and stops the native handler. `ConfigureDraft` represents flat primary/secondary IDs and hidden IDs; it has no folders, dividers, icons, views, or membership. Current commits go to Canvas's owned model, not host organization. See C6–C8.

This blocks native folder creation/editing through the normal context-menu route even in single-drawer mode. The host folder browser also has a direct Configure Tabs button calling `openModal('configureTabs')`; this particular direct button is outside the context-menu intercept. Where it remains accessible, a native edit can change host layout while Canvas's flat model remains independent. There are now two editors with different authorities.

**Required fix:** Make Canvas Configure Tabs organization-aware, or temporarily preserve access to the native organization editor with explicit synchronization and limited Canvas behavior. Simply bypassing the intercept does not resolve activation, mirror rendering, or order convergence.

### F5 — Root preparation and restoration depend on the same broken click path

Several paths activate before accessing or restoring content: built-in lazy preparation in `builtin-move.ts` / `assignment.ts`, neighbor content reassertion, primary restore in `main-persist.ts`, and OS launch. Folder anchors prevent those clicks from performing navigation. See C2, C3, C9.

Likely symptoms depend on root and location state: restoration may keep the previous panel, or a move may update placement/model without the expected content activation or visibility-gated data initialization. Staging's `getBuiltInTabRoot` calls `ensureRegistryRoot`, so a valid built-in root can still be created even when the pre-activation click fails. Root existence alone does not prove readiness: the current WorldBookPanel still gates its book load on `drawerOpen && drawerTab === 'lorebook'`. Already-mounted roots and host-owned container relocation can still work. This investigation does **not** establish that every folder-child move fails or that foldered roots necessarily remain unmounted.

Host folder UI filters moved extension children using `hiddenPlacements`. Its visibility predicate does not consult built-in `tabLocations` or Canvas assignments. A moved built-in can therefore remain in the native folder's count/list even if its root belongs to another container; Canvas hiding its anchor with an inline style does not change that semantic count. Do not assume folder visibility behaves identically for both classes; test each, including folders whose last child moves away and returns. This is a source-confirmed filtering difference, not a live cross-drawer reproduction.

**Required fix:** Route preparation and restoration through the same verified navigation seam as F1. Validate persistent roots, host-owned containers, DOM fallback, and neighbor handoff independently. Preserve placement-first moves and lifecycle-generation cancellation.

### F6 — Persistence loses organization as a Canvas concept

`LayoutModel` v2 has flat `primary` and `secondary` arrays, plus active/hidden/menuHidden/closed/drawer fields. Canvas serializers and its single/dual/OS profile slots persist these tab arrangements; they cannot snapshot a folder/divider tree. See C4, C10.

Host layout may survive on disk while Canvas ignores it. This is **not evidence of current folder data deletion**: Canvas's partial host-settings writer merges existing fields, and current order/hidden reconcile does not overwrite the host layout. The focused merge control preserved the folder layout while changing labels. Keep that preservation behavior.

A future schema must retain organization in every profile, migrate old flat arrays deterministically, preserve unavailable children, and survive late extension registration and counter changes. Decide how native edits while Canvas is disabled are imported on re-enable. Otherwise reload, mode switching, and disable/re-enable can each restore a different organization.

### F7 — Folder activity and tab activity are different

The active host folder button uses the host `tabBtnActive` class even though it has no tab ID. DOM fallback active detection can return its title rather than a real tab ID. Store fallback instead reports the previous `drawerTab`. Neither alone describes what the panel currently displays. Canvas also treats a resolved tab button as a content-root signal, although the observed element is an anchor. See H4, C11.

**Reproduced:** While Utilities was open and `drawerTab` still `profile`, setting `drawerTab` to `profile` again left the folder browser displayed. The host's `[drawerTab]` effect did not run for an unchanged string.

**Required fix:** Represent presentation state explicitly, for example `tab`, `folder`, or no active content, without turning folders into tabs. For the initial stabilization, verified tab navigation must reliably leave folder browsing. Header sync, toggle-close, neighbor selection, and OS window lifecycle must consume a consistent presentation state.

### F8 — Folder right-click is treated as a tab move

Canvas's context-menu capture accepts any titled button inside the sidebar except Settings. It uses `data-tab-id`, then store-title lookup, then the title itself as the fallback tab ID. A native folder title is e.g. `Utilities · 2 tabs`; it passes the capture filter but has no real tab ID. See C12.

The resulting menu can offer a move for a nonexistent tab. Changing the folder name or visible child count also changes the fallback address. The regular observer correctly skips this folder; the context-menu classifier is broader and disagrees with it.

**Required fix:** Require a resolved leaf-tab identity for leaf actions. Give folder/divider actions their own item-kind classifier. Group movement should be an explicit operation, not a title-based tab move.

### F9 — “Visible order” includes invisible anchors

`readVisibleTabIdsFromList` skips only inline `style.display === 'none'`. The new anchor is hidden by CSS, with no necessary inline display value, so the helper counts it as visible. Its hidden parent can also have no inline hide. See H5, C13.

This can affect Configure alignment, drag inventory, hit-testing assumptions, and neighbor selection even before a folder-aware renderer is added. It is different from host `hiddenTabIds`: organization hides a child presentation without hiding the tab itself.

**Required fix:** Separate inventory enumeration from renderable strip entries. Prefer organization item kinds and explicit presentation markers; do not infer “tab hidden by user” from `aria-hidden` or computed CSS. An ancestor-aware visibility check can support hit testing, but cannot replace organization data.

### F10 — Adjacent staging changes need their own acceptance checks

1. **Council catalog:** Canvas's static catalog lists 25 built-ins, including `ooc` and `feedback`. Staging's actual drawer registry now lists 23; OOC and Feedback are navigation aliases into Council, not independent strip tabs. The host sanitizes them out of saved layout/order. Canvas can continue showing stale Configure entries or retaining saved built-in keys that have no live button. Migrate these identities and active selections deliberately; host registry alias handling can map both to the same Council root, so treat them as subviews rather than separate movable windows. Also update the Loom/Presets display title for staging. See H6 and C14.
2. **Resize:** The host adds `panelWidthPx`, its own resize handle, and layout/UI-scale-aware sizing. Canvas already owns resize and saved widths. Determine which handle/writer is active in each shell mode and test width persistence at non-100% UI scale. See H4.
3. **Chat centering:** The host now publishes `--chat-drawer-left/right` geometry and optionally centers the chat. Canvas already computes chat/Welcome insets, shell widths, and dock offsets. Verify CSS precedence and geometry authority, especially while the host drawer is headless behind the Canvas shell. No double-inset or resize conflict was reproduced here; these are integration checks, not established regressions.
4. **SDK version:** Canvas pins Spindle types `^0.5.24`; staging uses `0.6.39`. Update the staging adapter's typed API/capability usage as needed. The version difference alone does not establish runtime incompatibility.

## 4. Recommended staging update

### Phase A — Stabilize navigation and observation

Deliver this as a bounded compatibility change before building the full editor:

1. Create one typed host navigation seam that handles built-ins and extensions, explicitly exits folder browsing, and verifies activation. Route mirror clicks, host-port activation, OS launch, lazy preparation, restore, and neighbor reassertion through it.
2. Keep identity/mount anchors in inventory but stop treating them as interactive strip entries. Exclude folder buttons from leaf move/context-menu actions.
3. Stop returning successful order convergence when nested organization makes the requested flat order impossible. Protect host folder data and suspend incompatible DOM order mutations until a structured projection exists.
4. Preserve native organization access where possible during the transition. Explain any temporary limitation in the actual affected settings surface; do not silently flatten or delete saved folders as an automatic repair.
5. Migrate the staging Council catalog and stale selections separately from folder identities.

This phase can make activation reliable and avoid destructive assumptions. It is **not full folder support**: a flat Canvas mirror still fails to present native grouping. Do not declare Canvas staging fully compatible on this phase alone.

### Phase B — Extend organization across the owned model

Recommended authority: Canvas's existing owned model remains authoritative while Canvas owns the drawer surfaces. Add organization to that model and derive both Canvas surfaces and any host projection from it. Import host organization at migration / deliberate external-adoption boundaries. Do not let a recursive DOM scan become a second organization writer.

Proposed contracts:

| Layer | Needed change |
| --- | --- |
| `core/model.ts`, `core/intents.ts`, reducer/selectors | Ordered `tab / folder / divider` items per drawer; explicit membership and organization intents; tab identity remains separate from container identity. |
| `tabs/identity.ts`, host adapter | One mapping between live ID, canonical host layout ID, and existing frozen TabKey; retain metadata for unavailable extension children. |
| `dom/host-settings.ts`, host bridge | Typed structured-layout read/write/watch and navigation capabilities; merge latest host settings and preserve unrelated fields. |
| `host/lumiverse/implementation.ts`, observer | Observe semantic organization, verify writes, keep mount inventory distinct from rendered entries. |
| `sidebar/main-renderer.ts`, secondary buttons/shell | Shared organization projection for root tabs, dividers, folders, child navigation, counts, badges, icons, and empty-folder behavior. |
| Configure, live DnD, context menus | Structured drafts and item-kind actions; one commit path for root order, child order, membership, and cross-drawer moves. |
| Persistence and mode slots | Versioned migration and organization snapshots for single, dual, OS-single, OS-dual; preserve delayed/unknown members. |
| OS / active-state / header logic | Folders browse tabs; leaf tabs remain windows. Folder browsing must not create a closed/minimized window entry. |

Flat tab lists can remain **derived compatibility views** for current leaf-window actions and existing consumers during migration. Do not keep independently writable flat order and organization order. Persist a new schema version, retain a non-destructive fallback/export for old layouts, and test downgrade behavior before deciding to remove legacy fields.

Recommended product semantics to settle in the implementation:

- Moving a leaf to another drawer removes it from its current folder; it enters the destination root unless a folder target is explicitly selected. Preserve the independent organization of inactive mode profiles.
- Moving a folder is a group operation that moves its children together and preserves their internal order; dividers remain root-only.
- Deleting a folder spills children at its root position, matching the host's semantics. Hiding a leaf does not erase its membership. OS close/menu-hide do not delete membership either.
- Keep empty/unavailable folders in saved state; presentation can suppress an empty folder while its members are unavailable. Folder counts reflect visible, renderable children for that drawer.
- Retain host `tabOrder` as a flattened compatibility projection if writing host organization. Serialize both from the same transaction.
- Custom icon data uses the host's sanitized structure. Any Canvas mirror should preserve permitted icon/badge presentation without cloning `data-spindle-mount` nodes.

These are recommendations, not changes made in this investigation. The biggest design constraint is maintaining one organization authority while retaining Canvas's existing mode-slot isolation and boot merge convergence.

### Phase C — Validate the complete supported pair

Use a disposable Lumiverse staging preview and fresh profile per full smoke. Record both commit IDs and profile location. Automated gates and browser walks should cover the following matrix.

| Scenario | Required result |
| --- | --- |
| Upgrade flat layout to structured layout | Same leaf order, hidden state, active/open state, widths, and four mode profiles. |
| Existing native folders before enabling Canvas | Grouping, child order, divider labels, icons/view, and temporarily unavailable IDs preserved. |
| Foldered built-in and extension, cold and already viewed | Correct content on primary click, restore, OS launch, and move; no false `ok`. |
| Folder browsing with same current host tab | Activation exits browsing without selecting a temporary unrelated tab. |
| Root↔folder, folder↔folder, child reorder | Membership/order match model, render, saved state, host projection, and reload. |
| Cross-drawer leaf and folder moves | Placement-first semantics; source neighbor correct; destination content/title correct; no duplicate ownership. |
| Last visible child leaves / hides / closes | Predictable folder presentation, preserved saved membership, no empty active panel trap. |
| Single↔dual and OS↔non-OS | Each profile retains organization and selection independently. |
| Extension reload and `:N` change | Same folder and Canvas identity; no ghost duplicates or misplaced child. |
| Extension unavailable at boot, late registration | Saved organization retained; registration restores child at saved position without undoing user changes. |
| Native organization edited while Canvas is disabled | Defined import behavior on re-enable; no stale-profile overwrite of external edits. |
| Left/right, Sides/Top/Bottom, compact/labeled, mobile crossing | Rendered grouping, keyboard/touch actions, hit targets, geometry, and close affordances work. |
| UI scale, host resize, Canvas resize, chat/Welcome reflow | One width/geometry authority and no accidental overlapping controls or inconsistent insets. |
| Teardown and settings failures | Host mounts intact, user organization intact, no late generation writes. |
| Reconcile after settled edit | Subsequent sync is idle; no repeated order/activation writes or save cascade. |

Keep Canvas main paired with Lumiverse main. Shared safe fixes can be ported to a main-based task branch and validated separately; staging-only organization assumptions must not leak into stable.

## 5. Validation performed and limits

### Existing tests

- Canvas's prescribed `npm test` runner: **166 files passed, 0 failed**. Each file ran in its intended Bun mode.
- Lumiverse staging `frontend/src/lib/drawer-layout.test.ts`: **15 tests passed, 0 failed**. Covers canonical IDs, retained unavailable tabs, folders/dividers, deduplication, icon/view sanitization, and move/delete semantics.
- Canvas `tsc --noEmit`: **254 baseline diagnostics, all in test files; 0 non-test diagnostics** with TypeScript 7.0.2. This is not a clean full typecheck. Examples include missing `bun:test` declarations, legacy test shape errors, and global stub redeclarations. No source changes were made to conceal these errors.

Tools: Node 24.19.0, Bun 1.4.2, TypeScript 7.0.2, jsdom 30.1.2, esbuild 0.28.2, tsx 4.23.15. Canvas declares Bun 1.3.14; staging Lumiverse declares Bun 1.4.2. The investigation used the staging runtime version.

### Focused host/component harness

The harness rendered the **actual** Lumiverse staging `ViewportDrawer.tsx` in React/jsdom. It used the **actual** Canvas `DrawerObserver`, `LumiverseHost.activate`, `LumiverseHost.setOrder`, and partial host-settings merge. It also bundled the actual host drawer-layout logic.

The store was a reactive fixture; the registry contained three representative built-ins and one extension. Heavy tab content, icons, motion, resize/drag hooks, i18n, and permission/enabled filtering were stubbed. Content was represented by a marker showing the requested `TabPanelContent` ID. That is enough to validate navigation dispatch and DOM structure; it does not establish that real Lorebook/extension content lifecycle or authenticated host APIs work in a running app.

Eight focused checks passed:

1. Both hidden folder-child anchors remain in Canvas inventory; folder and divider are not tab entries; extension address retains the live counter.
2. Foldered built-in primary activation returns `ok` but leaves the host tab/content unchanged.
3. Foldered extension primary activation has the same false success.
4. Anchor activation cannot leave the actual host folder browser.
5. Setting the same current tab ID leaves the folder browser active.
6. Native folder tile click correctly activates the child (positive control).
7. Primary `setOrder` returns `ok` while nested child order prevents the requested order.
8. Partial host label-setting merge preserves existing folder data (preservation control).

Companion scripts and logs are available in `/workspace/reports/tab-folders-evidence/`. The output is phrased as successful reproduction assertions: it does **not** mean the underlying product behavior is correct.

### Not performed

No full backend/browser preview, real extension installation, authenticated settings persistence walk, screenshot review, mobile touch walk, or full four-profile upgrade simulation was performed. No sustained reconcile freeze, folder data loss, double chat inset, or resize conflict is claimed as reproduced. Those outcomes remain explicit acceptance checks for the implementation.

## 6. Evidence index

Host links are pinned to Lumiverse staging `c975b917223660e5cfc668620087df9b6f7843f9`. Canvas links are pinned to `465f6e2d55358925fa197d393932b17b4eeeb784`.

| Ref | Source and relevant contract |
| --- | --- |
| H1 | [Host DrawerLayoutItem / DrawerSettings](https://github.com/prolix-oc/Lumiverse/blob/c975b917223660e5cfc668620087df9b6f7843f9/frontend/src/types/store.ts#L885) — organization types and layout/legacy order. |
| H2 | [Host drawer-layout](https://github.com/prolix-oc/Lumiverse/blob/c975b917223660e5cfc668620087df9b6f7843f9/frontend/src/lib/drawer-layout.ts#L23) — canonical IDs; sanitize/default/reconcile/flatten functions. |
| H3 | [Native Configure persistence](https://github.com/prolix-oc/Lumiverse/blob/c975b917223660e5cfc668620087df9b6f7843f9/frontend/src/components/modals/ConfigureDrawerTabsModal.tsx#L464) — coupled layout/tabOrder writes. |
| H4 | [Host ViewportDrawer](https://github.com/prolix-oc/Lumiverse/blob/c975b917223660e5cfc668620087df9b6f7843f9/frontend/src/components/panels/ViewportDrawer.tsx#L175) — folder state, navigation; `renderTabButton` at 302; folder slot at 420; folder panel at 499. |
| H5 | [Hidden anchor CSS](https://github.com/prolix-oc/Lumiverse/blob/c975b917223660e5cfc668620087df9b6f7843f9/frontend/src/components/panels/ViewportDrawer.module.css#L599) — `display:none !important`. |
| H6 | [Host registry and Council aliases](https://github.com/prolix-oc/Lumiverse/blob/c975b917223660e5cfc668620087df9b6f7843f9/frontend/src/lib/drawer-tab-registry.tsx#L478) — aliases and shared root navigation. |
| H7 | [Host store navigation](https://github.com/prolix-oc/Lumiverse/blob/c975b917223660e5cfc668620087df9b6f7843f9/frontend/src/store/slices/ui.ts#L85) and [surface drawer action](https://github.com/prolix-oc/Lumiverse/blob/c975b917223660e5cfc668620087df9b6f7843f9/frontend/src/lib/spindle/host-actions.ts#L124) — store-only openDrawer semantics. |
| H8 | [Built-in root accessor](https://github.com/prolix-oc/Lumiverse/blob/c975b917223660e5cfc668620087df9b6f7843f9/frontend/src/lib/spindle/loader.ts#L1575) and [Lorebook visibility gate](https://github.com/prolix-oc/Lumiverse/blob/c975b917223660e5cfc668620087df9b6f7843f9/frontend/src/components/panels/world-book/WorldBookPanel.tsx#L206) — root creation and data readiness are distinct. |
| C1 | [Canvas DrawerObserver](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/sidebar/drawer-observer.ts#L184) — DOM order; recursive scan at 201; identity registration at 292. |
| C2 | [Canvas host adapter](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/host/lumiverse/implementation.ts#L579) — direct DOM order projection; primary activation at 696. |
| C3 | [Canvas main renderer](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/sidebar/main-renderer.ts#L453) — flat rendering; twin click at 680. |
| C4 | [Canvas model](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/core/model.ts#L9) — flat version-2 layout. |
| C5 | [Canvas root-button reorder](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/tabs/buttons.ts#L590) and [reconcile order diff](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/recon/reconcile.ts#L103). |
| C6 | [Configure intercept](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/tabs/configure-intercept.ts#L106) — capture-phase modal replacement. |
| C7 | [ConfigureDraft](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/tabs/configure-model.ts#L14) — flat IDs; [draft construction](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/tabs/configure-modal.tsx#L1609). |
| C8 | [Owned Configure commit](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/tabs/owned-commit.ts) — model transaction / placement pipeline. |
| C9 | [Built-in preparation](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/tabs/builtin-move.ts#L184), [primary restore](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/sidebar/main-persist.ts#L877), and [OS launch](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/os/actions.ts#L329). |
| C10 | [Persistence model](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/persist/layout-model.ts) and [mode profiles](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/layout/mode-profiles.ts). |
| C11 | [Active-tab fallback](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/tabs/active-tab.ts#L20). |
| C12 | [Context-menu capture](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/context-menu/index.ts#L379) — title fallback for sidebar buttons. |
| C13 | [Visible-order helper](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/tabs/live-tab-order.ts#L29) — inline-hide check. |
| C14 | [Built-in catalog](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/tabs/configure-catalog.ts#L24) — staging catalog drift. |
| C15 | [Partial host-settings merge](https://github.com/j-dandelion/Lumiverse-Canvas/blob/465f6e2d55358925fa197d393932b17b4eeeb784/src/dom/host-settings.ts#L199) — folder-preserving merge. |

## 7. Handoff and release boundary

The recommended implementation is a staging compatibility project with navigation stabilization first, then organization/model/editor/persistence support, then the paired preview matrix. Do not promote the current Canvas staging head as folder-compatible based on its existing green suite.

Any implementation should use `agent/<task>-staging`, follow the existing Canvas skill and invariants, and record test and live-preview evidence. This investigation does not authorize a commit, release, or promotion. Per the repository workflow, Canvas does not use pull requests; the owner accepts a task-branch candidate before promotion to a compatibility branch.
