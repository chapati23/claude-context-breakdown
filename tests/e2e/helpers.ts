// End-to-end helpers: read a drawn tree as a person reads the screen, and
// drive the pane as the engine does, with only what the kit offers.
//
// What the kit cannot do, so these helpers only model it:
// - It sends no real key. `hotkey` presses the Button that holds the key,
//   as the engine does for a focused pane, and nothing while the pane does
//   not hold the keyboard; `hold` is many such presses in a row, each one
//   settled before the next, never a host's key repeat.
// - It moves no focus. `setFocus` redraws with `isFocused`, as the engine
//   does when the pane gains or loses the keyboard (Tab in, Escape out).
// - It paints nothing. `flatten` lays text out by cell width; it does not
//   wrap, does not draw borders, and ignores flexWrap, grow and shrink.

import type { On, RenderElement, RenderNode, RenderPropsOf, SessionUsage } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { cellWidth, headCells } from '../../hooks/text'
import { CHAT, NOTES, PANE, PROJECT_MD, PROJECT_TEXT, realSession, richUsage, world } from '../fixtures'
import type { World } from '../fixtures'

// ---------------------------------------------------------------------------
// flatten
// ---------------------------------------------------------------------------

export type FlattenOptions = {
  /**
   * Mark the ring, off and dim parts in the text, so that a diff shows them:
   * the Button that holds the ring (autoFocus) between ⟦ and ⟧, a run in
   * the colour of a control that does not apply (OFF_COLORS) between ⟪ and
   * ⟫, a dim run between ⟨ and ⟩. Off by default.
   */
  marks?: boolean
  /**
   * Which surface draws the Buttons. 'terminal' (the default) prints a
   * Button's children, or its label when it has none, after `h: ` for a
   * plain Button with hotkey h. 'desktop' prints the label alone, as the
   * native button shows it, after `h: ` for a Button with hotkey h: the
   * native button draws the hotkey as a key cap before the label, about
   * three cells wide with its gap, so `h: ` stands for the cap.
   */
  surface?: 'terminal' | 'desktop'
  /**
   * The cells the root lays out in, as the pane's bodyColumns. Only a row
   * Box with flexWrap 'wrap' uses it: its children go onto a new line where
   * the next one would pass the edge. Nothing else wraps or is cut by it.
   */
  columns?: number
}

/** The lines of the flow, and the absolutely placed Boxes apart from it. */
export type Flat = {
  lines: string[]
  /** One entry per line of a placed Box: `@top,left: text`. */
  overlay: string[]
}

/** A run of text with one style. */
type Span = { text: string; dim: boolean; ring: boolean; off: boolean }

/** A block of lines, as a child of a Box lays out. */
type Block = Span[][]

/** The style a node passes down to what it holds. */
type Style = { dim: boolean; ring: boolean; off: boolean }

/**
 * The colours that mark a control that does not apply: the pane draws its
 * label in the theme's faint colour, as the fixtures' isOff reads it.
 */
export const OFF_COLORS: ReadonlySet<string> = new Set(['subtle'])

type Props = Record<string, unknown>

const RING_OPEN = '⟦'
const RING_CLOSE = '⟧'
const DIM_OPEN = '⟨'
const DIM_CLOSE = '⟩'
const OFF_OPEN = '⟪'
const OFF_CLOSE = '⟫'

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function lineWidth(line: Span[]): number {
  return line.reduce((sum, span) => sum + cellWidth(span.text), 0)
}

function blockWidth(block: Block): number {
  return block.reduce((max, line) => Math.max(max, lineWidth(line)), 0)
}

function spaces(n: number): Span {
  return { text: ' '.repeat(n), dim: false, ring: false, off: false }
}

/** Pads a line with spaces to `cells`, or cuts it there. */
function fit(line: Span[], cells: number): Span[] {
  const width = lineWidth(line)
  if (width < cells) {
    return [...line, spaces(cells - width)]
  }
  const out: Span[] = []
  let left = cells
  for (const span of line) {
    if (left <= 0) {
      break
    }
    const head = headCells(span.text, left)
    out.push({ ...span, text: head })
    left -= cellWidth(head)
  }
  // A wide character that would cross the edge leaves a gap: fill it.
  return left > 0 ? [...out, spaces(left)] : out
}

