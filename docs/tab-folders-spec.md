# Canvas staging: tab folders and dividers

**Status:** Implemented on the Canvas staging task branch. Automated and isolated visual checks are recorded in the [implementation report](tab-folders-implementation.md); authenticated full-app verification remains outstanding.

**Target:** Canvas staging paired with Lumiverse staging. Reference implementation: Lumiverse `c975b917`; Canvas baseline `465f6e2`.

**Related investigation:** [Compatibility report](tab-folders-compatibility-report.md).

## 1. Goal and design constraints

Integrate native tab folders and dividers into Canvas's existing drawers, Configure Tabs, layout modes, and OS launcher. The result should feel like the same Canvas UI with native Lumiverse organization support.

- Preserve existing drawer dimensions, tab button sizes, panel headers, chrome placement, theme variables, typography, and established motion.
- Match Lumiverse's folder browsing, folder-button appearance, active-folder indication, icon choices, and divider appearance closely.
- Use the same organization interactions in the main and second drawers, on Sides, Top, and Bottom.
- Keep one level of folders, matching Lumiverse. Dividers and folders live at root; only tabs live inside folders.
- New organization editing belongs in the existing Configure Tabs interface. No new top-level settings section or separate organization application is required.
- Implement complete support for navigation, organization, persistence, and mode transitions. A visually correct folder whose children fail to activate is not acceptable.

## 2. Decision record

### Accepted user decisions

| ID | Decision |
| --- | --- |
| D1 | Clicking a folder opens a folder browser in the drawer panel, following Lumiverse's list/grid model. |
| D2 | Folder-button presentation and active-child indication should be as close to Lumiverse as possible. |
| D3 | Keep Configure Tabs' existing columns; add small creation controls and expandable folder rows with indented children. Visual refinement is a requirement. |
| D4 | Cross-drawer and membership rules are delegated to implementation judgment. The chosen rules are specified below. |
| D5 | Divider presentation should be as close to Lumiverse as possible. |
| D6 | OS Start entries are grouped by folders; folder launchers remain available when their children are closed. |
| D7 | OS folder browsers include closed children and reopen them on selection. Tabs manually hidden through Configure Tabs stay absent. |
| D8 | Restore the folder browser after reload when it was the last visible panel, independently in each mode profile. |
| D9 | Adopt organization edits made in Lumiverse while Canvas is disabled. Preserve Canvas's second-drawer organization and inactive mode profiles. |
| D10 | Start opens/restores/focuses a tab in its owning drawer, preserving its folder membership. Chosen using the user's delegated judgment. |

Detailed rules below are chosen defaults within the user's delegated design direction. No product decisions remain pending.

## 3. Folder buttons and browsing

### Tab strip

- One folder button represents its children. Child buttons are not also displayed as root tabs.
- Use the folder's selected native preset/custom icon. Keep that icon when a child is active; do not substitute the child's icon.
- The folder name follows the existing Show tab labels setting. Icon-only mode retains the full name and count in the tooltip, matching native behavior.
- Apply the existing active treatment when the browser for that folder is visible or one of its children is the displayed tab. A minimized/closed drawer follows Canvas's existing open-only highlight rule.
- Root tab buttons, Settings, Start, and existing dock separators retain their current appearance and positions.

### Click behavior

1. Clicking a folder opens its owning drawer and displays that folder's browser.
2. Clicking that folder again while browsing leaves the browser open, matching native behavior. Existing drawer close controls remain the close affordance.
3. The panel header displays the folder name. The browser toolbar shows its available-child count, list/grid toggle, and Configure Tabs action.
4. Clicking a child displays that tab's ordinary content in the same drawer. The header changes to the tab's normal title; the folder button remains the active strip representative.
5. Clicking the folder button from a child returns to browsing its contents.
6. Selecting any other tab or folder ends the previous browsing presentation. Direct navigation to a child also exits browsing, including navigation to the same remembered host tab ID.

### Folder browser visual contract

