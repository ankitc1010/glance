import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'glance-preview',
  component: 'Pane',
  requestId: 'glance-preview',
  surface: 'terminal',
  viewport: { columns: 60, rows: 40 },
  props: {
    title: 'Browser preview',
    isFocused: false,
    bodyColumns: 58,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

test('the pane draws a raster fitted to the page and the screen', async $ => {
  const ui = await $.ui.mount(PANE)
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.props.columns).toBe(58)
  // 58 columns of a 1280 by 800 page need 29 pixel rows' worth of half blocks.
  expect(raster?.props.rows).toBe(19)
  expect((await ui.find({ type: 'Text', text: /No page open/ }))?.text).toBe(
    'No page open. Try /preview example.com',
  )
  await ui.unmount()
})

test('a short screen caps the raster so the chat stays readable', async $ => {
  const ui = await $.ui.mount({ ...PANE, viewport: { columns: 60, rows: 20 } })
  expect((await ui.find({ type: 'Raster' }))?.props.rows).toBe(12)
  await ui.unmount()
})

test('other surfaces get words instead of a raster', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /only draws in a terminal/ }))?.text).toBeDefined()
  await ui.unmount()
})

test('/preview opens the pane, /preview off closes it', async ($, on) => {
  const calls: string[] = []
  on('ui.open', () => {
    calls.push('open')

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    calls.push('close')

    return { value: undefined }
  })

  const opened = await $.command.run({ command: 'preview', args: '', origin: { kind: 'composer' } })
  expect(opened.text).toMatch(/Preview opened/)
  const closed = await $.command.run({ command: 'preview', args: 'off', origin: { kind: 'composer' } })
  expect(closed.text).toBe('Preview closed.')
  expect(calls).toEqual(['open', 'close'])
})
