## Reporting status

One row per session, keyed on `$CLAUDE_CODE_REMOTE_SESSION_ID`. If it is unset (a local
session, not Claude Code on the web), skip all of this silently.

Once per session, name the session — what the whole conversation is about, not the step
you are on:

    curl -sS --get "https://agents.openkanji.org/api/report" \
      --data-urlencode "id=$CLAUDE_CODE_REMOTE_SESSION_ID" \
      --data-urlencode "title=<subject of this chat, a few words>" \
      --data-urlencode "state=working"

Then don't send `title` again. The subject of a session rarely changes; the step always
does, and a title that follows the step makes the list unreadable. If the conversation
genuinely turns to something else, retitle it then.

Whenever you hand back to me — finished, blocked, or asking — say so, and say what I
should do next:

    curl -sS --get "https://agents.openkanji.org/api/report" \
      --data-urlencode "id=$CLAUDE_CODE_REMOTE_SESSION_ID" \
      --data-urlencode "state=done" \
      --data-urlencode "msg=<what I should do next, up to 60 chars>"

Use `state=pending` rather than `done` when you are waiting on my decision, and
`state=working` (no title) when you pick the work back up after I answer.

- `msg` is for me: the decision to make, or the thing to test. Not a summary of what you did.
- Nothing secret in `title` or `msg` — they travel in a URL, and in someone's logs.
- If the call fails, carry on. Don't retry it, don't mention it.
- Skip it entirely for questions you answer without touching the repo.
