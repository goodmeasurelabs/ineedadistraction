// Window helpers for the game pop-up on macOS (run with osascript -l JavaScript).
// The pop-up lives in a browser instance of its own (see open.sh), so that
// process has one window and activating it can only raise the game.
//
//   raise.js place
//     Print "x,y": where a 460x800 window sits against the right edge of the
//     main screen.
//   raise.js front <pid> [wait]
//     Bring that browser instance's window in front of other apps. Prints "ok"
//     once its window is the top window on screen, "none" if it has no window
//     on screen. With "wait", allow a few seconds for the window to appear.
//
// Activation goes through NSRunningApplication: "open -a" would send a reopen
// event and could open or raise something other than the pop-up.
ObjC.import('AppKit');
ObjC.import('CoreGraphics');

function topWindow() {
  // 1|16 = on screen, without desktop elements; listed front to back.
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(1 | 16, 0))) || [];
  return all.filter(function (w) { return w.kCGWindowLayer === 0; });
}

function front(pid, wait) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (app.isNil()) return 'none';
  const deadline = Date.now() + (wait ? 5000 : 0);
  let activated = 0;
  for (;;) {
    const list = topWindow();
    if (list[0] && list[0].kCGWindowOwnerPID === pid) return 'ok';
    const has = list.some(function (w) { return w.kCGWindowOwnerPID === pid; });
    if (has && Date.now() - activated > 400) { app.activateWithOptions(2); activated = Date.now(); }
    // Without "wait", give one activation a moment to land, then report.
    if (Date.now() >= (has && !wait ? activated + 700 : deadline)) return 'none';
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
  if (argv[0] === 'front') return front(Number(argv[1]), argv[2] === 'wait');
}
