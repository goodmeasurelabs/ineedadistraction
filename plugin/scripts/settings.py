#!/usr/bin/env python3
"""Durable distraction preferences and the browser's acknowledged control channel.

Only fixed settings fields cross this channel. It never executes remote commands.
Local changes take effect before networking and remain queued while offline.
"""

import argparse
import copy
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
from contextlib import contextmanager
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

PLUGIN_VERSION = "0.5.1"
CATEGORIES = ("merge", "logic", "math", "arcade", "words", "memory")
DEFAULTS = {"version": 1, "enabled": True, "categories": list(CATEGORIES[:4]), "pace": "any", "sound": False}
ROOT = Path(os.environ.get("INAD_HOME", str(Path.home() / ".config/ineedadistraction")))
BASE = os.environ.get("INAD_URL", "https://www.ineedadistraction.com").rstrip("/")
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{20,64}$")


def preferences(value):
    if not isinstance(value, dict) or set(value) != set(DEFAULTS):
        raise ValueError("Send only version, enabled, categories, pace and sound.")
    if type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("Unsupported settings version.")
    if type(value["enabled"]) is not bool or type(value["sound"]) is not bool:
        raise ValueError("Enabled and sound must be true or false.")
    cats = value["categories"]
    if not isinstance(cats, list) or not 1 <= len(cats) <= len(CATEGORIES) or any(type(c) is not str or c not in CATEGORIES for c in cats) or len(set(cats)) != len(cats):
        raise ValueError("Choose one or more distinct categories: " + ", ".join(CATEGORIES))
    if value["pace"] not in ("any", "untimed"):
        raise ValueError("Pace must be any or untimed.")
    return {**value, "categories": [c for c in CATEGORIES if c in cats]}


def atomic(path, value):
    temporary = path.with_name(path.name + "." + secrets.token_hex(6))
    try:
        with temporary.open("w", encoding="utf-8") as handle:
            os.chmod(temporary, 0o600)
            json.dump(value, handle, separators=(",", ":"))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def lock(name, blocking=True):
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (ROOT / name).open("a") as handle:
        os.chmod(ROOT / name, 0o600)
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        except BlockingIOError:
            yield False
            return
        try:
            yield True
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def mirror(record):
    # Legacy hook scripts can enforce Off without starting Python or networking.
    if record["settings"]["enabled"]:
        (ROOT / "off").unlink(missing_ok=True)
    else:
        (ROOT / "off").touch(mode=0o600)


def persist(record):
    atomic(ROOT / "settings.json", record)
    mirror(record)


def queue_patch(record, patch):
    pending = record.get("pending") or {}
    changes = {**pending.get("patch", {}), **patch}
    record["settings"] = preferences({**record["settings"], **patch})
    record["pending"] = {"patch": changes, "mutationId": secrets.token_hex(16), "baseRevision": record["revision"]}
    record.pop("notice", None)
    record["generation"] = secrets.token_hex(12)
    persist(record)
    return record


def load():
    """Called with settings.lock held. Never turn a damaged configuration on."""
    path = ROOT / "settings.json"
    if path.exists():
        try:
            record = json.loads(path.read_text(encoding="utf-8"))
            record["settings"] = preferences(record["settings"])
            if type(record.get("revision")) is not int or record["revision"] < 0 or not isinstance(record.get("generation"), str):
                raise ValueError("Invalid local revision.")
            pending = record.get("pending")
            if pending is not None:
                if not isinstance(pending, dict) or not isinstance(pending.get("patch"), dict) or not isinstance(pending.get("mutationId"), str):
                    raise ValueError("Invalid pending settings.")
                preferences({**record["settings"], **pending["patch"]})
        except (OSError, KeyError, TypeError, ValueError) as error:
            (ROOT / "off").touch(mode=0o600)
            raise ValueError("Local distraction settings are damaged. Distractions are off; restore settings.json before continuing.") from error
    else:
        record = {"settings": copy.deepcopy(DEFAULTS), "revision": 0, "generation": secrets.token_hex(12), "pending": None}
    # Preserve old off/no-auto-open intent, including an older agent's command.
    legacy_off = (ROOT / "off").exists() or (ROOT / "no-auto-open").exists()
    if legacy_off and record["settings"]["enabled"]:
        queue_patch(record, {"enabled": False})
    elif not path.exists():
        persist(record)
    else:
        mirror(record)
    # The migrated preference now owns this behavior. Explicit On can undo it.
    (ROOT / "no-auto-open").unlink(missing_ok=True)
    return record


