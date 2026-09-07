# Chapter covers

One image to a chapter, named for the set it belongs to, counting from zero:
`0.jpg` is chapter one, `1.jpg` is chapter two. `.jpg`, `.png` and `.webp` are
all read. The build copies whatever is here into `dist/covers/` and tells the
page which chapters have one; a chapter without an image gets the drawn plate
instead, and neither the reader nor the tests mind which it is.

Aim for 1200x750 (16:10) and something under 200KB -- the covers are fetched
one at a time, when a chapter is opened, so they never delay the page.

The prompts these were made from live in `docs/serial.md`, so a later chapter
can be drawn to match an earlier one.
