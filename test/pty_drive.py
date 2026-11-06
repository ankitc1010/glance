# Drives `glance view` through a pseudo-terminal, because raw mode, mouse reporting
# and quitting only run on a real TTY. Used by e2e.test.mjs. Argument: path to the CLI.
import fcntl, json, os, pty, select, signal, struct, subprocess, sys, termios, time
import urllib.parse

CLI = sys.argv[1]
PAGE = """<!doctype html><title>pty</title><body style="margin:0;background:#246;height:4000px">
<input id=i style="position:fixed;left:0;top:0;width:100%;height:100px"><script>
window.ev = { wheel: 0, click: null, keys: '', move: 0 };
addEventListener('wheel', (e) => { ev.wheel += e.deltaY; });
addEventListener('click', (e) => { ev.click = [Math.round(e.clientX), Math.round(e.clientY)]; });
addEventListener('mousemove', () => { ev.move++; });
addEventListener('keydown', (e) => { ev.keys += e.key; });
</script>"""


def glance(*args):
    return subprocess.run([CLI, *args], capture_output=True, text=True).stdout.strip()


def events():
    return json.loads(glance('eval', 'JSON.stringify(ev)'))


glance('open', 'data:text/html,' + urllib.parse.quote(PAGE), '--wait', '300')

pid, fd = pty.fork()
if pid == 0:
    os.execv(CLI, [CLI, 'view'])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 100, 0, 0))
os.kill(pid, signal.SIGWINCH)
screen = bytearray()


def pump(seconds):
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if ready:
            try:
                data = os.read(fd, 65536)
            except OSError:
                return
            if not data:
                return
            screen.extend(data)


def send(text, seconds=1.2):
    os.write(fd, text.encode())
    pump(seconds)


pump(3)
assert b'\x1b[?1049h' in screen and b'\x1b[?1003h' in screen, 'did not enter viewer mode'
assert '▀'.encode() in screen, 'drew no half blocks'
assert b'q quit' in screen, 'no status bar'

send('\x1b[B')
assert events()['wheel'] == 240, 'Down arrow should scroll'
send('\x1b[<65;50;20M')
assert events()['wheel'] == 480, 'mouse wheel should scroll'
before = events()['move']
send('\x1b[<35;30;15M')
assert events()['move'] > before, 'mouse move should reach the page'
send('\x1b[<0;50;20M')
send('\x1b[<0;50;20m')
x, y = events()['click']
assert abs(x - 633) < 8, f'click x mapped to {x}'
assert 200 < y < 800, f'click y mapped to {y}'

send('\x1b[<0;50;2M')
send('i')
send('hi')
send('\x7f')
send('\x1b')
assert glance('eval', 'document.querySelector("#i").value') == 'h', 'insert mode should type and delete'

send('o')
assert b' open: ' in screen, 'o should show the URL prompt'
send('\x1b')

fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 70, 0, 0))
os.kill(pid, signal.SIGWINCH)
size = len(screen)
pump(2.5)
assert len(screen) > size, 'resize should redraw'

send('q', 2)
done, _ = os.waitpid(pid, os.WNOHANG)
assert done == pid, 'q should quit the viewer'
assert b'\x1b[?1049l' in screen and b'\x1b[?1003l' in screen, 'terminal not restored'
assert glance('eval', 'document.title') == 'pty', 'browser should outlive the viewer'
print('all checks passed')
