## Reporting status

When you finish a task, or need Nick's input or a decision, run:

    curl "https://agents.openkanji.org/api/report?id=$CLAUDE_CODE_REMOTE_SESSION_ID&state=done&msg=<up to 30 chars>"

Use `state=pending` instead of `done` when you need a decision. If
`$CLAUDE_CODE_REMOTE_SESSION_ID` is unset (a local session, not Claude Code on the web),
skip this silently.
