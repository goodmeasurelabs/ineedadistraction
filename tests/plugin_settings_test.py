"""Isolated preference/control tests. No real account, network, or app access."""

import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import URLError

SCRIPT = Path(__file__).resolve().parents[1] / "plugin/scripts/settings.py"
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("inad_settings", SCRIPT)
settings = importlib.util.module_from_spec(spec)
spec.loader.exec_module(settings)


class Service:
    def __init__(self):
        self.state = {"settings": None, "revision": 0, "appliedRevision": 0}
        self.latest = None
        self.requests = []

    def request(self, pairing, body=None, path="settings"):
        self.requests.append(copy.deepcopy(body))
        if path == "agent":
            return 200, {"attached": True}
        if body is None:
            return 200, copy.deepcopy(self.state)
        action = body["action"]
        if action == "initialize" and self.state["settings"] is None:
            self.state.update(settings=body["settings"], revision=1, appliedRevision=1)
        elif action == "update":
            if self.latest and self.latest["mutationId"] == body["mutationId"]:
                return (200 if self.latest == body else 409), copy.deepcopy(self.state)
            if body["expectedRevision"] != self.state["revision"]:
                return 409, copy.deepcopy(self.state)
            self.state.update(settings=body["settings"], revision=self.state["revision"] + 1)
            self.latest = copy.deepcopy(body)
        elif action == "ack":
            if body["revision"] != self.state["revision"]:
                return 409, copy.deepcopy(self.state)
            self.state["appliedRevision"] = body["revision"]
        return 200, copy.deepcopy(self.state)


class SettingsTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="inad-control-test-")
        self.root = Path(self.temp.name)
        self.root_patch = patch.object(settings, "ROOT", self.root)
        self.root_patch.start()
        self.service = Service()
        self.request_patch = patch.object(settings, "request", self.service.request)
        self.request_patch.start()

    def tearDown(self):
        self.request_patch.stop()
        self.root_patch.stop()
        self.temp.cleanup()

    def change(self, fields):
        with settings.lock("settings.lock"):
            settings.queue_patch(settings.load(), fields)

    def cli(self, *arguments):
        output = io.StringIO()
        with patch("sys.argv", [str(SCRIPT), *arguments]), contextlib.redirect_stdout(output):
            code = settings.main()
        return code, json.loads(output.getvalue()) if output.getvalue() else None

    def test_invalid_preferences_do_not_create_a_configuration(self):
        for change in ({"enabled": "false"}, {"version": True}, {"categories": []}, {"categories": ["math", "math"]}, {"categories": ["shell"]}, {"pace": "fast"}, {"command": "run"}):
            with self.assertRaises(ValueError):
                settings.preferences({**settings.DEFAULTS, **change})
        self.assertFalse((self.root / "settings.json").exists())

    def test_off_and_no_auto_open_migrate_without_losing_user_intent(self):
        (self.root / "no-auto-open").touch()
        self.assertFalse(settings.local()["settings"]["enabled"])
        self.assertTrue((self.root / "off").exists())
        self.assertFalse((self.root / "no-auto-open").exists())
        self.assertTrue(settings.sync_once())
        self.assertFalse(self.service.state["settings"]["enabled"])
        code, output = self.cli("on")
        self.assertEqual(code, 0)
        self.assertTrue(output["synced"])
        self.assertTrue(output["settings"]["enabled"])
        self.assertFalse((self.root / "off").exists())

    def test_offline_stop_is_immediate_and_rebases_without_losing_browser_preferences(self):
        self.assertTrue(settings.sync_once())
        with patch.object(settings, "request", side_effect=URLError("offline")):
            code, output = self.cli("off")
        self.assertEqual(code, 0)
        self.assertFalse(output["settings"]["enabled"])
        self.assertFalse(output["synced"])
        self.assertTrue(output["pending"])
        self.assertTrue((self.root / "off").exists())
        self.service.state["settings"]["categories"] = ["math"]
        self.service.state["revision"] += 1
        self.assertTrue(settings.sync_once())
        effective = settings.local()["settings"]
        self.assertFalse(effective["enabled"])
        self.assertEqual(effective["categories"], ["math"])
        self.assertEqual(self.service.state["appliedRevision"], self.service.state["revision"])

    def test_lost_response_retries_exact_mutation_before_acknowledging(self):
        self.assertTrue(settings.sync_once())
        self.change({"pace": "untimed"})
        first = True

        def dropped(pairing, body=None, path="settings"):
            nonlocal first
            response = self.service.request(pairing, body, path)
            if body and body["action"] == "update" and first:
                first = False
                raise URLError("response lost after commit")
            return response

        with patch.object(settings, "request", dropped), self.assertRaises(URLError):
            settings.sync_once()
        committed = self.service.state["revision"]
        self.assertTrue(settings.local()["pending"]["attempt"])
        self.assertTrue(settings.sync_once())
        updates = [body for body in self.service.requests if body and body["action"] == "update"]
        self.assertEqual(updates[-2], updates[-1])
        self.assertEqual(self.service.state["revision"], committed)
        self.assertIsNone(settings.local()["pending"])

    def test_new_local_off_during_network_cannot_be_overwritten_by_older_response(self):
        self.assertTrue(settings.sync_once())
        self.change({"categories": ["math"]})
        first = True

        def interrupted(pairing, body=None, path="settings"):
            nonlocal first
            response = self.service.request(pairing, body, path)
            if body and body["action"] == "update" and first:
                first = False
                self.change({"enabled": False})
            return response

        with patch.object(settings, "request", interrupted):
            self.assertFalse(settings.sync_once())
        self.assertFalse(settings.local()["settings"]["enabled"])
        self.assertTrue(settings.local()["pending"])
        self.assertTrue(settings.sync_once())
        self.assertFalse(self.service.state["settings"]["enabled"])
        self.assertEqual(self.service.state["settings"]["categories"], ["math"])

    def test_lost_enable_response_cannot_override_a_newer_browser_stop(self):
        self.assertTrue(settings.sync_once())
        self.change({"enabled": False})
        self.assertTrue(settings.sync_once())
        self.change({"enabled": True, "categories": ["math"]})

        def dropped(pairing, body=None, path="settings"):
            response = self.service.request(pairing, body, path)
            if body and body["action"] == "update":
                raise URLError("enable response lost after commit")
            return response

        with patch.object(settings, "request", dropped), self.assertRaises(URLError):
            settings.sync_once()
        self.assertTrue(self.service.state["settings"]["enabled"])
        self.service.request("test", {"action": "update", "settings": {**self.service.state["settings"], "enabled": False}, "expectedRevision": self.service.state["revision"], "mutationId": "newer-browser-off"})
        self.assertFalse(settings.sync_once())
        self.assertFalse(settings.local()["settings"]["enabled"])
        self.assertIn("newer saved Off setting", settings.local()["notice"])
        self.assertTrue(settings.sync_once())
        self.assertFalse(self.service.state["settings"]["enabled"])
        self.assertEqual(self.service.state["settings"]["categories"], ["math"])
        code, output = self.cli("on")
        self.assertEqual(code, 0)
        self.assertTrue(output["synced"])
        self.assertTrue(output["settings"]["enabled"])
        self.assertNotIn("notice", settings.local())

    def test_browser_revision_conflict_preserves_patch_until_next_sync(self):
        self.assertTrue(settings.sync_once())
        self.change({"sound": True})
        first = True

        def conflict(pairing, body=None, path="settings"):
            nonlocal first
            if body and body["action"] == "update" and first:
                first = False
                self.service.state["settings"]["categories"] = ["logic"]
                self.service.state["revision"] += 1
            return self.service.request(pairing, body, path)

        with patch.object(settings, "request", conflict):
            self.assertFalse(settings.sync_once())
        self.assertTrue(settings.sync_once())
        self.assertEqual(settings.local()["settings"]["categories"], ["logic"])
        self.assertTrue(settings.local()["settings"]["sound"])

    def test_invalid_remote_settings_are_not_applied_or_acknowledged(self):
        self.change({"enabled": False})
        with patch.object(settings, "request", return_value=(200, {"settings": {**settings.DEFAULTS, "enabled": "yes"}, "revision": 9})), self.assertRaises(ValueError):
            settings.sync_once()
        self.assertFalse(settings.local()["settings"]["enabled"])
        self.assertTrue((self.root / "off").exists())

    def test_corrupt_local_settings_fail_closed(self):
        (self.root / "settings.json").write_text("broken")
        with self.assertRaisesRegex(ValueError, "damaged"):
            settings.local()
        self.assertTrue((self.root / "off").exists())

    def test_listener_can_receive_on_while_off_and_return_is_disabled(self):
        self.change({"enabled": False})
        self.assertTrue(settings.sync_once())
        (self.root / "no-return").touch()
        clock = [100.0]
        ticks = [0]

        def sleep(_):
            ticks[0] += 1
            clock[0] += 3
            if ticks[0] == 1:
                self.service.state["settings"]["enabled"] = True
                self.service.state["revision"] += 1
            if ticks[0] == 3:
                (self.root / "token").unlink()

        with patch.object(settings.time, "monotonic", side_effect=lambda: clock[0]), patch.object(settings.time, "sleep", sleep), patch.object(settings.subprocess, "Popen") as opener:
            settings.listen()
        opener.assert_not_called()
        self.assertTrue(settings.local()["settings"]["enabled"])
        self.assertFalse((self.root / "off").exists())
        self.assertEqual(self.service.state["appliedRevision"], self.service.state["revision"])

    def test_listener_exits_after_five_minutes_without_a_browser(self):
        self.assertTrue(settings.sync_once())
        clock = [100.0]

        def detached(pairing, body=None, path="settings"):
            return (200, {"attached": False}) if path == "agent" else self.service.request(pairing, body, path)

        def sleep(_):
            clock[0] += 30

        with patch.object(settings.time, "monotonic", side_effect=lambda: clock[0]), patch.object(settings.time, "sleep", sleep), patch.object(settings, "request", detached), patch.object(settings.subprocess, "Popen"):
            settings.listen()
        self.assertEqual(clock[0], 400)

    def test_cli_changes_only_requested_fields_and_prints_no_pairing_secret(self):
        self.assertTrue(settings.sync_once())
        code, output = self.cli("set", "--categories", "math,logic", "--pace", "untimed", "--sound", "false")
        self.assertEqual(code, 0)
        self.assertEqual(output["settings"]["categories"], ["logic", "math"])
        self.assertTrue(output["settings"]["enabled"])
        self.assertTrue(output["synced"])
        self.assertNotIn((self.root / "token").read_text(), json.dumps(output))

    def test_automatic_open_respects_off_and_print_uses_separate_arcade_route(self):
        self.change({"enabled": False})
        (self.root / "token").write_text("isolated-test-pairing-token")
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        for command in ("nohup", "open", "xdg-open", "osascript"):
            file = bin_dir / command
            file.write_text('#!/bin/sh\nprintf "%s\\n" "${0##*/}" >> "$INAD_HOME/calls"\n')
            file.chmod(0o755)
        env = {**os.environ, "INAD_HOME": str(self.root), "INAD_URL": "http://127.0.0.1:1", "PATH": str(bin_dir) + ":" + os.environ["PATH"]}
        result = subprocess.run(["/bin/sh", str(SCRIPT.with_name("open.sh")), "--background"], env=env, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0)
        calls = (self.root / "calls").read_text() if (self.root / "calls").exists() else ""
        self.assertNotIn("open\n", calls)
        result = subprocess.run(["/bin/sh", str(SCRIPT.with_name("open.sh")), "--print"], env=env, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.stdout, "http://127.0.0.1:1/arcade#t=isolated-test-pairing-token\n")

    def test_configured_off_survives_new_hooks_while_status_stays_current(self):
        self.change({"enabled": False})
        (self.root / "token").write_text("isolated-test-pairing-token")
        (self.root / "no-return").touch()
        bin_dir = self.root / "bin"
        bin_dir.mkdir()
        stubs = {
            "nohup": '#!/bin/sh\nexit 0\n',
            "uname": '#!/bin/sh\nprintf Darwin\n',
            "sh": '#!/bin/sh\ncase "$1" in */open.sh) touch "$INAD_HOME/unexpected-open"; exit 0 ;; esac\ncase "$2" in --send|--listen) exit 0 ;; esac\nexec /bin/sh "$@"\n',
        }
        for name, text in stubs.items():
            file = bin_dir / name
            file.write_text(text)
            file.chmod(0o755)
        env = {"INAD_HOME": str(self.root), "INAD_URL": "http://127.0.0.1:1", "PATH": str(bin_dir) + ":" + os.environ["PATH"]}
        for state, reason, hook in [("working", "prompt", "UserPromptSubmit"), ("waiting", "done", "Stop"), ("working", "prompt", "UserPromptSubmit")]:
            result = subprocess.run(["/bin/sh", str(SCRIPT.with_name("state.sh")), state, reason, "codex"], input=json.dumps({"hook_event_name": hook, "session_id": "isolated-session"}), env=env, capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((self.root / "last").read_text(), state + " " + reason + " codex")
            self.assertTrue((self.root / "off").exists())
        self.assertFalse((self.root / "unexpected-open").exists())
        self.assertFalse(settings.local()["settings"]["enabled"])


if __name__ == "__main__":
    unittest.main()
