import type { EngineInterface, Register } from 'claude-code'

const PANE = 'glance-preview'
const KEY = 'page'
const REFRESH_MS = 1000
const FRAME_TIMEOUT_MS = 20000
const OPEN_TIMEOUT_MS = 120000
const OPEN_SETTLE_MS = '3000'
// Keeps the chat readable when the pane sits above the prompt on a small screen.
const MAX_SCREEN_SHARE = 0.6
const MIN_ROWS = 4
const MAX_ROWS = 256
const MAX_COLUMNS = 512
const SPACE = 0x20
const DEFAULT_COLOUR = 0x01000000
const IDLE = 'No page open. Try /preview example.com'

type Size = { columns: number; rows: number }
type RasterFrame = { page: { w: number; h: number }; title: string; url: string; cells: string }

// A reload starts these over; the next draw and tick rebuild them.
let shown: Size | undefined
let frame: (Size & { cells: string }) | undefined
let caption = IDLE
let pageShape = 800 / 1280
let isRefreshing = false

function blankCells({ columns, rows }: Size): string {
  const words = new Uint32Array(columns * rows * 3)
  for (let i = 0; i < words.length; i += 3) {
    words[i] = SPACE
    words[i + 1] = DEFAULT_COLOUR
    words[i + 2] = DEFAULT_COLOUR
  }

  return new Uint8Array(words.buffer).toBase64()
}

function setCaption($: EngineInterface, text: string) {
  if (text === caption) return
  caption = text
  $.ui.invalidate('ui.render')
}

async function refresh($: EngineInterface) {
  if (!shown || isRefreshing) return
  isRefreshing = true
  const size = shown
  try {
    const ran = await $.process.run(
      ['glance', 'raster', '--cols', String(size.columns), '--rows', String(size.rows)],
      { timeoutMs: FRAME_TIMEOUT_MS },
    )
    if (ran.exitCode !== 0) {
      setCaption($, IDLE)

      return
    }
    const page = JSON.parse(ran.stdout) as RasterFrame
    frame = { ...size, cells: page.cells }
    const shape = page.page.h / page.page.w
    const isReshaped = shape !== pageShape
    pageShape = shape
    setCaption($, page.title || page.url)
    if (isReshaped) $.ui.invalidate('ui.render')
    else await $.ui.blit({ requestId: PANE, key: KEY, cells: page.cells, ...size })
  } catch {
    setCaption($, 'The page is busy. Still trying…')
  } finally {
    isRefreshing = false
  }
}

async function openPage($: EngineInterface, url: string) {
  try {
    const ran = await $.process.run(['glance', 'open', url, '--wait', OPEN_SETTLE_MS], {
      timeoutMs: OPEN_TIMEOUT_MS,
    })
    if (ran.exitCode !== 0) setCaption($, `Could not open ${url}`)
  } catch {
    setCaption($, `${url} is taking too long to open`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'preview',
      description: 'Show the browser page here. /preview <url> opens a page, /preview off closes it',
    })
    // Costs nothing while the pane is closed: refresh returns at once.
    await $.clock.every(REFRESH_MS, () => void refresh($))

    return next(e)
  })

  on('command.run', { command: 'preview' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'off') {
      await $.ui.close({ id: PANE })

      return { text: 'Preview closed.' }
    }
    const opened = await $.ui.open({ id: PANE, title: 'Browser preview' })
    if (!opened.isPlaced) return { text: `The preview could not open: ${opened.reason}` }
    if (!arg) return { text: 'Preview opened. /preview off closes it.' }
    setCaption($, `Opening ${arg}…`)
    void openPage($, arg)

    return { text: `Opening ${arg} in the preview.` }
  })

  on('ui.close', async (_, e, next) => {
    if (e.id === PANE) shown = undefined

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)

      return <Text dimColor>The browser preview only draws in a terminal.</Text>
    }
    const { Box, Raster, Text } = $.ui.resolve(e)
    const columns = Math.min(MAX_COLUMNS, Math.max(1, e.props.bodyColumns))
    const room = Math.max(MIN_ROWS, e.props.scroll.bodyRows - 1)
    const share = Math.floor((e.viewport?.rows ?? room) * MAX_SCREEN_SHARE)
    const wanted = Math.ceil((columns * pageShape) / 2)
    const rows = Math.min(MAX_ROWS, Math.max(MIN_ROWS, Math.min(wanted, room, share)))
    shown = { columns, rows }
    const isSameSize = frame?.columns === columns && frame?.rows === rows

    return (
      <Box flexDirection="column">
        <Raster key={KEY} columns={columns} rows={rows} cells={isSameSize ? frame.cells : blankCells(shown)} />
        <Text dimColor>{caption.slice(0, Math.max(1, columns - 1))}</Text>
      </Box>
    )
  })
}
