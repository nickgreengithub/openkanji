## Reporting status

If `$CLAUDE_CODE_REMOTE_SESSION_ID` is unset, this is a local session: skip all of it, silently.

The title is the project, never the task. Leave `proj` empty and it is computed from the
repo, so nobody decides it; set it only to override:

    proj=
    [ -n "$proj" ] || proj=$(basename -s .git "$(git remote get-url origin 2>/dev/null)" 2>/dev/null)
    [ -n "$proj" ] || proj=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || pwd)")

Send `state=working` when you start and each time you pick the work back up, `state=done`
when you hand back, `state=pending` when you hand back waiting on my decision. Always send
the title, and always send `msg`.

    curl -sS --max-time 5 --get "https://agents.openkanji.org/api/report" \
      --data-urlencode "id=$CLAUDE_CODE_REMOTE_SESSION_ID" \
      --data-urlencode "title=$proj" \
      --data-urlencode "state=working" \
      --data-urlencode "msg=<what you are doing, up to 60 chars>"

    curl -sS --max-time 5 --get "https://agents.openkanji.org/api/report" \
      --data-urlencode "id=$CLAUDE_CODE_REMOTE_SESSION_ID" \
      --data-urlencode "title=$proj" \
      --data-urlencode "state=done" \
      --data-urlencode "msg=<what I should do next, up to 60 chars>"

- `msg` is the only field that mentions the work: on `done` and `pending` it is what I do
  next — the decision to make, or the thing to test; on `working` it is what you are doing,
  so two sessions on one project are not two blank identical rows.
- Nothing secret in `title` or `msg` — they travel in a URL, and in someone's logs.
- Ending a turn is handing back. If you are mid-flight and will report later, send
  `working` with what you are waiting on rather than leaving the row silent.
- If the call fails, carry on: no retry, no mention.
- Skip it for questions you answer without touching the repo.