def token():
    path = ROOT / "token"
    value = path.read_text().strip() if path.exists() else ""
    if not value:
        value = secrets.token_hex(16)
        # Keep the existing plain token file contract, with exclusive creation.
        try:
            with path.open("x") as handle:
                os.chmod(path, 0o600)
                handle.write(value)
        except FileExistsError:
            value = path.read_text().strip()
    if not TOKEN_PATTERN.fullmatch(value):
        raise ValueError("The pairing token is invalid. Pair this computer again.")
    return value


def request(pairing, body=None, path="settings"):
    parsed = urlparse(BASE)
    if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1", "::1")):
        raise ValueError("Use HTTPS for the distraction service, or HTTP on localhost for development.")
    url = BASE + "/api/agent/" + pairing + ("/settings" if path == "settings" else "?peek=1")
    data = json.dumps(body, separators=(",", ":")).encode() if body is not None else None
    req = Request(url, data=data, headers={"Content-Type": "application/json", "User-Agent": "inad-plugin/" + PLUGIN_VERSION})
    try:
        with urlopen(req, timeout=4) as response:
            raw = response.read(65537)
            status = response.status
    except HTTPError as error:
        raw = error.read(65537)
        status = error.code
    if len(raw) > 65536:
        raise ValueError("The settings service returned an oversized response.")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("The settings service returned an invalid response.")
    if status not in (200, 201, 409):
        raise ValueError("The settings service could not complete the request (HTTP %s)." % status)
    return status, payload


def snapshot(payload):
    value = payload.get("settings")
    revision = payload.get("revision")
    if type(revision) is not int or revision < 0:
        raise ValueError("The settings service returned an invalid revision.")
    if value is not None:
        value = preferences(value)
        if revision < 1:
            raise ValueError("The settings service returned an invalid revision.")
    return value, revision


def local():
    with lock("settings.lock"):
        return copy.deepcopy(load())


def reject_stale_enable(record, effective, revision):
    """A queued/retried On cannot undo a newer explicit browser Stop.

    Other preferences can still rebase. Once the newer Off has been observed,
    a fresh explicit On is based on its revision and may enable normally.
    """
    pending = record.get("pending")
    if not pending or pending["patch"].get("enabled") is not True or effective["enabled"] or revision <= pending.get("baseRevision", record["revision"]):
        return False
    with lock("settings.lock"):
        current = load()
        if current["generation"] != record["generation"]:
            return True
        remaining = {key: value for key, value in pending["patch"].items() if key != "enabled"}
        current["settings"] = preferences({**effective, **remaining})
        current["revision"] = revision
        current["pending"] = {"patch": remaining, "mutationId": secrets.token_hex(16), "baseRevision": revision} if remaining else None
        current["notice"] = "A newer saved Off setting kept distractions off. Run settings.py on again only if you want to turn them back on."
        persist(current)
    return True


def sync_once(heartbeat=True):
    """One serialized sync; local user edits never wait for network requests."""
    with lock("settings-sync.lock", blocking=False) as acquired:
        if not acquired:
            return False
        with lock("settings.lock"):
            record = copy.deepcopy(load())
            pairing = token()
        generation = record["generation"]
        pending = record.get("pending")
        attempt = pending.get("attempt") if pending else None
        if attempt:
            status, remote = request(pairing, attempt)
        else:
            status, remote = request(pairing)
        effective, revision = snapshot(remote)
        if effective is None:
            status, remote = request(pairing, {"action": "initialize", "settings": record["settings"], "pluginVersion": PLUGIN_VERSION})
            effective, revision = snapshot(remote)
        if effective is None:
            raise ValueError("The settings service did not initialize this pairing.")
        if reject_stale_enable(record, effective, revision):
            return False

        if pending and (not attempt or status == 409):
            # A confirmed revision conflict is safe to rebase. A lost response
            # retries the exact persisted request/id before reaching this branch.
            desired = preferences({**effective, **pending["patch"]})
            mutation = secrets.token_hex(16) if attempt else pending["mutationId"]
            attempt = {"action": "update", "settings": desired, "expectedRevision": revision, "mutationId": mutation}
            with lock("settings.lock"):
                current = load()
                if current["generation"] != generation:
                    return False
                current["pending"]["attempt"] = attempt
                current["pending"]["mutationId"] = mutation
                persist(current)
            status, remote = request(pairing, attempt)
            effective, revision = snapshot(remote)
            if status == 409:
                if effective is not None:
                    reject_stale_enable(record, effective, revision)
                return False

        if effective is None:
            raise ValueError("The settings service returned no effective settings.")
        with lock("settings.lock"):
            current = load()
            if current["generation"] != generation or (ROOT / "token").read_text().strip() != pairing:
                return False
            changed = current["revision"] != revision
            current.update(settings=effective, revision=revision, pending=None)
            persist(current)
        if heartbeat or changed:
            status, _ = request(pairing, {"action": "ack", "revision": revision, "pluginVersion": PLUGIN_VERSION})
            return status == 200
        return True


