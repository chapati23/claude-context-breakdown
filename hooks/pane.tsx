// The pane: the segments (level 1), the items of one segment (level 2) and
// the text of one item (level 3). It draws from state alone; each press
// hands the move to an action.

import type { RenderElement, RenderSurface } from 'claude-code'

import type {
  ContextBreakdownContent,
  ContextBreakdownList,
  ContextBreakdownSegment,
  ContextBreakdownSegmentId,
  ContextBreakdownSnapshot,
  ContextBreakdownView,
} from '../types'
import type { Ui } from './band'
import { formatTokens } from './format'
import { segmentDef } from './segments'
import { freeTokens, sumTokens } from './snapshot'
import { fit, itemRowText, rowColumns, rowText, showsHotkeys, totalLabel } from './view'

export type PaneActions = {
  close: () => unknown
  refresh: () => unknown
  openSegment: (id: ContextBreakdownSegmentId) => unknown
  openItem: (id: string) => unknown
  back: () => unknown
  toggleSort: () => unknown
  listPage: (delta: number) => unknown
  contentPage: (delta: number) => unknown
  toggleSource: () => unknown
  copy: (path: string, surface: RenderSurface) => unknown
  mention: (path: string) => unknown
}

/** "1" to "9" for the first nine rows, when the pane has room for the mark. */
function hotkeyOf(index: number, columns: number): string | undefined {
  return index < 9 && showsHotkeys(columns) ? String(index + 1) : undefined
}

/** A row without a hotkey mark is indented by as much, so the rows line up. */
function markRoom(hotkey: string | undefined, columns: number): string {
  return hotkey === undefined && showsHotkeys(columns) ? '   ' : ''
}

// Level 1.

function groupRows(
  el: Ui,
  segments: readonly ContextBreakdownSegment[],
  window: number,
  columns: number,
  first: number,
  actions: PaneActions,
) {
  const { Button, Text } = el

  return segments
    .filter(segment => segment.tokens > 0)
    .map((segment, index) => {
      const def = segmentDef(segment.id)
      const hotkey = hotkeyOf(first + index, columns)
      const { name, figures } = rowText(def.label, segment.tokens, window, rowColumns(columns), def.short)

      return (
        <Button
          key={`row-${segment.id}`}
          label={def.label}
          plain
          {...(hotkey === undefined ? {} : { hotkey })}
          onPress={() => void actions.openSegment(segment.id)}
        >
          {markRoom(hotkey, columns)}
          <Text color={def.color}>██</Text> {name}
          <Text dimColor>{figures}</Text>
        </Button>
      )
    })
}

function heading(el: Ui, title: string, tokens: number, window: number, columns: number) {
  const { Text } = el
  const { name, figures } = rowText(title, tokens, window, columns)

  return (
    <Text weight="bold">
      {'   '}
      {name}
      {figures}
    </Text>
  )
}

function plainRow(
  el: Ui,
  swatch: string,
  title: string,
  tokens: number,
  window: number | null,
  columns: number,
) {
  const { Text } = el
  const { name, figures } = rowText(title, tokens, window, columns)

  return (
    <Text dimColor>
      {swatch} {name}
      {figures}
    </Text>
  )
}

/** The heading says "deferred" already; a name need not repeat it. */
export function withoutDeferred(name: string): string {
  return name.replace(/\s*\(deferred\)\s*$/i, '') || name
}

