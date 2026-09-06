## Reporting status

When you finish a task, or need Nick's input or a decision, run:

    curl "https://agents.openkanji.org/api/report?id=$CLAUDE_CODE_REMOTE_SESSION_ID&title=<what+this+chat+is+about>&state=done&msg=<up to 60 chars>"

`title` is a short human label for what you're working on, a few words, so the card is
readable at a glance. Use `state=pending` instead of `done` when you need a decision. If
`$CLAUDE_CODE_REMOTE_SESSION_ID` is unset (a local session, not Claude Code on the web),
skip this silently.