def listen():
    # A separate lock/process from return-to-agent: Off and no-return cannot
    # disable the very control path needed to turn distractions on again.
    with lock("settings-listener.lock", blocking=False) as acquired:
        if not acquired:
            return
        with lock("settings.lock"):
            load()
            pairing = token()
        last_attached = time.monotonic()
        last_heartbeat = 0
        was_enabled = False
        while (ROOT / "token").exists() and (ROOT / "token").read_text().strip() == pairing:
            now = time.monotonic()
            heartbeat = now - last_heartbeat >= 15
            try:
                if sync_once(heartbeat=heartbeat) and heartbeat:
                    last_heartbeat = now
                enabled = local()["settings"]["enabled"]
                if enabled and not was_enabled and sys.platform == "darwin" and not (ROOT / "no-return").exists():
                    subprocess.Popen(["/bin/sh", str(Path(__file__).with_name("state.sh")), "--listen"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
                was_enabled = enabled
                if heartbeat:
                    _, agent = request(pairing, path="agent")
                    if agent.get("attached") is True:
                        last_attached = now
            except (OSError, ValueError, URLError):
                pass  # Keep local intent and retry; the UI reports stale health.
            wake = ROOT / "settings-wake"
            if wake.exists() and time.time() - wake.stat().st_mtime < 30:
                last_attached = now
            if now - last_attached >= 300:
                return
            time.sleep(3)


def boolean(value):
    if value not in ("true", "false"):
        raise argparse.ArgumentTypeError("Use true or false.")
    return value == "true"


def main():
    parser = argparse.ArgumentParser(description="Control I Need a Distraction on this computer.")
    parser.add_argument("command", choices=("set", "on", "off", "show", "local", "sync", "listen", "is-enabled"))
    parser.add_argument("--enabled", type=boolean)
    parser.add_argument("--categories")
    parser.add_argument("--pace", choices=("any", "untimed"))
    parser.add_argument("--sound", type=boolean)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == "listen":
        listen()
        return 0
    if args.command == "is-enabled":
        return 0 if local()["settings"]["enabled"] else 1
    if args.command in ("set", "on", "off"):
        patch = {key: getattr(args, key) for key in ("enabled", "pace", "sound") if getattr(args, key) is not None}
        if args.categories is not None:
            patch["categories"] = args.categories.split(",")
        if args.command in ("on", "off"):
            patch["enabled"] = args.command == "on"
        if not patch:
            parser.error("Specify at least one setting to change.")
        with lock("settings.lock"):
            queue_patch(load(), patch)
        (ROOT / "settings-wake").touch(mode=0o600)
    synced = False
    note = None
    if args.command in ("set", "on", "off", "sync"):
        try:
            synced = sync_once()
        except (OSError, ValueError, URLError) as error:
            note = "Saved on this computer; synchronization is pending. " + (str(error) if isinstance(error, ValueError) else "Could not reach the settings service.")
    record = local()
    if record.get("notice"):
        note = record["notice"]
    if args.command != "local":
        print(json.dumps({"settings": record["settings"], "revision": record["revision"], "pending": record.get("pending") is not None, **({"synced": synced} if args.command != "show" else {}), **({"note": note} if note else {})}, separators=(",", ":")))
    return 2 if args.command == "sync" and not synced else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, URLError) as error:
        print("I Need a Distraction: " + str(error), file=sys.stderr)
        sys.exit(1)
