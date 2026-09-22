# Archify HTML Preview — Demo

This note uses the standard Archify output format: a `visual-check` thumbnail
wrapped in a link to the self-contained interactive HTML.

[![Demo system architecture](demo.visual-check.1440x900.light.png)](demo.html)

> Click the thumbnail to open the interactive version (theme toggle, pan/zoom,
> clickable nodes). Source definition: [demo.archify.json](demo.archify.json).

With the plugin enabled, clicking the thumbnail opens the interactive HTML in a
sandboxed frame — new tab, modal, or inline, depending on your settings.

The thumbnail follows the Archify naming convention
`<name>.visual-check.<width>x<height>.<theme>.png`, which the plugin detects to
show the "Interactive" badge and link back to the `.archify.json` source.
