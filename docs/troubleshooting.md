# Troubleshooting

## Setting up

### `glance: command not found`

The link is missing. Run this from the glance folder:

```sh
ln -s "$PWD/bin/glance.mjs" /usr/local/bin/glance
```

### `glance: browser did not start`

This takes about 30 seconds to appear. Check these in order:

1. Run `chromium --version`. If that fails, install it with `apk add chromium`, or point `GLANCE_CHROMIUM` at your browser. The log can be empty in this case.
2. Read `~/.glance/chromium.log`.
3. If you set `GLANCE_HOME`, shorten the path. Socket paths have a limit of about 100 characters. A long path can also leave a browser running, so check with `ps` and stop it.

### `glance status` doesn't show `llvmpipe`

Mesa is missing or incomplete, so install it:

```sh
glance stop
apk add mesa-egl mesa-gl mesa-dri-gallium
glance status
```

## Loading pages

### The screenshot only shows a loader

Heavy sites are slow on the CPU. Allow more time with `--wait 12000`, then scroll to get past any intro:

```sh
glance scroll 300 --steps 14
```

`glance film 6 2000` shows what the page does over time.

### A WebGL site is blank or crashes

Run `glance log` and `glance status`. If you've added flags through `GLANCE_FLAGS` that switch to SwiftShader or lavapipe, remove them, because both crashed on real sites here.

### `nothing visible matches "..."`

`click --text` only looks at what's on screen. Scroll to the element first, or use `--selector`, which scrolls for you.

### The page is gone

The browser can close when Android stops the terminal, and always closes after `glance stop`. The next command starts a new browser on a blank page, so run `glance open` again. Cookies are kept.

### The browser is slow, or Android kills things

Memory is probably short. Close the browser with `glance stop`, check with `free -m`, and allow about 1.3 GB for a heavy page.

## Seeing the page

### `glance image` shows nothing

1. In Acode, turn on **Settings → Terminal Settings → Image support**.
2. Inside Claude Code, use `! glance image --tty`, because Claude Code captures normal output.

Terminals that don't support the protocol ignore it silently. Use `glance view`, `glance show` or `glance shot` there.

### The picture disappears inside Claude Code

Claude Code wipes it from any rows it redraws. Run the command again, or use `glance image` in a second terminal tab, where nothing redraws over it.

### `glance: no terminal found among the parent processes`

`--tty` needs a parent process attached to a terminal, so it can't work from a background job with no terminal. Save a file with `glance shot` instead.

### The blocks look garbled or have the wrong colours

Your terminal may lack 24-bit colour, so add `--256`. If that doesn't help, use a second terminal tab instead of running inside another program.

### Text shows as boxes

No installed font has those characters:

```sh
apk add font-noto
```

## Still stuck

Open an issue with the output of `glance status`, `glance log` and the end of `~/.glance/chromium.log`. Check them first for anything private, such as URLs or page text.
