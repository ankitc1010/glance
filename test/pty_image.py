# Runs `glance image --tty` the way Claude Code runs a `!` command: its output is captured
# and only a parent process holds the terminal. Used by e2e.test.mjs. Argument: path to the CLI.
import base64, os, pty, re, select, shlex, struct, sys, time

CLI = sys.argv[1]
WIDTH = 200
TIMEOUT_SECONDS = 60

pid, fd = pty.fork()
if pid == 0:
    command = f'{shlex.quote(CLI)} image --tty --width {WIDTH} | cat >/dev/null; echo finished'
    os.execvp('sh', ['sh', '-c', command])

screen = bytearray()
end = time.time() + TIMEOUT_SECONDS
while b'finished' not in screen and time.time() < end:
    ready, _, _ = select.select([fd], [], [], 0.2)
    if ready:
        try:
            screen.extend(os.read(fd, 65536))
        except OSError:
            break

match = re.search(rb'\x1b7\x1b\[H\x1b\]1337;File=inline=1;size=(\d+);[^:]*:([A-Za-z0-9+/=]+)\x07\x1b8', screen)
assert match, 'no overlay image reached the terminal'
png = base64.b64decode(match.group(2))
assert len(png) == int(match.group(1)), 'size field does not match the picture'
assert png[:8] == b'\x89PNG\r\n\x1a\n', 'payload is not a PNG'
assert struct.unpack('>I', png[16:20])[0] == WIDTH, 'wrong picture width'
assert b'Picture sent' not in screen, 'the confirmation belongs on captured output'
print('all checks passed')