/** Splits a string at its newlines into one span per line, in one style. */
function textLines(text: string, style: Style): Block {
  return text.split('\n').map(part => [{ text: part, ...style }])
}

/**
 * Joins inline parts left to right, the way a Text joins its children: a
 * newline inside a part starts a new line.
 */
function joinInline(parts: Block[]): Block {
  const out: Block = [[]]
  for (const part of parts) {
    part.forEach((line, i) => {
      if (i > 0) {
        out.push([])
      }
      out[out.length - 1]!.push(...line)
    })
  }

  return out
}

/** Stacks blocks top to bottom with `gap` empty lines between them. */
function stack(blocks: Block[], gap: number): Block {
  const out: Block = []
  blocks.forEach((block, i) => {
    if (i > 0) {
      for (let k = 0; k < gap; k += 1) {
        out.push([])
      }
    }
    out.push(...block)
  })

  return out
}

/**
 * Lays blocks side by side, as `beside` does, but starts a new line of them
 * where the next block would pass `cells`; `gap` cells between them on a
 * line, and `rowGap` empty lines between lines of them.
 */
function wrapBeside(blocks: Block[], gap: number, rowGap: number, cells: number): Block {
  const rows: Block[][] = [[]]
  let used = 0
  for (const block of blocks) {
    const width = blockWidth(block)
    const row = rows[rows.length - 1]!
    const next = row.length === 0 ? width : used + gap + width
    if (row.length > 0 && next > cells) {
      rows.push([block])
      used = width
    } else {
      row.push(block)
      used = next
    }
  }

  return stack(
    rows.map(row => beside(row, gap)),
    rowGap,
  )
}

/**
 * Lays blocks side by side with `gap` cells between them: each block is
 * padded to its own widest line, and to the height of the tallest block.
 */
function beside(blocks: Block[], gap: number): Block {
  const height = blocks.reduce((max, block) => Math.max(max, block.length), 0)
  const out: Block = []
  for (let row = 0; row < height; row += 1) {
    const line: Span[] = []
    blocks.forEach((block, i) => {
      if (i > 0 && gap > 0) {
        line.push(spaces(gap))
      }
      // The last block needs no padding: trailing space is trimmed anyway.
      const cells = i === blocks.length - 1 ? lineWidth(block[row] ?? []) : blockWidth(block)
      line.push(...fit(block[row] ?? [], cells))
    })
    out.push(line)
  }

  return out
}

/** The style a Text or Button gives what it holds. */
function styleOf(props: Props, parent: Style): Style {
  return {
    dim: typeof props.dimColor === 'boolean' ? props.dimColor : parent.dim,
    ring: parent.ring || props.autoFocus === true,
    off: parent.off || (typeof props.color === 'string' && OFF_COLORS.has(props.color)),
  }
}

/** Whether an element is a Box placed out of the flow. */
function isPlaced(node: RenderNode): boolean {
  return typeof node === 'object' && node.type === 'Box' && (node as Loose).props?.position === 'absolute'
}

/** Adds the margin and padding of a Box around its block. */
function frame(block: Block, props: Props): Block {
  const all = num(props.margin) + num(props.padding)
  const x = num(props.marginX) + num(props.paddingX)
  const y = num(props.marginY) + num(props.paddingY)
  const top = all + y + num(props.marginTop) + num(props.paddingTop)
  const bottom = all + y + num(props.marginBottom) + num(props.paddingBottom)
  const left = all + x + num(props.marginLeft) + num(props.paddingLeft)
  const right = all + x + num(props.marginRight) + num(props.paddingRight)
  let out = block
  if (left > 0 || right > 0) {
    const inner = blockWidth(out)
    out = out.map(line => [spaces(left), ...fit(line, inner), spaces(right)])
  }

  return [...Array.from({ length: top }, (): Span[] => []), ...out, ...Array.from({ length: bottom }, (): Span[] => [])]
}

