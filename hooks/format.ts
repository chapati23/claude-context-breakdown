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

/**
 * Formats a share of the window as a whole percent, rounded down so the bar
 * never reads 100% before the window is full; "<1%" for a small share.
 */
export function formatPercent(tokens: number, window: number): string {
  if (!(window > 0) || !(tokens > 0)) {
    return '0%'
  }
  const percent = (tokens / window) * 100
  if (percent < 1) {
    return '<1%'
  }

  return `${Math.floor(percent)}%`
}

/**
 * Formats a pane row's share of the window: one decimal below 10%, so rows
 * of a few percent each still add up to their group's total. Rounded down,
 * like the band's figure; "<0.1%" for a tiny share.
 */
export function formatShare(tokens: number, window: number): string {
  if (!(window > 0) || !(tokens > 0)) {
    return '0%'
  }
  const percent = (tokens / window) * 100
  if (percent >= 10) {
    return `${Math.floor(percent)}%`
  }
  if (percent < 0.1) {
    return '<0.1%'
  }

  // Tenths from whole numbers first: 44,000 of 1,000,000 is 4.4, not 4.3.
  return `${trim(Math.floor((tokens * 1000) / window) / 10, 1)}%`
}
