// Number formatting for estimates: 950, 9.5k, 95k, 1.2M.

function trim(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$/, '')
}

/** Formats a token count in at most four characters plus a unit. */
export function formatTokens(tokens: number): string {
  const n = Number.isFinite(tokens) ? Math.max(0, Math.round(tokens)) : 0

  if (n < 1000) {
    return String(n)
  }
  if (n < 9950) {
    return `${trim(n / 1000, 1)}k`
  }
  if (n < 999_500) {
    return `${Math.round(n / 1000)}k`
  }
  if (n < 9_950_000) {
    return `${trim(n / 1_000_000, 1)}M`
  }

  return `${Math.round(n / 1_000_000)}M`
}

/** A whole count with thousands grouped: 1,230. The same on every machine. */
export function formatCount(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0

  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * A whole percent rounded to the nearest, as Claude Code's status line
 * rounds, but never 100% before `tokens` reach `whole`: a nearly full window
 * still says 99%.
 */
function wholePercent(tokens: number, whole: number): string {
  const rounded = Math.round((tokens / whole) * 100)

  return `${tokens < whole ? Math.min(99, rounded) : rounded}%`
}

/**
 * Formats a share of the window as a whole percent, rounded to the nearest
 * (see `wholePercent`); "<1%" for a share that would round to 0, so a
 * window that holds anything never reads 0%.
 */
export function formatPercent(tokens: number, window: number): string {
  if (!(window > 0) || !(tokens > 0)) {
    return '0%'
  }
  if ((tokens / window) * 100 < 0.5) {
    return '<1%'
  }

  return wholePercent(tokens, window)
}

/**
 * Formats a pane row's share of `whole` (what is used, or the segment): one
 * decimal below 10%, so rows of a few percent each still add up to their
 * group's total. The decimal stays on a whole number ("1.0%"), so a column
 * of shares lines up. Rounded to the nearest, like the band's figure, so the
 * rows of a group add up to it within rounding; "<0.1%" for a share that
 * would round to 0.
 */
export function formatShare(tokens: number, whole: number): string {
  if (!(whole > 0) || !(tokens > 0)) {
    return '0%'
  }
  // Tenths from whole numbers first: 44,000 of 1,000,000 is 4.4, not 4.3.
  const tenths = Math.round((tokens * 1000) / whole)
  if (tenths < 1) {
    return '<0.1%'
  }
  if (tenths < 100) {
    return `${(tenths / 10).toFixed(1)}%`
  }

  return wholePercent(tokens, whole)
}
