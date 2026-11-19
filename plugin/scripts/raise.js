// Window helpers for the game pop-up on macOS (run with osascript -l JavaScript).
// The pop-up lives in a browser instance of its own (see open.sh), so that
// process has one window and activating it can only raise the game.
//
//   raise.js place
//     Print "x,y": where a 460x800 window sits against the right edge of the
//     main screen.
//   raise.js eligible <origin bundle>
//     Print "ok" when the app that submitted the prompt still has focus.
//   raise.js front <pid> [wait|now] [origin bundle] [settings directory]
//     Activate at most once. Return "none" only for a genuinely windowless
//     instance, and "skipped" if focus moved or activation failed.
//
// Activation goes through NSRunningApplication: "open -a" would send a reopen
// event and could open or raise something other than the pop-up.
ObjC.import('AppKit');
ObjC.import('CoreGraphics');

function popupWindows(pid) {
  // Include minimized windows and other Spaces, so a hidden popup never looks
  // like an empty browser that needs a second window.
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(16, 0)));
  if (!Array.isArray(all)) return null;
  return all.filter(function (w) { return w.kCGWindowLayer === 0 && w.kCGWindowOwnerPID === pid; });
}

function eligible(origin) {
  if (typeof origin !== 'string' || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(origin)) return false;
  const current = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  return !current.isNil() && ObjC.unwrap(current.bundleIdentifier) === origin;
}

function front(pid, wait, origin, directory) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (app.isNil()) return 'none';
  let deadline = Date.now() + (wait ? 5000 : 0);
  let requested = false;
  for (;;) {
    const windows = popupWindows(pid);
    if (!windows) return 'skipped';
    const visible = windows.some(function (w) { return w.kCGWindowIsOnscreen; });
    if (visible && app.active) return 'ok';
    if (origin !== undefined && !eligible(origin)) return 'skipped';
    if (!requested && (visible || (windows.length && origin === undefined))) {
      if (directory && ['off', 'no-auto-open'].some(function (name) {
        return $.NSFileManager.defaultManager.fileExistsAtPath(directory + '/' + name);
      })) return 'skipped';
      requested = true;
      app.activateWithOptions(2);
      deadline = Date.now() + 700;
    }
    if (Date.now() >= deadline) return windows.length || requested ? 'skipped' : 'none';
    delay(0.05);
  }
}

function run(argv) {
  if (argv[0] === 'place') {
    // The same sums the /agent page does with screen.availWidth/availHeight,
    // so the page finds the window already where it would put it.
    const usable = $.NSScreen.mainScreen.visibleFrame.size;
    return Math.round(usable.width - 460 - 24) + ',' + Math.round(Math.max(0, (usable.height - 800) / 2));
  }
  if (argv[0] === 'eligible') return eligible(argv[1]) ? 'ok' : 'skipped';
  if (argv[0] === 'front') return front(Number(argv[1]), argv[2] === 'wait', argv[3], argv[4]);
}
