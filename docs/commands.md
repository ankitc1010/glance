# Commands

Run `glance help` for a short version of this page.

## Basics

- **The browser starts on first use and stays open** until `glance stop`. Every command starts it if needed, except `stop`, `wait`, `help` and `raster`. That includes `status`.
- **There is one tab.** Its page, viewport and logs carry over between commands.
- **Output** is JSON unless a command says otherwise.
- **Errors** print `glance: <message>` on stderr and exit with code 1.

## Look

### `open <url> [--wait ms] [--timeout ms]`

Goes to a page. A URL with no scheme gets `https://`.

| Option | Default | Meaning |
| --- | --- | --- |
| `--wait` | 1500 | Extra time to wait after the page's load event. Use about 12000 for heavy WebGL sites |
| `--timeout` | 45000 | How long to wait for the load event |

```json
{ "title": "Immersive Garden", "url": "https://immersive-g.com/", "loaded": true, "seconds": 13.5, "errors": 0, "failedRequests": 0 }
```

`loaded` is `false` if the load event hadn't fired by the timeout. A page that can't be reached is an error.

### `shot [file] [--full] [--selector css]`

Saves a PNG and prints its path. With no file, it goes in `~/.glance/shots/shot-<time>.png`.

| Option | Meaning |
| --- | --- |
| `--full` | Capture the whole page, not just the viewport |
| `--selector css` | Capture one element |

```json
{ "file": "/root/.glance/shots/shot-1793986560824.png", "viewport": "1280x800" }
```

### `film <count> <everyMs> [dir]`

Saves a timed series of PNGs named `frame-000.png` onwards, for checking animations and loaders. Each frame's output includes its real time in milliseconds, because slow pages can miss the requested timing.

### `text [selector]`

Prints the visible text of the page or of one element as plain text. This is cheaper for an agent to read than a screenshot.

### `eval <js>`

Runs JavaScript in the page and prints the result. Promises are awaited, and the limit is 30 seconds. Strings print as plain text. A thrown error exits with code 1.

### `log [--clear] [-n count]`

Prints recent messages, 100 by default. The browser keeps the latest 500. `--clear` empties the list after printing.

| Level | Source |
| --- | --- |
| `log`, `warn`, `error` | Console messages, uncaught exceptions and browser log entries |
| `net` | Failed requests and responses with status 400 or above |
| `dialog` | `alert`, `confirm` and `prompt`, which are accepted automatically |

### `status`

Prints the page title and URL, viewport, Chromium process ID, uptime, WebGL renderer and state folder.

## Act

### `scroll <dy> [--steps n] [--delay ms] [--x n --y n]`

Sends mouse wheel events, so pages that listen for the wheel react as they would to a real one. A negative `dy` scrolls up.

| Option | Default | Meaning |
| --- | --- | --- |
| `--steps` | 1 | How many wheel events to send |
| `--delay` | 120 | Milliseconds between events |
| `--x`, `--y` | Page centre | Where the pointer sits |

`windowScrollY` in the output can lag behind, because the page handles wheel events after the command returns. Run `glance eval scrollY` to read the settled value.

### `click` and `hover`

```sh
glance click 640 400            # by coordinates
glance click --selector "#menu" # by CSS selector, scrolling it into view first
glance click --text "See more"  # by its words
```

`--text` ignores case and picks the smallest matching element. It only looks at what is on screen now, so scroll first if the element is further down the page. `hover` takes the same arguments.

### `type <text>`

Inserts text into the focused element. Click the field first.

### `key <name>`

Presses one key: `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Space`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `PageUp`, `PageDown`, `Home` or `End`.

### `reload [--wait ms] [--timeout ms]`, `back`, `forward`

Reload takes the same options as `open`. `back` and `forward` give an error when there is nothing in that direction.

### `size <w> <h> [--mobile] [--dpr n]`

Sets the viewport. It lasts until you change it or the browser stops. The default is 1280 by 800.

| Option | Meaning |
| --- | --- |
| `--mobile` | Use a phone browser identity and touch input |
| `--dpr n` | Device pixel ratio, which also scales `shot`. The default is 1 |

Run `glance reload` afterwards, because many pages only read these at load. For a phone-shaped page, which suits a portrait terminal, use `glance size 390 844 --mobile`.

### `wait <ms>`

Pauses for that long. It doesn't start the browser.

## Watch in a terminal

These are explained in [Watching in a terminal](watching.md).

| Command | What it does |
| --- | --- |
| `view [--cols n --rows n --256]` | Live view with mouse and keyboard |
| `show [--cols n --rows n --256]` | Prints one frame as coloured blocks |
| `image [--width px] [--tty]` | Prints a real picture. `--width` defaults to 800 |

`--256` uses 256 colours instead of 24-bit colour. Sizes default to the terminal's size, or 100 by 30 when the output isn't a terminal.

## Run

| Command | What it does |
| --- | --- |
| `start` | Starts the browser and prints `status` |
| `stop` | Closes the browser, or prints `not running` |
| `help` | Prints the command summary |

`raster --cols n --rows n` is for the [`/preview` mod](../claude-code/glance-preview/README.md). It prints one frame as JSON and never starts the browser.

## Settings

| Variable | Purpose |
| --- | --- |
| `GLANCE_HOME` | State folder, default `~/.glance`. Keep the path short: a socket path over about 100 characters fails with `browser did not start` |
| `GLANCE_CHROMIUM` | Browser binary, default `chromium` |
| `GLANCE_FLAGS` | Extra Chromium flags, separated by spaces |

To run a second, separate browser, give it its own `GLANCE_HOME`.

The state folder holds:

| Path | Contents |
| --- | --- |
| `sock` | The private socket for commands |
| `chromium.log` | Chromium's output, replaced on each start |
| `profile/` | Browser profile, including cookies |
| `shots/` | Default location for `shot` and `film` |
