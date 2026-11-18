import { expect, test } from 'claude-code/testing'

import { TRACE_FILE, trace, traceLines } from '../hooks/trace'

test('the trace ships turned off', () => {
  expect(TRACE_FILE).toBeNull()
})

test('while off, a trace writes nothing and keeps nothing', async () => {
  const written: string[] = []
  // Any write would land here; none may come.
  const engine = { fs: { write: async (path: string) => void written.push(path) } } as unknown as Parameters<typeof trace>[0]
  trace(engine, { hook: 'ui.press', element: 'scroll-down', surface: 'desktop' })
  trace(engine, { hook: 'ui.scroll', offset: 6 })
  await Promise.resolve()
  expect(written).toEqual([])
  expect(traceLines()).toEqual([])
})
