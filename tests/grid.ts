// Reads the pane that the surfaces other than the terminal draw (grid.tsx):
// its rows as short lines of text, without laying anything out.

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }

export const isNode = (x: unknown): x is Node => typeof x === 'object' && x !== null && 'type' in x

/** The text a node holds: its strings, a Button's label, nothing for a picture. */
export function textOf(x: unknown): string {
  if (typeof x === 'string') {
    return x
  }
  if (!isNode(x)) {
    return ''
  }
  if (x.type === 'Button') {
    return typeof x.props?.label === 'string' ? x.props.label : ''
  }

  return (x.children ?? []).map(textOf).join('')
}

/** Every node of `tree`, in drawing order. */
export function nodesOf(tree: unknown): Node[] {
  if (!isNode(tree)) {
    return []
  }

  return [tree, ...(tree.children ?? []).flatMap(nodesOf)]
}

/**
 * Whether `node` is one row of the grid: a row Box whose first child takes
 * the room left of the fixed columns.
 */
export function isGridRow(node: Node): boolean {
  const first = (node.children ?? []).find(isNode)

  return (
    node.type === 'Box' &&
    node.props?.flexDirection === 'row' &&
    node.props?.alignItems === 'center' &&
    node.props?.columnGap === 1 &&
    first !== undefined &&
    first.type === 'Box' &&
    first.props?.flexGrow === 1
  )
}

/** The rows of the grid in `tree`. */
export function gridRowsOf(tree: unknown): Node[] {
  return nodesOf(tree).filter(isGridRow)
}

/**
 * A grid row as a line: the names on its left, then each column on its
 * right, one space apart. A length bar reads `▬`, an empty column nothing.
 * "Tool results ▬ 30k 45%".
 */
export function rowLine(row: Node): string {
  const [left, ...right] = (row.children ?? []).filter(isNode)
  const names = nodesOf(left)
    .filter(node => node.type === 'Button' || (node.type === 'Text' && (node.children ?? []).some(child => typeof child === 'string')))
    .map(textOf)
    .filter(text => text !== '')
  const columns = right.map(part => (nodesOf(part).some(node => node.type === 'Svg') ? '▬' : textOf(part))).filter(text => text !== '')

  return [...names, ...columns].join(' ')
}

/** Every grid row of `tree` as a line (`rowLine`). */
export function gridLines(tree: unknown): string[] {
  return gridRowsOf(tree).map(rowLine)
}

/** The grid row that holds the Button keyed `key`. */
export function gridRowWith(tree: unknown, key: string): Node | undefined {
  return gridRowsOf(tree).find(row => nodesOf(row).some(node => node.type === 'Button' && node.props?.key === key))
}

/** The fixed columns of a grid row, right of its names: each a Box of a width in cells. */
export function rightColumns(row: Node): Node[] {
  return (row.children ?? []).filter(isNode).slice(1)
}
