# How glance works

```
glance CLI ─── unix socket ───> daemon ─── pipe (CDP) ───> headless Chromium
glance view <── PNG frames ─────┘                           WebGL on Mesa llvmpipe
```

- **CLI.** Each `glance` command is a short-lived process that sends one request to the daemon and prints the answer.
- **Daemon.** A background Node process that owns Chromium. It holds the one browser tab, so page state, viewport and logs survive between commands.
- **Chromium.** Runs headless and is driven with the Chrome DevTools Protocol.

## Source layout

| Path | Purpose |
| --- | --- |
| `bin/glance.mjs` | Entry point |
| `src/cli.mjs` | Parses arguments and runs commands |
| `src/common.mjs` | State paths and the request to the daemon |
| `src/daemon.mjs` | Starts Chromium and implements the browser commands |
| `src/cdp.mjs` | DevTools Protocol client over a pipe |
| `src/view.mjs` | The live terminal viewer |
| `src/render.mjs` | Turns images into terminal output |
| `src/png.mjs` | A small PNG decoder |
| `test/` | Unit and end-to-end tests |
| `claude-code/glance-preview/` | The experimental `/preview` mod |

## Key decisions

### No network ports

Chromium is driven over `--remote-debugging-pipe`, and the daemon listens on a unix socket with mode 600. Neither opens a port, because other apps on an Android phone can reach loopback ports. A debugging port would let them control the browser.

### WebGL on Mesa llvmpipe

WebGL runs through ANGLE on Mesa's software renderer, using `--use-angle=gl-egl` with `LIBGL_ALWAYS_SOFTWARE=1` and `EGL_PLATFORM=surfaceless`. There is no usable GPU inside proot.

Chromium's SwiftShader and Mesa's lavapipe both passed on simple test pages, then crashed the GPU process on real sites. That's why testing needs a real heavy site, not only a test page.

### No sandbox

proot cannot provide Chromium's sandbox, so `--no-sandbox` is required. This is why the docs warn against logging in to real accounts.

### No npm dependencies

Installing should only need `git clone`. The DevTools client and the PNG decoder are small enough to write by hand, and the viewer has to decode PNG frames anyway.

### Why not an existing terminal browser

[terminal-browser](https://github.com/zenbu-labs/terminal-browser) inspired this project but can't run here. It's a glibc Electron app, Alpine uses musl, and it needs kitty graphics, which Acode's terminal doesn't have.

## Drawing in a terminal

### Half blocks

`▀` lets one cell show two pixels: the foreground colour is the top pixel and the background is the bottom one. `Screen` in `src/render.mjs` remembers what's on screen and only sends the cells that changed.

### Live frames

`glance view` uses Chromium's screencast. The daemon only acknowledges a frame after the viewer's socket has taken it, so a slow terminal slows the screencast down instead of building up a queue.

### Real pictures

`glance image` sends the PNG with the iTerm2 protocol:

```
ESC ] 1337 ; File=inline=1;size=<bytes>;width=100%;preserveAspectRatio=1 : <base64> BEL
```

`--tty` wraps this in cursor save (`ESC 7`), move to the top corner (`ESC [ H`) and cursor restore (`ESC 8`). The restore matters because full-screen programs track the cursor, and a picture would otherwise shift everything they draw afterwards.

The terminal has to be found by hand because Claude Code runs commands without a controlling terminal and captures their output, so `/dev/tty` isn't available. Instead, glance walks up its parent processes through `/proc` until one has a terminal as its standard output, and writes there.

## Tests

```sh
npm test
```

| File | Covers |
| --- | --- |
| `test/unit.test.mjs` | PNG decoding and terminal output, with no browser |
| `test/e2e.test.mjs` | Commands against a real browser, with a temporary state folder |
| `test/pty_drive.py` | `glance view` in a real pseudo-terminal: keys, mouse, resize and quitting |
| `test/pty_image.py` | `glance image --tty` with captured output and a terminal only on a parent |

The two Python drivers are run by the end-to-end tests.