function segmentsBody(el: Ui, snapshot: ContextBreakdownSnapshot, columns: number, actions: PaneActions) {
  const { Box, Text } = el
  const { window } = snapshot
  const deferred = snapshot.deferred.filter(category => category.tokens > 0)
  const baselineRows = snapshot.baseline.filter(segment => segment.tokens > 0).length

  return (
    <Box flexDirection="column">
      <Text weight="bold">{totalLabel(snapshot)} used</Text>
      <Box flexDirection="column" marginTop={1}>
        {heading(el, 'Baseline', sumTokens(snapshot.baseline), window, columns)}
        {groupRows(el, snapshot.baseline, window, columns, 0, actions)}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {heading(el, 'Conversation', sumTokens(snapshot.conversation), window, columns)}
        {groupRows(el, snapshot.conversation, window, columns, baselineRows, actions)}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {plainRow(el, '··', 'Free space', freeTokens(snapshot), window, columns)}
        {plainRow(el, '▒▒', 'Reserve', snapshot.reserve, window, columns)}
      </Box>
      {deferred.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Not loaded (deferred)</Text>
          {deferred.map(category =>
            plainRow(el, '  ', withoutDeferred(category.name), category.tokens, null, columns),
          )}
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {snapshot.isEstimate && (
          <Text dimColor wrap="wrap">
            ~ The conversation is estimated from its characters until the first response after the compaction.
          </Text>
        )}
        <Text dimColor wrap="wrap">
          All numbers are estimates.
        </Text>
      </Box>
    </Box>
  )
}

// Level 2.

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function listBody(el: Ui, list: ContextBreakdownList, window: number | null, columns: number, actions: PaneActions) {
  const { Box, Button, Text } = el
  const def = segmentDef(list.segment)
  const facts = [plural(list.items, 'item'), formatTokens(list.tokens)]
  if (list.canSort) {
    facts.push(list.sort === 'size' ? 'largest first' : 'newest first')
  }
  if (list.pages > 1) {
    facts.push(`page ${list.page + 1} of ${list.pages}`)
  }
  let openable = 0

  return (
    <Box flexDirection="column">
      <Text weight="bold">
        <Text color={def.color}>██</Text> {fit(def.label, Math.max(1, columns - 4)).trimEnd()}
      </Text>
      <Text dimColor>{facts.join(' · ')}</Text>
      {list.note !== null && (
        <Text dimColor wrap="wrap">
          {list.note}
        </Text>
      )}
      <Box flexDirection="column" marginTop={1}>
        {list.rows.map(row => {
          const hotkey = row.isOpenable ? hotkeyOf(openable++, columns) : undefined
          const text = itemRowText(row.title, row.detail, row.tokens, window, rowColumns(columns), row.pathIn)
          const inner = [
            markRoom(hotkey, columns),
            <Text color={def.color}>██</Text>,
            ` ${text.title}`,
            <Text dimColor>{text.detail}</Text>,
            <Text dimColor>{text.figures}</Text>,
          ]
          if (!row.isOpenable) {
            return <Text>{inner}</Text>
          }

          return (
            <Button
              key={`item-${row.id}`}
              label={row.title}
              plain
              {...(hotkey === undefined ? {} : { hotkey })}
              onPress={() => void actions.openItem(row.id)}
            >
              {inner}
            </Button>
          )
        })}
      </Box>
      {list.hiddenItems > 0 && (
        <Text dimColor wrap="wrap">
          {`${plural(list.hiddenItems, 'more item')}, ${formatTokens(list.hiddenTokens)}, on other pages`}
        </Text>
      )}
      {def.group === 'conversation' && list.items > 0 && (
        <Text dimColor wrap="wrap">
          Sizes are estimated from each item’s characters.
        </Text>
      )}
    </Box>
  )
}

// Level 3.

function contentBody(el: Ui, segment: ContextBreakdownSegmentId, item: ContextBreakdownContent) {
  const { Box, Code, Text } = el
  const def = segmentDef(segment)
  const facts = [`${formatTokens(item.tokens)} tokens`, item.source === 'loaded' ? 'as loaded' : 'on disk']
  if (item.pages > 1) {
    facts.push(`page ${item.page + 1} of ${item.pages}`)
  }

  // The title wraps: a cut would drop the file name at the end of a path.
  return (
    <Box flexDirection="column">
      <Text weight="bold" wrap="wrap">
        <Text color={def.color}>██</Text> {def.short} › {item.title}
      </Text>
      <Text dimColor>{facts.join(' · ')}</Text>
      {item.isChanged && item.source === 'loaded' && (
        <Text color="warning" weight="bold" wrap="wrap">
          ! The file changed on disk since it was loaded.
        </Text>
      )}
      {item.note !== null && (
        <Text dimColor wrap="wrap">
          {item.note}
        </Text>
      )}
      {item.notice !== null && <Text dimColor>{item.notice}</Text>}
      <Box flexDirection="column" marginTop={1}>
        {item.text === '' ? (
          <Text dimColor>(empty)</Text>
        ) : (
          <Code
            key="content"
            source={item.text}
            {...(item.startLine === null ? {} : { startLine: item.startLine })}
            {...(item.language === null ? {} : { path: item.language })}
          />
        )}
      </Box>
    </Box>
  )
}

// The keys line: one dim row of controls under each level.

type Control = { key: string; label: string; hotkey: string; onPress: (surface: RenderSurface) => unknown }

function controls(view: ContextBreakdownView, actions: PaneActions): Control[] {
  const out: Control[] = []
  const add = (key: string, label: string, hotkey: string, onPress: Control['onPress']) =>
    out.push({ key, label, hotkey, onPress })
  if (view.level === 2) {
    const { list } = view
    add('back', 'Back', 'b', actions.back)
    if (list.canSort) {
      add('sort', list.sort === 'size' ? 'Newest first' : 'Largest first', 's', actions.toggleSort)
    }
    if (list.page > 0) {
      add('prev', 'Previous page', 'p', () => actions.listPage(-1))
    }
    if (list.page + 1 < list.pages) {
      add('next', 'Next page', 'n', () => actions.listPage(1))
    }
  }
  if (view.level === 3) {
    const { item } = view
    add('back', 'Back', 'b', actions.back)
    if (item.page > 0) {
      add('prev', 'Previous page', 'p', () => actions.contentPage(-1))
    }
    if (item.page + 1 < item.pages) {
      add('next', 'Next page', 'n', () => actions.contentPage(1))
    }
    if (item.canToggle) {
      add('view', item.source === 'loaded' ? 'On disk' : 'As loaded', 'v', actions.toggleSource)
    }
    const { path } = item
    if (path !== null) {
      add('copy', 'Copy path', 'c', surface => actions.copy(path, surface))
      add('mention', 'Mention', 'm', () => actions.mention(path))
    }
  }
  add('close', 'Close', 'x', actions.close)
  add('refresh', 'Refresh', 'r', actions.refresh)

  return out
}

function keysLine(el: Ui, view: ContextBreakdownView, hasRows: boolean, columns: number, actions: PaneActions) {
  const { Box, Button, Text } = el

  return (
    <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginTop={1}>
      {hasRows && showsHotkeys(columns) && <Text dimColor>1-9 open</Text>}
      {controls(view, actions).map(control => (
        <Button
          key={control.key}
          label={control.label}
          plain
          dimColor
          hotkey={control.hotkey}
          {...(control.key === 'close' ? { role: 'dismiss' as const } : {})}
          onPress={press => void control.onPress(press.surface)}
        />
      ))}
    </Box>
  )
}

/**
 * The pane's tree, `columns` wide: the level the view names, or a waiting
 * line before the first measurement.
 */
export function paneTree(
  el: Ui,
  snapshot: ContextBreakdownSnapshot | null,
  view: ContextBreakdownView,
  columns: number,
  actions: PaneActions,
): RenderElement {
  const { Box, Text } = el
  let body: RenderElement
  let hasRows = false
  if (view.level === 2) {
    body = listBody(el, view.list, snapshot?.window ?? null, columns, actions)
    hasRows = view.list.rows.some(row => row.isOpenable)
  } else if (view.level === 3) {
    body = contentBody(el, view.list.segment, view.item)
  } else if (snapshot === null) {
    body = <Text dimColor>Measuring the context window…</Text>
  } else {
    body = segmentsBody(el, snapshot, columns, actions)
    hasRows = true
    if (view.note !== undefined) {
      body = (
        <Box flexDirection="column">
          <Text dimColor wrap="wrap">
            {view.note}
          </Text>
          {body}
        </Box>
      )
    }
  }

  return (
    <Box flexDirection="column">
      {body}
      {keysLine(el, view, hasRows, columns, actions)}
    </Box>
  )
}
