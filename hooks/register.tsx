// Wiring only: which events ask for a measurement, where it is drawn, and
// what each press of the pane does. The logic lives in the .ts files beside
// this one. Each hook spells `$` at its call sites (the engine refuses `$`
// passed around), so the calls a measurement or a move needs are handed over
// as closures.

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { ContextBreakdownSegmentId } from '../types'
import { bandTree, glanceTree } from './band'
import {
  LEVEL_1,
  back,
  contentPage,
  listPage,
  mention,
  notice,
  openItem,
  openSegment,
  rebuildView,
  refreshItem,
  toLevel1,
  toggleSort,
  toggleSource,
} from './navigate'
import type { NavIo } from './navigate'
import { paneTree } from './pane'
import { createRefresher } from './refresh'
import { matchSegment } from './segments'
import { PANE_ID, PANE_TITLE } from './state'
import { bandModel } from './view'

// The engine reads which state a hook touches from this file, so the atoms
// are written here. A tag declines a value an earlier version stored (it
// outlives a reload); change it whenever the value's fields change.
const snapshotAtom = atom({ plugin: 'context-breakdown', key: 'snapshot' } as const, null, {
  shape: 'snapshot-1',
})
const viewAtom = atom({ plugin: 'context-breakdown', key: 'view' } as const, LEVEL_1, {
  shape: 'view-2',
})

/** Events of a subagent's loop carry its id; this mod shows the main session. */
function isSubagent(e: object): boolean {
  return (e as { agentId?: unknown }).agentId !== undefined
}

/** Our own failure in a press or a command never reaches the session. */
function quietly(work: Promise<unknown>): Promise<unknown> {
  return work.catch(() => undefined)
}

