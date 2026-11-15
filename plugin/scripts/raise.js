// Keep the game to one pop-up window and bring it in front of the terminal
// (macOS, run with osascript -l JavaScript).
//
//   raise.js existing <state file>
//     If the pop-up recorded in the state file is still open, bring it forward
//     and print "ok". Prints "none" if it is gone or did not end up on top, in
//     which case the caller opens a new one.
//   raise.js new <browser app name> <state file>
//     Run right after the browser was asked for a pop-up. A browser that is
//     already running opens it behind other apps, at its own default size; the
//     page then shapes it to 460 wide. Wait for that so the window comes
//     forward already in place, record it in the state file, and activate it.
//
// Activation goes through NSRunningApplication: "open -a" would send a reopen
// event, which raises the browser's main window instead of the pop-up.
ObjC.import('AppKit');
ObjC.import('CoreGraphics');

// option 0 = every window (other Spaces, minimised); 1|16 = on screen, front to back.
function windows(option) {
  const all = ObjC.deepUnwrap(ObjC.castRefToObject($.CGWindowListCopyWindowInfo(option, 0))) || [];
  return all.filter(function (w) { return w.kCGWindowLayer === 0; });
}

function existing(stateFile) {
  const saved = $.NSString.stringWithContentsOfFileEncodingError(stateFile, 4, null);
  if (saved.isNil()) return false;
  const parts = saved.js.trim().split(' ').map(Number);
  const id = parts[0], pid = parts[1];
  // Window numbers are reused after a restart, so the owner has to match too.
  if (!windows(0).some(function (w) { return w.kCGWindowNumber === id && w.kCGWindowOwnerPID === pid; })) return false;
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  if (app.isNil()) return false;
  app.activateWithOptions(2);
  // Activating raises the browser's most recent window, which is the pop-up
  // unless another of its windows was used since. Confirm rather than assume.
  for (let i = 0; i < 12; i++) {
    const top = windows(1 | 16)[0];
    if (top && top.kCGWindowNumber === id) return true;
    delay(0.05);
  }
  return false;
}

function fresh(appName, stateFile) {
  const apps = $.NSWorkspace.sharedWorkspace.runningApplications.js
    .filter(function (p) { return p.localizedName.js === appName; });
  const pids = apps.map(function (p) { return p.processIdentifier; });
  function shaped() {
    return windows(1 | 16).filter(function (w) { return pids.indexOf(w.kCGWindowOwnerPID) >= 0 && w.kCGWindowBounds.Width === 460; });
  }
  // Pop-ups already open are 460 wide too; only a new one counts.
  const before = shaped().map(function (w) { return w.kCGWindowNumber; });
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const found = shaped().filter(function (w) { return before.indexOf(w.kCGWindowNumber) < 0; })[0];
    if (found) {
      $(found.kCGWindowNumber + ' ' + found.kCGWindowOwnerPID + '\n').writeToFileAtomicallyEncodingError(stateFile, true, 4, null);
      // Activate only the process that owns the window: browser helpers share
      // the app's name, and activating one of those takes focus with no window.
      apps.forEach(function (p) { if (p.processIdentifier === found.kCGWindowOwnerPID) p.activateWithOptions(2); });
      return;
    }
    delay(0.05);
  }
}

function run(argv) {
  if (argv[0] === 'existing') return existing(argv[1]) ? 'ok' : 'none';
  if (argv[0] === 'new') fresh(argv[1], argv[2]);
}
