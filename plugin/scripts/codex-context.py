#!/usr/bin/env python3
"""Read Codex routing metadata locally; never retain prompts or answer text.

The transcript wrapper is a compatibility interface, not a stable Codex API.
Unknown evidence leaves questions pending and permission notifications enabled.
"""

import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time


CALL_ID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
TAIL_BYTES = 16 * 1024 * 1024
INPUT_BYTES = 1024 * 1024
OPEN_TAG = "<send_user_message_question_reply>"
CLOSE_TAG = "</send_user_message_question_reply>"
NATIVE_APPROVAL_TOOLS = {"Bash", "apply_patch", "exec_command"}


@contextlib.contextmanager
def locked(directory):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (directory / ".lock").open("a") as lock:
        deadline = time.monotonic() + 2
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise TimeoutError("question state is busy")
                time.sleep(0.02)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def write_marker(path, marker):
    descriptor, temporary = tempfile.mkstemp(prefix=".question-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as output:
            json.dump(marker, output, separators=(",", ":"))
            output.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_marker(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > INPUT_BYTES:
        raise ValueError("invalid question marker")
    marker = json.loads(path.read_text())
    call_id = marker.get("tool_use_id")
    count = marker.get("question_count")
    answered = marker.get("answered_indices", [])
    if (not isinstance(call_id, str) or not CALL_ID.fullmatch(call_id)
            or path.name != call_id + ".json"
            or type(count) is not int or not 1 <= count <= 100
            or not isinstance(answered, list)
            or any(type(index) is not int or not 0 <= index < count for index in answered)):
        raise ValueError("invalid question metadata")
    return {"tool_use_id": call_id, "question_count": count,
            "answered_indices": sorted(set(answered))}


def hook_input():
    raw = sys.stdin.buffer.read(INPUT_BYTES + 1)
    if len(raw) > INPUT_BYTES:
        raise ValueError("hook input too large")
    event = json.loads(raw)
    if not isinstance(event, dict):
        raise ValueError("invalid hook input")
    return event


def register(directory):
    event = hook_input()
    call_id = event.get("tool_use_id")
    questions = event.get("tool_input", {}).get("questions")
    if (not isinstance(call_id, str) or not CALL_ID.fullmatch(call_id)
            or not isinstance(questions, list) or not 1 <= len(questions) <= 100):
        raise ValueError("invalid question registration")
    with locked(directory):
        path = directory / (call_id + ".json")
        if path.exists():
            marker = read_marker(path)
            if marker["question_count"] != len(questions):
                raise ValueError("question count changed")
        else:
            marker = {"tool_use_id": call_id, "question_count": len(questions),
                      "answered_indices": []}
        write_marker(path, marker)


def transcript_records(path, strict=False):
    with path.open("rb") as source:
        source.seek(0, os.SEEK_END)
        size = source.tell()
        start = max(0, size - TAIL_BYTES)
        source.seek(start)
        data = source.read(TAIL_BYTES)
    if start:
        # The bounded tail may begin halfway through a JSON line.
        data = data.partition(b"\n")[2]
    for line in data.splitlines():
        try:
            event = json.loads(line)
        except (ValueError, UnicodeError, RecursionError):
            if strict:
                raise ValueError("unreadable transcript metadata") from None
            continue
        if isinstance(event, dict):
            yield event
        elif strict:
            raise ValueError("invalid transcript record")


def transcript_items(path):
    for event in transcript_records(path):
        if event.get("type") == "response_item":
            payload = event.get("payload")
            if isinstance(payload, dict):
                yield payload


def approval():
    """Choose a game notification, never an operation's approval decision.

    Human-only command/category overrides are not exposed by these hooks and
    may still require Codex's native approval prompt in automatic-review mode.
    MCP/app reviewers can override the turn setting, so always notify for them.
    """
    event = hook_input()
    if (event.get("hook_event_name") != "PermissionRequest"
            or event.get("tool_name") not in NATIVE_APPROVAL_TOOLS):
        return "notify"
    mode = event.get("permission_mode")
    if mode in ("dontAsk", "bypassPermissions"):
        return "automatic"
    if mode not in (None, "default", "acceptEdits", "plan"):
        return "notify"

    turn_id = event.get("turn_id")
    transcript = event.get("transcript_path")
    if not isinstance(turn_id, str) or not turn_id.strip():
        return "notify"
    if not isinstance(transcript, str) or not transcript.strip():
        return "notify"

    latest = None
    started_turn = None
    saw_start = False
    for record in transcript_records(Path(transcript), strict=True):
        payload = record.get("payload")
        if record.get("type") == "turn_context":
            # A malformed/newer context must replace rather than reveal an
            # older automatic context for this hook's stale turn.
            latest = payload if isinstance(payload, dict) else None
        elif record.get("type") == "event_msg" and isinstance(payload, dict):
            if payload.get("type") == "task_started":
                saw_start = True
                started_turn = payload.get("turn_id")
    if not latest or latest.get("turn_id") != turn_id:
        return "notify"
    if saw_start and started_turn != turn_id:
        return "notify"
    policy = latest.get("approval_policy")
    if policy == "never":
        return "automatic"
    if policy == "on-request" and latest.get("approvals_reviewer") == "auto_review":
        return "automatic"
    return "notify"


def reply_indices(payload):
    if payload.get("type") != "message" or payload.get("role") != "user":
        return
    content = payload.get("content")
    if not isinstance(content, list):
        return
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "input_text":
            continue
        text = block.get("text")
        if not isinstance(text, str):
            continue
        text = text.strip()
        if not (text.startswith(OPEN_TAG) and text.endswith(CLOSE_TAG)):
            continue
        try:
            replies = json.loads(text[len(OPEN_TAG):-len(CLOSE_TAG)])
        except (ValueError, RecursionError):
            continue
        if not isinstance(replies, list):
            continue
        for reply in replies:
            if (not isinstance(reply, dict) or not isinstance(reply.get("questionItemId"), str)
                    or not isinstance(reply.get("answer"), str)):
                continue
            try:
                identity = json.loads(reply["questionItemId"])
            except (ValueError, RecursionError):
                continue
            if (isinstance(identity, list) and len(identity) == 3
                    and identity[0] == "request_user_input_async"
                    and isinstance(identity[1], str) and CALL_ID.fullmatch(identity[1])
                    and type(identity[2]) is int):
                yield identity[1], identity[2]


def rejected_call(payload):
    if payload.get("type") not in ("function_call_output", "custom_tool_call_output"):
        return None
    output = payload.get("output")
    if isinstance(output, str):
        try:
            output = json.loads(output)
        except (ValueError, RecursionError):
            return None
    if isinstance(output, dict) and (output.get("accepted") is False or output.get("isError") is True):
        return payload.get("call_id")
    return None


def pending(directory, transcript):
    if not directory.exists():
        return False
    with locked(directory):
        markers = {}
        unknown = False
        for path in directory.iterdir():
            if path.name == ".lock":
                continue
            try:
                marker = read_marker(path)
                markers[marker["tool_use_id"]] = marker
            except (OSError, ValueError, TypeError, AttributeError, RecursionError):
                unknown = True
        if not markers:
            return unknown
        # An unavailable transcript must never resolve an outstanding question.
        for payload in transcript_items(transcript):
            rejected = rejected_call(payload)
            if isinstance(rejected, str) and rejected in markers:
                (directory / (rejected + ".json")).unlink()
                del markers[rejected]
            for call_id, index in reply_indices(payload):
                marker = markers.get(call_id)
                if marker and 0 <= index < marker["question_count"]:
                    marker["answered_indices"] = sorted(set(marker["answered_indices"]) | {index})
        for call_id, marker in markers.items():
            path = directory / (call_id + ".json")
            if len(marker["answered_indices"]) == marker["question_count"]:
                path.unlink()
            else:
                write_marker(path, marker)
                unknown = True
        return unknown


def main():
    os.umask(0o077)
    try:
        if len(sys.argv) == 2 and sys.argv[1] == "approval":
            print(approval())
            return 0
        if len(sys.argv) == 3 and sys.argv[1] == "register":
            register(Path(sys.argv[2]))
            return 0
        if len(sys.argv) == 4 and sys.argv[1] == "pending":
            print("pending" if pending(Path(sys.argv[2]), Path(sys.argv[3])) else "clear")
            return 0
    except (OSError, ValueError, TypeError, AttributeError, RecursionError):
        pass
    # No exception text: it could include a path or untrusted transcript content.
    if len(sys.argv) > 1 and sys.argv[1] == "pending":
        print("pending")
    elif len(sys.argv) > 1 and sys.argv[1] == "approval":
        print("notify")
    return 1


if __name__ == "__main__":
    sys.exit(main())
