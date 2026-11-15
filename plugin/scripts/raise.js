// Bring the game pop-up in front of the terminal (macOS, run with osascript).
//   osascript -l JavaScript raise.js "<browser app name>"
// A browser that is already running opens the pop-up behind other apps, at its
// own default size; the page then shapes it to 460 wide. Wait for that so the
// window comes forward already in place, then activate the browser. Plain
// "open -a" would send a reopen event and raise the browser's main window.
ObjC.import('AppKit');
ObjC.import('CoreGraphics');

function run(argv) {
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications.js
    .filter(function (p) { return p.localizedName.js === argv[0]; });
  const pids = apps.map(function (p) { return p.processIdentifier; });
  function shaped() {
    const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
    return all.filter(function (w) {
      return w.kCGWindowLayer === 0 && pids.indexOf(w.kCGWindowOwnerPID) >= 0 && w.kCGWindowBounds.Width === 460;
    });
  }
  // Pop-ups left open from earlier sessions are already 460 wide; ignore them.
  const before = shaped().map(function (w) { return w.kCGWindowNumber; });
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const fresh = shaped().filter(function (w) { return before.indexOf(w.kCGWindowNumber) < 0; })[0];
    if (fresh) {
      // Activate only the process that owns the window: browser helpers share
      // the app's name, and activating one of those takes focus with no window.
      apps.forEach(function (p) { if (p.processIdentifier === fresh.kCGWindowOwnerPID) p.activateWithOptions(2); });
      return;
    }
    delay(0.05);
  }
}
