# Watching in a terminal

| Command | You get | Live | Works inside Claude Code | Needs |
| --- | --- | --- | --- | --- |
| `glance view` | Coloured blocks with mouse and keyboard | Yes | No, use a second tab | 24-bit or 256 colour |
| `glance show` | One frame of coloured blocks | No | With `!`, unconfirmed | 24-bit or 256 colour |
| `glance image` | A real picture | No | No, use `--tty` | Image support |
| `glance image --tty` | A real picture over the screen | No | With `!`, unconfirmed | Image support |
| `glance shot` | A full-resolution PNG file | No | Yes | An image viewer |

The browser only has one tab, so all of these show the same page, including what an agent is doing.

## Live view: `glance view`

Run it in a second terminal tab, so that you can watch while an agent works in the first.

```sh
glance open example.com
glance view
```

| Key | Action |
| --- | --- |
| Up, Down | Scroll a little |
| PageUp, PageDown, Space | Scroll further |
| Mouse click, wheel, move | Passed to the page |
| `o` | Type a URL to open, Esc to cancel |
| `i` | Type into the page, until Esc |
| `r`, `b` | Reload, back |
| `q`, Ctrl+C | Quit the viewer, leaving the browser running |

Half blocks are coarse, so small text is unreadable. On a heavy page expect about 3 frames per second. To reduce the work, try a smaller size such as `glance view --cols 60 --rows 25`.

## One frame of blocks: `glance show`

```sh
glance show --cols 60 --rows 20
```

This prints plain coloured lines with no cursor movement, so it stays in your scrollback.

## Real pictures: `glance image`

This sends the picture to the terminal using the iTerm2 inline image protocol. In a terminal that doesn't support the protocol, nothing appears and there is no error.

**In Acode:** turn on **Settings → Terminal Settings → Image support**. It's off by default, and takes effect straight away. Acode's terminal is xterm.js with its image addon.

```sh
glance open example.com
glance image
```

`--width` sets the size of the captured frame in pixels, not its size on screen. The picture always fills the terminal's width, so a smaller frame is quicker to send but looks blurrier.

## Pictures inside Claude Code: `--tty`

Claude Code captures what `!` commands print, so a normal `glance image` never reaches the screen. Use `--tty`:

```
! glance open example.com
! glance image --tty
```

`--tty` writes straight to the terminal of the nearest parent process. It draws at the top of the screen and puts the cursor back, so Claude Code's own drawing stays aligned.

- The picture sits over the top of the chat.
- Claude Code wipes it from any rows it redraws. If it goes, run the command again.
- It still prints `Picture sent to the terminal` when Image support is off, because the terminal gives no reply to check.
- An agent can run the same command through its Bash tool to show you what it sees.

How long the picture lasts on a real Claude Code screen hasn't been confirmed. If it keeps disappearing, use `glance image` in a second tab instead.

Blocks also work inside Claude Code with `! glance show --cols 60 --rows 20`, though their colours haven't been confirmed there.

## A panel inside Claude Code

The experimental [`/preview` mod](../claude-code/glance-preview/README.md) draws blocks in a panel that refreshes about once a second. Claude Code's own picture element doesn't support Acode's terminal, so this panel uses blocks too.