- Follow Lumiverse's native list and two-column grid presentation, including icons, names, descriptions, list separators, and selection affordances.
- Default new folders to list view. Save the list/grid preference per folder.
- Reuse Canvas's existing shell header and panel scrolling boundaries; introduce no second outer header.
- Use Lumiverse theme tokens and Canvas's current font/scale conventions. Keep toolbar actions quiet and compact.
- Grid layout adapts to the available panel width, using one column where two columns would crowd text or touch targets. Content scrolls within the existing panel.
- Selecting a child uses existing content-switch behavior. Opening the browser uses the ordinary drawer animation; no extra animated folder overlay is introduced.

### Empty and unavailable members

- Preserve empty folders and unavailable child membership in saved organization and Configure Tabs.
- In ordinary drawer mode, suppress a folder button when it has no available, non-hidden children, matching Lumiverse.
- If the currently browsed folder loses its last available child, keep its browser visible with a quiet empty state and Configure Tabs action. Avoid switching to an unrelated tab as an automatic side effect.
- In OS mode, keep a folder launcher when it has available closed children even if none is currently open. Those children appear in its browser and reopen on selection.
- A structurally empty folder or a folder containing only unavailable/manually hidden children remains accessible through Configure Tabs; it does not require an empty launcher on every strip.

## 4. Dividers

Lumiverse currently renders dividers as lines; an optional label is a tooltip, not a permanent section heading. Canvas will match that treatment.

- Vertical strips use a subtle horizontal line; horizontal strips use a subtle vertical line.
- Use native-style stroke, spacing, and theme color, scaled to the existing Canvas strip geometry.
- Optional label appears as a tooltip and an editable field in Configure Tabs. Show tab labels does not turn it into large strip text.
- Dividers do not activate content or participate in active-tab selection, OS window state, or tab counts.
- Preserve explicit root divider order, including leading, trailing, and adjacent dividers. Do not silently delete saved separators to normalize a layout.
- User-created dividers remain distinct from existing Settings/Start dock separators and cannot move dock controls.
- Keep useful accessible descriptions without making a decorative separator behave like a tab button.

## 5. Configure Tabs

### Preserve the existing interface

- Retain current title/header actions, single/dual column behavior, drawer side controls, footer controls, tab rows, descriptions, badges, and visibility toggles.
- Add compact Add folder and Add divider controls near each active drawer-column heading. Creation applies to that column and places the item at its root end.
- Use existing icon-button/secondary-action styling. Narrow layouts may combine creation actions in a small Add menu rather than widening the dialog.

### Folder rows

- Render a folder as a row consistent with current tab rows: drag handle, disclosure chevron, icon, name, and muted member count.
- Expand to show existing tab rows with a modest indent and aligned controls. Avoid a large new card or a second full-width toolbar for each folder.
- Child visibility toggles retain current meanings. Folder visibility is derived from its children; there is no ambiguous folder switch that changes every child at once.
- New folders start expanded with the name ready to edit. Existing disclosure state is an editor preference and does not alter membership or browser selection.
- Renaming and icon editing use compact inline editing or a small anchored editor. Secondary row actions become visible on hover/focus and remain reachable on touch.
- Support Lumiverse's preset icons and structured custom SVG icons. Imported native icons must render even before the user opens the editor. Custom import UI appears only on request.
- Show unknown/unavailable saved children as muted rows with their best-known names. Keep their saved positions and allow removal from the folder without fabricating a live tab.

### Divider rows

- Use a slim row with drag handle, line preview, optional label field, and delete action.
- Make its item type clear without the visual weight of a tab card.
- Deleting a divider removes only that divider.

### Editing and deletion