/** The text of a Client's props.runs, when it carries runs. */
function clientText(props: Props): string {
  const inner = props.props
  if (typeof inner === 'object' && inner !== null && Array.isArray((inner as Props).runs)) {
    return ((inner as Props).runs as unknown[])
      .map(run => (typeof run === 'object' && run !== null && typeof (run as Props).text === 'string' ? (run as Props).text : ''))
      .join('')
  }

  return '<client>'
}

type Walk = { opts: FlattenOptions; overlay: string[] }

/** The cells a node may take; Infinity when not known. */
type Room = number

/**
 * Any element, read loosely: an engine node (`{ type: 'engine', ref }`) has
 * no props or children, and prints as `<engine>`.
 */
type Loose = { type: string; props?: Props; children?: readonly RenderNode[] }

/** Lays out one node as a block in the parent's style. */
function layout(drawn: RenderNode, style: Style, walk: Walk, room: Room): Block {
  if (typeof drawn === 'string') {
    return textLines(drawn, style)
  }
  const node = drawn as Loose
  const props = (node.props ?? {}) as Props
  const children = (node.children ?? []) as RenderNode[]
  switch (node.type) {
    case 'Box': {
      if (props.display === 'none') {
        return []
      }
      const isRow = props.flexDirection !== 'column' && props.flexDirection !== 'column-reverse'
      const flow = children.filter(child => {
        if (!isPlaced(child)) {
          return true
        }
        const placed = child as Loose
        const at = `@${num(placed.props?.top)},${num(placed.props?.left)}: `
        const inFlow = { ...placed, props: { ...placed.props, position: 'relative' } }
        for (const line of layout(inFlow as unknown as RenderNode, style, walk, room)) {
          walk.overlay.push(at + serialize(line, walk.opts))
        }

        return false
      })
      const all = num(props.margin) + num(props.padding)
      const sides = 2 * all + 2 * (num(props.marginX) + num(props.paddingX))
        + num(props.marginLeft) + num(props.paddingLeft) + num(props.marginRight) + num(props.paddingRight)
      const inner = (typeof props.width === 'number' ? num(props.width) : room) - sides
      const blocks = flow.map(child => layout(child, style, walk, inner))
      const gap = num(props.gap) + num(isRow ? props.columnGap : props.rowGap)
      let block = !isRow
        ? stack(blocks, gap)
        : props.flexWrap === 'wrap'
          ? wrapBeside(blocks, gap, num(props.gap) + num(props.rowGap), inner)
          : beside(blocks, gap)
      if (typeof props.width === 'number') {
        const width = num(props.width)
        block = block.map(line => fit(line, width))
      }

      return frame(block, props)
    }
    case 'Text':
    case 'Link':
    case 'Shader': {
      const inner = styleOf(props, style)

      return joinInline(children.map(child => layout(child, inner, walk, room)))
    }
    case 'Button': {
      const inner = styleOf(props, style)
      const mark = props.plain === true && typeof props.hotkey === 'string' ? `${props.hotkey}: ` : ''
      const label = typeof props.label === 'string' ? props.label : ''
      if (walk.opts.surface === 'desktop') {
        return textLines(typeof props.hotkey === 'string' ? `${props.hotkey}: ${label}` : label, inner)
      }
      if (children.length === 0) {
        return textLines(mark + label, inner)
      }

      return joinInline([[[{ text: mark, ...inner }]], ...children.map(child => layout(child, inner, walk, room))])
    }
    case 'Code':
      return textLines(String(props.source ?? ''), style)
    case 'Markdown':
      return textLines(String(props.text ?? ''), styleOf(props, style))
    case 'Svg':
      return textLines('<svg>', style)
    case 'Client':
      return textLines(clientText(props), style)
    case 'Input':
    case 'Select':
      return textLines(`<${node.type.toLowerCase()} ${String(props.label ?? props.key ?? '')}>`, style)
    default:
      return textLines(`<${node.type.toLowerCase()}>`, style)
  }
}

