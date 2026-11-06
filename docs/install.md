# Installing glance

## Requirements

| Need | Details |
| --- | --- |
| System | Alpine Linux. Tested on 3.21 under proot, in Acode's terminal on Android 15 |
| Node | Version 22 or newer. glance has no npm dependencies |
| Browser | Chromium 136 and Mesa, both installed in step 2 |
| Disk | About 700 MB on a fresh Alpine system, so use Wi-Fi for the download |
| Memory | About 1.3 GB while a heavy WebGL page is open |

Other systems are covered in [Other Linux systems](#other-linux-systems).

## 1. Open a terminal

**On Android:** install [Acode](https://play.google.com/store/apps/details?id=com.foxdebug.acodefree) and open its terminal. Acode sets up Alpine Linux the first time, and you are already root inside it.

**On normal Alpine:** open a shell, and put `sudo` in front of the `apk` and `ln` commands below if you aren't root.

## 2. Install the packages

```sh
apk update
apk add git nodejs chromium mesa-egl mesa-gl mesa-dri-gallium
```

Mesa provides the software graphics that WebGL runs on. You don't need `chromium-swiftshader` or `mesa-vulkan-swrast`. glance doesn't use them, because both crashed on real sites during development.

## 3. Get glance

```sh
cd ~
git clone https://github.com/ankitc1010/glance.git
cd glance
ln -s "$PWD/bin/glance.mjs" /usr/local/bin/glance
```

There is no build step and no `npm install`. Keep this folder, because the `glance` command links to it.

## 4. Check that it works

```sh
glance status
```

The first run starts the browser, which takes a few seconds. Look for this line in the output:

```
"webgl": "ANGLE (Mesa, llvmpipe (LLVM 19.1.4 128 bits), OpenGL ES 3.2)",
```

The version numbers can differ, but it should say `llvmpipe`. If it doesn't, see [Troubleshooting](troubleshooting.md).

Then load a page and save a screenshot:

```sh
glance open example.com
glance shot
glance stop
```

`open` should report `"loaded": true`. `shot` prints the path of a PNG in `~/.glance/shots`.

## 5. Turn on real pictures (Acode)

The terminal can show actual images, but Acode has this off by default.

1. Open **Settings → Terminal Settings** in Acode.
2. Turn on **Image support**. It takes effect straight away.
3. Try it:

   ```sh
   glance open example.com
   glance image
   glance stop
   ```

With the setting off, `glance image` shows nothing and gives no error. See [Watching in a terminal](watching.md) for every way to view a page.

## 6. Use it with Claude Code (optional)

Claude Code can use glance through its Bash tool with no further setup, but it needs to know glance exists. Add the snippet from [Using with an agent](agents.md#tell-your-agent-about-glance) to your `CLAUDE.md`.

There is also an experimental [`/preview` panel](../claude-code/glance-preview/README.md).

## Run the tests (optional)

The tests need `npm` and Python, and start a real browser with a temporary state folder.

```sh
apk add npm python3
npm test
```

## Update

```sh
glance stop
cd ~/glance
git pull
```

## Remove

```sh
glance stop
rm /usr/local/bin/glance
rm -rf ~/.glance ~/glance
```

The `rm -rf` also deletes saved screenshots and the browser profile, including cookies. To remove the packages too, run `apk del chromium mesa-egl mesa-gl mesa-dri-gallium`. Keep any that your other tools need.

## Other Linux systems

This is untested. In principle glance needs:

- Node 22 or newer.
- Chromium, either as `chromium` on your `PATH` or named with `GLANCE_CHROMIUM`.
- Mesa with EGL and llvmpipe. Package names differ between distributions.

`glance` always uses Chromium's `--no-sandbox` flag and software graphics flags, even where they aren't needed. `glance image --tty` needs `/proc`, so it only works on Linux. macOS and Windows are not supported.

## How this guide was checked

- **Package list:** resolved on an empty Alpine 3.21 root. Every library the running browser loaded on immersive-g.com belongs to a package in that install, with the Vulkan driver hidden from the browser.
- **Steps 3 and 4:** run on a clean clone with a temporary state folder.
- **Not checked:** the guide has not been followed from start to finish on a new phone, because that needs a fresh device and a large download. Please open an issue if a step fails.