- Preserve Canvas's existing immediate-commit behavior; Done dismisses the editor after pending writes settle. No new Apply/Cancel transaction model is introduced.
- Editing a name should not commit half-formed membership or disrupt an unrelated drag. Commit naming at an appropriate edit boundary and retain the current failure/retry surface.
- Blank folder names fall back to the native default Folder. Duplicate display names are allowed; IDs distinguish folders.
- Deleting a folder removes its container and returns all children to the same root position, in order. Children retain hidden, closed, menu-hidden, and extension-availability state.
- If that folder is being browsed when deleted, display its first available/selectable child at the former folder position, or leave no active panel if there is none. Deletion never closes all its child windows.
- Opening Configure Tabs from a browser or item menu focuses/reveals the relevant folder/divider when possible.

## 6. Moving and drag-and-drop

Chosen defaults for D4:

| Action | Result |
| --- | --- |
| Reorder root item | Move the tab, folder, or divider as one root item. |
| Drop a tab onto a folder | Move it into that folder; append unless targeting a specific child insertion position. |
| Reorder a child | Update order within its folder. |
| Move child to another folder | Remove from source and insert at the indicated destination position. |
| Move child to root | Remove membership and insert at the indicated root position. |
| Move individual tab to the other drawer through its menu | Move to the destination root end. Returning it later places it at that drawer's root; former membership is not silently restored. |
| Move folder to the other drawer | Carry all children in order, including hidden/closed/unavailable members. |
| Move divider to the other drawer | Move only the divider as a root item. |
| Drop folder/divider onto a folder | Show an invalid nesting target; keep root-only structure. |

- Live strip drag remains governed by the existing drag-and-drop setting. Configure Tabs retains its own drag handles and accessible move alternatives.
- Root insertion uses the existing insertion-marker styling. A folder membership target uses a restrained theme highlight, visually distinct from inserting before/after the folder.
- In Configure Tabs, hovering a collapsed folder during a drag expands it after a short deliberate dwell; moving away cancels the dwell. A folder target can accept a drop while collapsed.
- Folder-to-folder drops do not imply nesting or merging by name. The operation must clearly select a root insertion target.
- Dragging a group preserves its internal order and applies one atomic model transaction. A failed required placement leaves a recoverable result and reports failure; a successful-looking partial group move is unacceptable.
- Moving an inactive group preserves the displayed content. If it contains the displayed child or browser, hand off the source to the nearest selectable root item and open the moved selection on the destination for an explicit move action. Reordering within a drawer preserves selection.
- Escape/pointer cancellation removes drag chrome and preserves the last committed organization. It cannot leave a temporary folder expansion or placeholder as saved membership.
- Context menus offer existing Configure Tabs and cross-drawer move actions with correct item kinds. Leaf menus can offer Move to folder / Move out of folder; folder menus move the group. Destructive editing remains available in Configure Tabs.

## 7. OS mode

### Folder launchers

- A folder is a browser/launcher for child windows, not an additional window in the closed/minimized sets.
- Browsing a folder replaces the displayed child presentation; it does not close children. A previously displayed child becomes minimized by the ordinary selection change.
- The browser header has the ordinary drawer dismiss action. Window-specific Close/Minimize actions are not applied to the whole folder or all of its children.
- Dismissing the browser collapses that drawer without modifying child window states or membership.
- Selecting a child through the browser explicitly opens/restores/focuses it; this is not the taskbar's active-window toggle-to-minimize gesture.
- Include closed children with a muted Closed status. Clicking one reopens it and restores visibility hidden by the close action. Manually hidden children remain omitted; closing a tab must not be mistaken for manually hiding it.
- Folder counts must be honest about browser contents. Retain the native count treatment; do not add a row of new counters to each strip button.

### Start menu