export const register: Register = on => {
  const refresher = createRefresher()

  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({
        name: 'ctx',
        description: 'Show what fills the context window',
        argumentHint: '[segment]',
        immediate: true,
      })
    } catch {
      // The bar still works without the command.
    }
    refresher.soon({
      after: (ms, fn) => $.clock.after(ms, fn),
      now: () => $.clock.now(),
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      write: fn => update($, snapshotAtom, fn),
      rebuild: async data => {
        // Level 1 holds no items: no write, so no redraw.
        if ((await read($, viewAtom)).level !== 1) {
          await update($, viewAtom, view => rebuildView(view, data))
        }
      },
    })

    return next(e)
  })

  // `/ctx` opens the segments; `/ctx <segment>` opens that segment's items.
  on('command.run', { command: 'ctx' }, async ($, e) => {
    const nav: NavIo = {
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      snapshot: () => read($, snapshotAtom),
      view: () => read($, viewAtom),
      write: fn => update($, viewAtom, fn),
      readFile: path => $.fs.read(path),
    }
    const segment = matchSegment(e.args)
    await quietly(segment === null ? update($, viewAtom, toLevel1) : openSegment(nav, segment))
    try {
      // Focus so the keys work at once; no closeOnEscape: the pane stays.
      await $.ui.open({ id: PANE_ID, title: PANE_TITLE, focus: true })
    } catch {
      // A refused open leaves nothing to draw into.
    }
    refresher.soon({
      after: (ms, fn) => $.clock.after(ms, fn),
      now: () => $.clock.now(),
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      write: fn => update($, snapshotAtom, fn),
      rebuild: async data => {
        if ((await read($, viewAtom)).level !== 1) {
          await update($, viewAtom, view => rebuildView(view, data))
        }
      },
    })

    return {}
  }).catch(() => ({}))

  on('session.measure', ($, e, next) => {
    if (e.changed.includes('context')) {
      refresher.soon({
        after: (ms, fn) => $.clock.after(ms, fn),
        now: () => $.clock.now(),
        usage: () => $.session.usage({ breakdown: 'summary' }),
        messages: () => $.session.messages({ as: 'api' }),
        write: fn => update($, snapshotAtom, fn),
        rebuild: async data => {
          if ((await read($, viewAtom)).level !== 1) {
            await update($, viewAtom, view => rebuildView(view, data))
          }
        },
      })
    }

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (!isSubagent(e)) {
      refresher.soon({
        after: (ms, fn) => $.clock.after(ms, fn),
        now: () => $.clock.now(),
        usage: () => $.session.usage({ breakdown: 'summary' }),
        messages: () => $.session.messages({ as: 'api' }),
        write: fn => update($, snapshotAtom, fn),
        rebuild: async data => {
          if ((await read($, viewAtom)).level !== 1) {
            await update($, viewAtom, view => rebuildView(view, data))
          }
        },
      })
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (!isSubagent(e)) {
      refresher.afterTool({
        after: (ms, fn) => $.clock.after(ms, fn),
        now: () => $.clock.now(),
        usage: () => $.session.usage({ breakdown: 'summary' }),
        messages: () => $.session.messages({ as: 'api' }),
        write: fn => update($, snapshotAtom, fn),
        rebuild: async data => {
          if ((await read($, viewAtom)).level !== 1) {
            await update($, viewAtom, view => rebuildView(view, data))
          }
        },
      })
    }

    return result
  }).catch(($, e, next) => next(e))

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!isSubagent(e) && e.trigger !== 'precompute' && result.skip === undefined) {
      // The plain usage call is free; its token figure is the one that stays
      // stale until the next model response.
      let staleTokens: number | null = null
      try {
        staleTokens = (await $.session.usage()).context.tokens ?? null
      } catch {
        staleTokens = null
      }
      refresher.compacted(
        {
          after: (ms, fn) => $.clock.after(ms, fn),
          now: () => $.clock.now(),
          usage: () => $.session.usage({ breakdown: 'summary' }),
          messages: () => $.session.messages({ as: 'api' }),
          write: fn => update($, snapshotAtom, fn),
          rebuild: async data => {
            if ((await read($, viewAtom)).level !== 1) {
              await update($, viewAtom, view => rebuildView(view, data))
            }
          },
        },
        staleTokens,
      )
    }

    return result
  }).catch(($, e, next) => next(e))

  // A /clear fires no session.start, and the next measurement comes only after
  // the next turn: drop the old conversation's snapshot and items now, and
  // measure again.
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') {
      await quietly(update($, viewAtom, toLevel1))
      await refresher.cleared({
        after: (ms, fn) => $.clock.after(ms, fn),
        now: () => $.clock.now(),
        usage: () => $.session.usage({ breakdown: 'summary' }),
        messages: () => $.session.messages({ as: 'api' }),
        write: fn => update($, snapshotAtom, fn),
        rebuild: async data => {
          if ((await read($, viewAtom)).level !== 1) {
            await update($, viewAtom, view => rebuildView(view, data))
          }
        },
      })
    }

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snapshot = await read($, snapshotAtom)
    // Nothing before the first measurement, and a survey has the band.
    if (snapshot === null || e.props.hasSurvey) {
      return next(e)
    }
    const model = bandModel(snapshot, e.props.bodyColumns)
    // Too narrow for even the shortest total.
    if (model.label === '') {
      return next(e)
    }
    const nav: NavIo = {
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      snapshot: () => read($, snapshotAtom),
      view: () => read($, viewAtom),
      write: fn => update($, viewAtom, fn),
      readFile: path => $.fs.read(path),
    }

    // A segment opens its items; a merged cell, which holds several, the list.
    return bandTree($.ui.resolve(e), model, part =>
      quietly(
        (async () => {
          if (part.members.length === 1) {
            await openSegment(nav, part.id as ContextBreakdownSegmentId)
          } else {
            await update($, viewAtom, toLevel1)
          }
          await $.ui.open({ id: PANE_ID, title: PANE_TITLE })
        })(),
      ),
    )
  })

  on('ui.render', { component: 'Pane', requestId: 'context-breakdown' }, async ($, e) => {
    const snapshot = await read($, snapshotAtom)
    // A minimized pane on the desktop app: a glance, as clicks may not reach it.
    if (e.props.placement === 'widget') {
      return glanceTree($.ui.resolve(e), snapshot, e.props.bodyColumns)
    }
    const view = await read($, viewAtom)
    const nav: NavIo = {
      usage: () => $.session.usage({ breakdown: 'summary' }),
      messages: () => $.session.messages({ as: 'api' }),
      snapshot: () => read($, snapshotAtom),
      view: () => read($, viewAtom),
      write: fn => update($, viewAtom, fn),
      readFile: path => $.fs.read(path),
    }

    return paneTree($.ui.resolve(e), snapshot, view, e.props.bodyColumns, {
      close: () =>
        quietly(
          (async () => {
            await $.ui.close({ id: PANE_ID })
            await update($, viewAtom, toLevel1)
          })(),
        ),
      refresh: () =>
        quietly(
          (async () => {
            await refresher.now({
              after: (ms, fn) => $.clock.after(ms, fn),
              now: () => $.clock.now(),
              usage: () => $.session.usage({ breakdown: 'summary' }),
              messages: () => $.session.messages({ as: 'api' }),
              write: fn => update($, snapshotAtom, fn),
              rebuild: async data => {
                if ((await read($, viewAtom)).level !== 1) {
                  await update($, viewAtom, current => rebuildView(current, data))
                }
              },
            })
            await refreshItem(nav)
          })(),
        ),
      openSegment: id => quietly(openSegment(nav, id)),
      openItem: id => quietly(openItem(nav, id)),
      back: () => quietly(update($, viewAtom, back)),
      toggleSort: () => quietly(toggleSort(nav)),
      listPage: delta => quietly(listPage(nav, delta)),
      contentPage: delta => quietly(contentPage(nav, delta)),
      toggleSource: () => quietly(toggleSource(nav)),
      copy: (path, surface) =>
        quietly(
          (async () => {
            const copied = await $.ui.copy({ text: path, surface })
            await notice(nav, copied.isCopied ? 'Copied the path.' : `The path was not copied (${copied.reason}).`)
          })(),
        ),
      mention: path =>
        quietly(
          (async () => {
            const filled = await $.prompt.fill({ text: mention(path), mode: 'insert' })
            const why =
              filled.refusal === 'no_composer'
                ? ': there is no prompt box'
                : filled.refusal === 'dialog'
                  ? ': a dialog holds the keys'
                  : ''
            await notice(nav, filled.isFilled ? 'Put the path in the prompt.' : `The prompt did not take the path${why}.`)
          })(),
        ),
    })
  })
}
