# `/preview` mod for Claude Code

Shows the glance browser's current page in a panel inside Claude Code, refreshing about once a second.

**This is experimental.** It passes its unit tests but has never run on a real Claude Code screen, so it may need fixes on first use.

## Load it

Install [glance](../../docs/install.md) first, so that `glance` is on your `PATH`. Then start Claude Code with the mod:

```sh
claude --plugin-dir ~/glance/claude-code/glance-preview
```

## Use it

| Command | What it does |
| --- | --- |
| `/preview example.com` | Opens the page and shows it |
| `/preview` | Shows whatever glance has open now |
| `/preview off` | Closes the panel |

It shows anything glance is showing, so you can watch an agent browse in it.

## Limits

- **View only.** You can't tap or click the page in the panel. Use `glance` commands, or ask the agent.
- **Coarse picture.** It draws half blocks, because Claude Code's image element only supports kitty, Ghostty and iTerm2. It's limited to about 1024 colour pairs at once.
- **Battery.** It does no work while the panel is closed, but takes a new frame every second while open, even if nothing has changed.

The panel never starts the browser unless you give it a URL.

## Develop

```sh
claude plugin validate ~/glance/claude-code/glance-preview
claude plugin test ~/glance/claude-code/glance-preview
```

Each frame comes from `glance raster --cols n --rows n`, described in [Commands](../../docs/commands.md#run).
