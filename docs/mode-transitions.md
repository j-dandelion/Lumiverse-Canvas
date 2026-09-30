# Live mode transitions

Chrome-mode changes (OS, Taskbar, Vanilla, and drawer-location changes) acquire
the presentation-only guard in `settings/mode-reveal.ts` before `setSettings`
publishes the normalized setting and applies any features. This is independent
of the boot restore guard: it does not change model observation or persistence.

The OS feature registers the actual serialized drain promise, including when a
new selection joins an existing drain. The reveal waits for that work, the
bootstrap placement/removal pass, the model flush, content settlement, and the
scheduled chrome render. Requests arriving during settlement keep the same
guard until the newest destination settles. Intermediate reflow observations
are coalesced into one final chat/Welcome update.

Both Canvas shells, parked panel bodies, the secondary strip, and the host
drawer are guarded. The main pinned strip stays visible for OS → Taskbar;
when pinning or the strip edge changes it joins the guard. Settled surfaces
share one 180 ms opacity reveal, disabled under reduced-motion preferences.

The 15-second recovery timer releases a wedged visual guard. Errors also
release it; extension teardown cancels it without writing chat margins or
starting a fade. Session identity checks keep obsolete asynchronous tails
from affecting a newer transition. Existing layout-slot ownership, lazy panel
activation, and the placement-first restoration rules remain authoritative.