/** Drops spaces at the end of a line, so padding never shows as text. */
function trimEnd(line: Span[]): Span[] {
  const out = line.map(span => ({ ...span }))
  while (out.length > 0) {
    const last = out[out.length - 1]!
    last.text = last.text.replace(/ +$/, '')
    if (last.text !== '') {
      break
    }
    out.pop()
  }

  return out
}

/** One line as text, with the marks when asked for. */
function serialize(line: Span[], opts: FlattenOptions): string {
  const spans = trimEnd(line).filter(span => span.text !== '')
  if (opts.marks !== true) {
    return spans.map(span => span.text).join('')
  }
  let out = ''
  let ring = false
  let off = false
  let dim = false
  for (const span of spans) {
    if (span.ring !== ring) {
      // The ring mark is outer: close the runs inside it first.
      if (dim) {
        out += DIM_CLOSE
        dim = false
      }
      if (off) {
        out += OFF_CLOSE
        off = false
      }
      out += span.ring ? RING_OPEN : RING_CLOSE
      ring = span.ring
    }
    if (span.off !== off) {
      // The off mark holds the dim mark: close a dim run inside it first.
      if (dim) {
        out += DIM_CLOSE
        dim = false
      }
      out += span.off ? OFF_OPEN : OFF_CLOSE
      off = span.off
    }
    if (span.dim !== dim) {
      out += span.dim ? DIM_OPEN : DIM_CLOSE
      dim = span.dim
    }
    out += span.text
  }

  return out + (dim ? DIM_CLOSE : '') + (off ? OFF_CLOSE : '') + (ring ? RING_CLOSE : '')
}

/**
 * The drawing as text lines, as a person reads them, plus the placed Boxes.
 *
 * A Box with flexDirection row (the default) joins its children left to
 * right, each padded to its widest line; a column Box stacks them. Gap,
 * margin and padding add space; a numeric width pads or cuts. With
 * `columns`, a row Box with flexWrap 'wrap' breaks onto new lines. A Box with
 * position absolute goes to `overlay`. Text joins its children; Code prints
 * its source, Markdown its text, Svg `<svg>`, a Client the text of its runs.
 * Spaces at the end of a line are dropped.
 */
export function flattenAll(tree: RenderNode, opts: FlattenOptions = {}): Flat {
  const walk: Walk = { opts, overlay: [] }
  const block = layout(tree, { dim: false, ring: false, off: false }, walk, opts.columns ?? Number.POSITIVE_INFINITY)

  return { lines: block.map(line => serialize(line, opts)), overlay: walk.overlay }
}

/** The lines of the drawing, without the placed Boxes. See `flattenAll`. */
export function flatten(tree: RenderNode, opts: FlattenOptions = {}): string[] {
  return flattenAll(tree, opts).lines
}

/**
 * The cell column where each part starts in a line, searched in order, each
 * after the last; -1 for a part that is not there (and for all after it).
 */
export function columnsOf(line: string, ...parts: string[]): number[] {
  let from = 0
  let lost = false

  return parts.map(part => {
    const at = lost ? -1 : line.indexOf(part, from)
    if (at < 0) {
      lost = true

      return -1
    }
    from = at + part.length

    return cellWidth(line.slice(0, at))
  })
}

// ---------------------------------------------------------------------------
// session and mount
// ---------------------------------------------------------------------------

export const START = { cwd: '/home/user/project', surface: 'terminal', isInteractive: true } as const
export const GLOBAL_MD = '/home/user/.claude/CLAUDE.md'

export type SessionOptions = {
  /** What `$.session.usage` answers. */
  usage?: SessionUsage
  /** What `$.session.messages` answers; null to refuse. */
  messages?: readonly unknown[] | null
  /** What `$.fs.read` answers, by path. */
  files?: Record<string, string>
  /** The theme `$.config.list` reports; null for none. */
  theme?: string | null
}