- Keep the existing Start menu shell, header, icons, typography, window-state marks, manage/visibility controls, anchoring, and motion.
- Group folder members under compact expandable folder rows. Root leaves remain ordinary entries. Use organization order inside each drawer so grouping matches Configure Tabs and the strip.
- The launcher still covers both drawers. Distinguish owning drawer where identical folder names would otherwise be ambiguous, using restrained section labels or secondary text.
- Folder disclosure browses children inside Start; it does not launch all children. Child entries retain their individual state marks and menu-hidden controls.
- Start opens/restores/focuses a child in its owning drawer and preserves its organization position and membership, including when Start was opened from the other drawer or the child was closed. This replaces the existing launch-to-invoking-drawer behavior; selecting a launcher is not a move command. Explicit cross-drawer move actions retain the rules in section 6.
- If that owner is currently closed, open it using the existing drawer command. Mobile mutual exclusion still applies: switching to the owner closes the other drawer's presentation without closing its windows. Single-mode profiles have one active owner after their ordinary folding/restore rules.
- A menu-hidden child stays menu-hidden when launched through another route, following existing Canvas rules. A folder group with no normally listed children is suppressed in ordinary Start view but can be inspected through Manage.
- User-created strip dividers need no launcher entry; Start can use subtle separators at corresponding group boundaries when they improve readability.

## 8. Mobile, keyboard, and visual acceptance

- Preserve current mobile drawer mutual exclusion, mode normalization, and existing Top/Bottom behavior.
- Folder tiles use normal touch tap. Long press uses the existing context-menu gesture; choosing a folder never requires hover.
- Provide keyboard activation of folder buttons, child tiles, and disclosure controls. Manage focus when replacing a browser with a child panel or deleting the focused container.
- Existing tab labels and descriptions stay legible at supported UI/font scales. Grid mode cannot force horizontal scrolling or clipped controls.
- Test both theme families already supported by Canvas, compact/labeled strips, all drawer locations, left/right sides, single/dual modes, and reduced motion.
- Visual acceptance requires paired screenshots or a working preview showing the existing Canvas UI beside the new state. Review strip rhythm, editor indentation/alignment, folder browser density, Start grouping, and mobile touch targets.
- “Looks nice” means the added rows/actions use the same visual hierarchy as surrounding Canvas controls, the dialog remains balanced, and unchanged screens retain their current layout. A functional test suite alone does not satisfy this requirement.

## 9. Persistence and native interoperability

- Persist organization, folder IDs/names/icons/view, divider IDs/labels, and tab membership in each existing single/dual/OS mode profile.
- Preserve profile independence when switching modes. Editing the active profile does not overwrite organization in inactive profiles.
- Old flat profiles migrate to equivalent root tab order without introducing user-created folders or dividers. Existing native organization is imported at the appropriate first-use boundary.
- Extension reload/counter changes, temporary disablement, and late registration preserve membership and order. Persistent IDs and current live addresses are separate.
- Save tab-versus-folder presentation per drawer/profile, so an open folder browser is restored accurately. Preserve the remembered leaf separately for leaving the browser. A missing restored folder falls back to the remembered available child or a selectable root item, using the existing mode's visibility rules.
- Import verified native edits after a Canvas-disabled interval into the active profile's main/single organization. A Canvas-generated projection must not be mistaken for an external edit. Preserve the second drawer and inactive mode profiles, and record an explicit import boundary so ordinary model echoes cannot clobber user edits.
- In a dual profile, tabs already owned by the preserved second drawer remain there even if they appear in the native single-drawer layout. Filter those tabs from the imported main organization rather than duplicating them or moving them out of the second drawer. Preserve the imported folder/divider records, including any folder left empty by this ownership rule.
- Recognize native containers projected from Canvas's second drawer by their IDs and retain those containers in the protected second organization. New main/unknown members added to such a native counterpart are imported at main root rather than duplicating the container.
- While Canvas is active, Canvas's organization model is the single source for its owned surfaces; any native host projection and legacy flat order are derived together. Opening native Configure Tabs must route to the same authority or use a defined adoption transaction.
- Disabling Canvas must leave a valid native single-drawer organization with all available tabs reachable, while retaining Canvas's saved dual/OS profiles. Native data must not be flattened merely to bypass an incompatible adapter.

## 10. Engineering requirements and acceptance tests

Use the existing dispatcher, placement-first model, identity resolver, generation gates, mode restore convergence, strip geometry writer, and persistence seams. Extend the organization contracts rather than adding a competing tab store.

