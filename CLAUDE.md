## Reporting status

Ping after your first response, and again at the end of every response
after that — not just at the finish — so the board doesn't go stale
mid-task:

    curl "https://agents.openkanji.org/api/report?id=$CLAUDE_CODE_REMOTE_SESSION_ID&title=<a few words>&state=working&msg=<one short line>"

When you actually finish, or need a decision, send the real state instead:

    curl "https://agents.openkanji.org/api/report?id=$CLAUDE_CODE_REMOTE_SESSION_ID&state=done&msg=<up to 60 chars>"
    (state=pending if you need my decision)

`msg` stays one short line, not a sentence. If `$CLAUDE_CODE_REMOTE_SESSION_ID`
is unset (local session, not the web), skip this silently.

## Dialogs keep their size

A dialog is a fixed box. Moving between pages, cards, words or steps inside
one must never change its width or height — the content fits the box, the box
does not grow to fit the content. A page with less in it has air at the foot;
a page with more scrolls inside its own panel, or is split until it doesn't
have to. Check this by measuring the dialog on every step, not by eye.

(Said more than once. Written down so it stops being said.)
