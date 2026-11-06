# glance

A headless browser that a person and a coding agent can both see from a terminal. It has no npm dependencies and is built for Alpine Linux under proot on Android, where Electron-based terminal browsers cannot run.

- **Agents** save a page as a PNG with `glance shot`, open that file, and act with `click`, `scroll` and `type`.
- **People** watch the same tab live with `glance view`, or print a real picture with `glance image`.

Both look at the same browser tab, so you can watch what the agent is doing.

## Install

On Alpine Linux, including Acode's terminal on Android:

```sh
apk add git nodejs chromium mesa-egl mesa-gl mesa-dri-gallium
git clone https://github.com/ankitc1010/glance.git
ln -s "$PWD/glance/bin/glance.mjs" /usr/local/bin/glance
glance status
```

There is no build step. See the [installation guide](docs/install.md) for the full steps, checks, updating and removal.

## Use

```sh
glance open example.com   # go to a page; the browser starts on first use
glance scroll 300         # scroll down
glance click --text More  # click something by its words
glance shot               # save a PNG and print its path
glance log                # console errors and failed requests
glance view               # watch live: run this in a second terminal tab
glance stop               # close the browser and free the memory
```

Heavy WebGL sites need longer to settle, for example `glance open immersive-g.com --wait 12000`.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Installation](docs/install.md) | Setting up, checking it works, updating and removing |
| [Commands](docs/commands.md) | Every command, option and setting, with its output |
| [Watching in a terminal](docs/watching.md) | Live view, coloured blocks, real pictures, and using them inside Claude Code |
| [Using with an agent](docs/agents.md) | The agent workflow and a snippet for `CLAUDE.md` |
| [How it works](docs/how-it-works.md) | Architecture, source layout, tests and why it was built this way |
| [Troubleshooting](docs/troubleshooting.md) | Common errors and how to fix them |
| [`/preview` mod](claude-code/glance-preview/README.md) | An experimental panel inside Claude Code |

## What has been tested

Everything ran on Alpine 3.21 under proot on one Android 15 phone, with Node 22 and Chromium 136.

| Part | How it was tested | Not yet confirmed |
| --- | --- | --- |
| Browser commands | Automated tests against real Chromium, and a manual run of every command | Other Linux systems |
| WebGL | Automated tests, and immersive-g.com rendered on Mesa llvmpipe | Other devices |
| `glance view` | Driven through a real pseudo-terminal | Acode's screen |
| `glance image` | Drawn by xterm.js 5.5 with its image addon, the library Acode uses | Acode's own build |
| `glance image --tty` | Reaches a parent's terminal in a pseudo-terminal test | How long the picture lasts under Claude Code's redraws |
| [`/preview` mod](claude-code/glance-preview/README.md) | Its own unit tests | It has never run on a real Claude Code screen |
| [Installation guide](docs/install.md) | Package list compared with an empty Alpine system, and steps 3 and 4 run on a clean clone | A start-to-finish install on a new phone |

## Limits

- **No sandbox.** proot cannot provide Chromium's sandbox, so it runs with `--no-sandbox`. Stick to sites you trust, and avoid logging in to real accounts. Cookies persist in `~/.glance/profile`.
- **Software rendering.** WebGL runs on the CPU. Heavy pages take tens of seconds to load, and some sites may pick lower-quality assets.
- **Coarse block picture.** Half blocks give one column and two pixel rows per cell, so small text is unreadable in `view` and `show`. PNGs from `shot` are full resolution, and `glance image` prints a real picture in terminals that support it.
- **Viewer speed.** About 3 frames per second on a heavy WebGL page at 100 by 40 cells on a Dimensity 9400 phone.
- **One tab.** Links that open a new tab are not followed.
- **Missing glyphs.** Characters with no installed fallback font show as boxes. Add fonts with `apk add font-noto` if that matters.
- **Memory.** A heavy WebGL page used about 1.3 GB on the test phone. Run `glance stop` when you finish.