### Model and integration contract

- Keep tab ownership keyed by stable `TabKey`. Add ordered root organization items for tabs, folders, and dividers, with folder children referring to those same keys. Each tab has one owner and at most one organization position in a profile. Validate both together at transaction boundaries.
- Folder/divider IDs identify organization items, not tabs or extension mount targets. Do not register a folder as a fake tab, put it into leaf window-state sets, or overload title matching to identify it.
- Represent the selected presentation explicitly as a tab, folder browser, or no panel. Retain the remembered leaf separately. The displayed presentation, drawer header, strip highlight, and persistence must agree after each settled action.
- Build both drawers' folder controls and browsers from the same organization/visibility rules. Reuse native visual treatments inside Canvas's existing drawer shells; host-only local browser state cannot be the authority for Canvas's second drawer or reload restoration.
- Keep Lumiverse's hidden child anchors and extension mount roots intact. Discover inventory through the host adapter, but activate content through a verified navigation path rather than clicking noninteractive anchors. Do not repair ordering by moving React-owned anchors out of folders.
- Version the persisted organization/presentation data and distinguish manual hiding from visibility changed by OS close. Document how ambiguous legacy combinations migrate and remain recoverable through existing controls.
- Treat host projection, adoption of external edits, and Canvas rendering as separate adapter operations driven by the same model. Compare against the last projected native organization to detect outside changes; avoid a two-way synchronization loop that alternately overwrites host and Canvas state.

### Delivery sequence

1. Establish versioned organization, selection, and migration contracts with activation/import tests before changing visible controls.
2. Integrate folder/divider strips and folder browsers in both drawers, including same-tab navigation and restore behavior.
3. Extend Configure Tabs and group moves, then grouped OS Start and closed-child launch behavior.
4. Verify the paired staging build across modes, native disable/re-enable, unavailable extensions, and the visual matrix before handoff.

Mandatory correctness checks:

1. Foldered built-in and extension children activate from browser, restore, Start, direct navigation, and cross-drawer moves; actual content matches selection.
2. Navigation to the same remembered host tab exits browsing explicitly.
3. Inventory anchors remain intact for Spindle mounts, and no hidden anchor is treated as an interactive strip entry.
4. Root/child order and membership converge semantically. Settled edits produce no repeated order writes or persistence cascade.
5. Group moves, failed placement, unavailable children, and boot-time user changes preserve ownership without duplicates or lost membership.
6. Folder deletion spills children at the exact position and preserves leaf state. Divider deletion changes no tabs.
7. All four profiles survive reload/mode changes independently, including custom icons, view preference, and restoration of the last visible folder browser.
8. Closed children appear and reopen through the folder browser; manually hidden children stay absent. Hidden, menu-hidden, and OS-closed states retain their separate meanings and recovery paths. Existing legacy overlap between core-tab close and hidden state requires a documented migration strategy.
9. Native import/disable/re-enable adopts external edits without treating Canvas's own writes as outside edits, duplicating second-drawer tabs, or overwriting inactive profiles.
10. Keyboard/touch behavior and visual acceptance cover the matrix above.
11. Cross-drawer Start launch opens the owning drawer and preserves folder membership and position, including closed-child restoration and mobile mutual exclusion; explicit move commands follow section 6.

Run the prescribed Canvas test runner and typecheck gate, targeted host contract tests, and a disposable paired staging preview. Record source commits/profile and distinguish existing baseline test typing errors from new errors.

## 11. Scope boundary

The product work covers folders/dividers and the activation/model/persistence changes required to make them reliable. Refresh the staging built-in catalog where upstream consolidation affects these surfaces. Resolve resize/chat-centering conflicts if they prevent correct presentation; unrelated UI redesigns are outside this spec.

This specification records the accepted behavior and acceptance criteria. The [implementation report](tab-folders-implementation.md) documents the resulting code, visual review, validation, and practical limits.