/** The critique's session: 283k of 1M, ten level-1 rows, twelve results. */
export function real(): SessionOptions {
  return realSession()
}

/** The invented chat with one item of each kind, and its files on disk. */
export function chat(): SessionOptions {
  return {
    usage: richUsage(),
    messages: CHAT,
    files: { [NOTES]: 'alpha\nbeta\n', [PROJECT_MD]: `${PROJECT_TEXT}\n`, [GLOBAL_MD]: 'Be brief.\n' },
  }
}

/**
 * A started, measured session: the fixtures' world, set as asked, then
 * `session.start` and one tick of the clock so the first measure lands.
 */
export async function session($: Engine, on: On, opts: SessionOptions = {}): Promise<World> {
  const w = world(on)
  if (opts.usage !== undefined) {
    w.usage = opts.usage
  }
  if (opts.messages !== undefined) {
    w.messages = opts.messages
  }
  if (opts.files !== undefined) {
    w.files = { ...opts.files }
  }
  if (opts.theme !== undefined) {
    w.theme = opts.theme
  }
  await $.session.start(START)
  await w.clock.advance(0)

  return w
}

type PaneProps = RenderPropsOf['Pane']

/** What the helpers need of a mounted pane; `$.ui.mount` gives more. */
export type PaneUi = {
  drawn: () => Promise<RenderElement>
  findAll: (query: { type?: string; key?: string }) => Promise<{ key: string | undefined; props: Record<string, unknown> }[]>
  press: (target: { key: string }) => Promise<unknown>
  redraw(props?: PaneProps): Promise<void>
  unmount: () => Promise<void>
}

/** The props each pane drawing was last given, so `setFocus` can change one. */
const PROPS = new WeakMap<object, PaneProps>()

export type MountOptions = {
  /** The pane's width in cells; 80 when absent. */
  columns?: number
  /** Whether the pane holds the keyboard; false when absent. */
  isFocused?: boolean
  /** The rows the pane shows; 40 when absent. */
  rows?: number
}

/** Mounts the pane at level 1 on a surface, and keeps its props for `setFocus`. */
export async function mountPane<S extends 'terminal' | 'desktop'>($: Engine, surface: S, opts: MountOptions = {}) {
  const props = {
    ...PANE.props,
    isFocused: opts.isFocused ?? false,
    bodyColumns: opts.columns ?? PANE.props.bodyColumns,
    scroll: { offset: 0, bodyRows: opts.rows ?? PANE.props.scroll.bodyRows },
  } satisfies PaneProps
  const mounted = await $.ui.mount({ ...PANE, surface, props })
  // A redraw with new props can give or take the keyboard too, so it keeps
  // them. The mounted object is frozen: a view over it wraps its redraw.
  const redraw = async (next?: PaneProps) => {
    if (next !== undefined) {
      PROPS.set(ui, next)
    }

    return mounted.redraw(next)
  }
  const ui = new Proxy({} as typeof mounted, {
    get: (_, name) => {
      if (name === 'redraw') {
        return redraw
      }
      const value: unknown = Reflect.get(mounted, name)

      return typeof value === 'function' ? value.bind(mounted) : value
    },
  })
  PROPS.set(ui, props)

  return ui
}

/**
 * Gives the pane the keyboard or takes it away, as the engine does on Tab
 * into the pane or Escape out of it: one redraw with the next `isFocused`.
 */
export async function setFocus(ui: PaneUi, isFocused: boolean): Promise<void> {
  const props = PROPS.get(ui)
  if (props === undefined) {
    throw new Error('setFocus needs a pane mounted by mountPane')
  }
  const next = { ...props, isFocused }
  PROPS.set(ui, next)
  await ui.redraw(next)
}

// ---------------------------------------------------------------------------
// acts
// ---------------------------------------------------------------------------

/** Presses the Button keyed `key` and returns the drawing after, flattened. */
export async function tap(ui: PaneUi, key: string, opts: FlattenOptions = {}): Promise<string[]> {
  await ui.press({ key })

  return flatten(await ui.drawn(), opts)
}

