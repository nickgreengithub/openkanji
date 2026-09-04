#!/usr/bin/env python3
"""Claude Code hook: report this session's state to the agent-status dashboard.

Wired for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, Notification,
Stop and SessionEnd (see settings.json alongside). Reads the hook JSON on stdin,
maps the event to a traffic-light state and POSTs it to $AGENT_STATUS_URL with
$AGENT_STATUS_TOKEN as a bearer token.

Rules it must never break:
  * never print to stdout (Claude Code would read it as hook output)
  * never exit non-zero (that would be reported in the session as an error)
  * never block for long (4 s network timeout; also run with "async": true)
  * do nothing at all when the two env vars are unset
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request

TIMEOUT_S = 4
HEARTBEAT_EVERY_S = 30
AWAITING_NOTIFICATIONS = {"permission_prompt", "agent_needs_input", "elicitation_dialog",
                          "elicitation_url_dialog"}
QUESTION_TOOLS = {"AskUserQuestion"}


def main():
    url = os.environ.get("AGENT_STATUS_URL")
    token = os.environ.get("AGENT_STATUS_TOKEN")
    if not url or not token:
        return
    try:
        event = json.load(sys.stdin)
    except Exception:
        return
    if not isinstance(event, dict):
        return

    sid, web_url = session_identity(event)
    if not sid:
        return
    payload = map_event(event, sid)
    if payload is None:
        return
    payload["id"] = sid
    if web_url:
        payload["url"] = web_url
    repo = repo_name(event.get("cwd"))
    if repo:
        payload["repo"] = repo
    post(url, token, payload)


def session_identity(event):
    """Prefer the cloud session id (stable, links to the web UI); fall back to the CLI id."""
    remote = os.environ.get("CLAUDE_CODE_REMOTE_SESSION_ID", "")
    if remote:
        rest = remote[4:] if remote.startswith("cse_") else remote
        return remote, "https://claude.ai/code/session_" + rest
    sid = event.get("session_id")
    return (sid if isinstance(sid, str) else None), None


def map_event(event, sid):
    name = event.get("hook_event_name")
    if name == "SessionStart":
        return {"state": "working"}
    if name == "UserPromptSubmit":
        out = {"state": "working"}
        prompt = event.get("prompt")
        if isinstance(prompt, str) and prompt.strip():
            out["title"] = " ".join(prompt.split())[:80]
        return out
    if name == "PreToolUse":
        if event.get("tool_name") in QUESTION_TOOLS:
            return {"state": "awaiting_input"}
        return {"state": "working"} if heartbeat_due(sid) else None
    if name == "PostToolUse":
        if event.get("tool_name") in QUESTION_TOOLS:
            return {"state": "working"}  # the question was answered
        return {"state": "working"} if heartbeat_due(sid) else None
    if name == "Notification":
        if event.get("notification_type") in AWAITING_NOTIFICATIONS:
            return {"state": "awaiting_input"}
        return None  # idle_prompt etc.: no state change
    if name == "Stop":
        out = {"state": "done"}
        msg = event.get("last_assistant_message")
        if isinstance(msg, str) and msg.strip():
            out["last_message"] = " ".join(msg.split())[-200:]
        return out
    if name == "SessionEnd":
        return {"state": "ended"}
    return None


def heartbeat_due(sid):
    """At most one 'working' heartbeat per HEARTBEAT_EVERY_S per session."""
    safe = "".join(c for c in sid if c.isalnum() or c in "_-")
    path = os.path.join(tempfile.gettempdir(), "agent-status-%s.ts" % safe)
    now = time.time()
    try:
        with open(path) as f:
            if now - float(f.read().strip() or 0) < HEARTBEAT_EVERY_S:
                return False
    except Exception:
        pass
    try:
        with open(path, "w") as f:
            f.write("%f" % now)
    except Exception:
        pass
    return True


def repo_name(cwd):
    if not cwd or not os.path.isdir(cwd):
        return None
    try:
        remote = subprocess.run(
            ["git", "-C", cwd, "remote", "get-url", "origin"],
            capture_output=True, text=True, timeout=2,
        ).stdout.strip()
        if remote:
            tail = remote.rstrip("/").removesuffix(".git")
            parts = tail.replace(":", "/").split("/")
            if len(parts) >= 2:
                return "/".join(parts[-2:])[:100]
    except Exception:
        pass
    return os.path.basename(cwd.rstrip("/"))[:100] or None


def post(url, token, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={"content-type": "application/json", "authorization": "Bearer " + token,
                 "user-agent": "agent-status-hook/1"},
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            resp.read()
    except Exception as e:  # network blocked, server down: stay silent
        if os.environ.get("AGENT_STATUS_DEBUG"):
            sys.stderr.write("agent-status: %s\n" % e)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        if os.environ.get("AGENT_STATUS_DEBUG"):
            sys.stderr.write("agent-status: %s\n" % e)
    sys.exit(0)