/** The key of the Button that holds the ring (the first drawn autoFocus), if any. */
export async function ringOf(ui: PaneUi): Promise<string | undefined> {
  return (await ui.findAll({ type: 'Button' })).find(button => button.props.autoFocus === true)?.key
}

/**
 * The hotkeys the drawing gives its Buttons, in drawing order. A key held
 * by two Buttons shows twice: one press would reach only one of them.
 */
export async function hotkeysOf(ui: PaneUi): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' }))
    .map(button => button.props.hotkey)
    .filter((key): key is string => typeof key === 'string')
}

/**
 * Presses key `ch` as the engine does: the Button whose hotkey is `ch` in
 * the current drawing. It throws when two Buttons hold `ch`, as the engine
 * would press only one of them. With no such Button it does nothing and
 * returns false. It also does nothing and returns false while the pane does
 * not hold the keyboard (mounted or redrawn with `isFocused` false), even
 * where a Button with that hotkey is drawn: a desktop draws the hotkeys in
 * both states, and a hotkey presses only while the pane holds the keys.
 */
export async function hotkey(ui: PaneUi, ch: string): Promise<boolean> {
  const held = (await ui.findAll({ type: 'Button' })).filter(button => button.props.hotkey === ch)
  if (held.length > 1) {
    throw new Error(`hotkey ${ch} is held by ${held.length} Buttons: ${held.map(button => button.key).join(', ')}`)
  }
  const key = held[0]?.key
  if (key === undefined || PROPS.get(ui)?.isFocused === false) {
    return false
  }
  await ui.press({ key })

  return true
}

/**
 * Presses key `ch` `n` times, each press settled before the next. Returns
 * how many presses found a Button; it stops at the first that did not.
 */
export async function hold(ui: PaneUi, ch: string, n: number): Promise<number> {
  for (let k = 0; k < n; k += 1) {
    if (!(await hotkey(ui, ch))) {
      return k
    }
  }

  return n
}

type Drawn = { key?: string; props: Record<string, unknown>; children?: readonly unknown[] }
const isDrawn = (x: unknown): x is Drawn => typeof x === 'object' && x !== null && 'props' in x

/**
 * The row the terminal draws lit: the one whose figures stand at full
 * strength. Undefined when none is lit, 'several' when more than one is.
 * The desktop lights no row, so there it says nothing.
 */
export async function litRow(ui: PaneUi): Promise<string | undefined> {
  const rows = (await ui.findAll({ type: 'Button' })).filter(button => /^(row|item)-/.test(button.key ?? '')) as Drawn[]
  const lit = rows.filter(row => (row.children ?? []).some(child => isDrawn(child) && child.props.tabular === true && child.props.dimColor === false))

  return lit.length === 1 ? lit[0]!.key : lit.length === 0 ? undefined : 'several'
}

/** The keys of the rows that open, in drawing order. */
export async function rowsOf(ui: PaneUi): Promise<string[]> {
  return (await ui.findAll({ type: 'Button' })).map(button => button.key ?? '').filter(key => /^(row|item)-/.test(key))
}

/**
 * Records the rows the mod puts the ring on, in order: each write of its
 * ring record (the `ring` state value), which it makes for every j, k or
 * arrow move just before it asks `$.ui.focus` for that row. Register it
 * before the session starts. The kit has no answer for a mod's own
 * `$.ui.focus` (it rejects: "no implementation for ui.focus", and no hook
 * of a test hears the call), so this record is what a test can see of the
 * focus requests, on the desktop as on the terminal.
 */
export function ringWrites(on: On): string[] {
  const keys: string[] = []
  on('state.set', async (_, e, next) => {
    if (e.plugin === 'context-breakdown' && e.key === 'ring') {
      const value = (e.value as { value?: unknown } | undefined)?.value
      keys.push(typeof value === 'string' ? value : String(value))
    }

    return next(e)
  })

  return keys
}
