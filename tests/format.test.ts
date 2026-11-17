import { describe, expect, test } from 'claude-code/testing'

import { formatPercent, formatShare, formatTokens } from '../hooks/format'

describe('formatTokens', () => {
  test('keeps small counts whole', () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(999)).toBe('999')
  })

  test('uses one decimal under ten thousand', () => {
    expect(formatTokens(1000)).toBe('1k')
    expect(formatTokens(9500)).toBe('9.5k')
    expect(formatTokens(9949)).toBe('9.9k')
  })

  test('rounds to whole thousands from ten thousand', () => {
    expect(formatTokens(9950)).toBe('10k')
    expect(formatTokens(95_000)).toBe('95k')
    expect(formatTokens(999_499)).toBe('999k')
  })

  test('uses millions from a million', () => {
    expect(formatTokens(999_500)).toBe('1M')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_200_000)).toBe('1.2M')
    expect(formatTokens(12_400_000)).toBe('12M')
  })

  test('treats a negative or broken count as zero', () => {
    expect(formatTokens(-5)).toBe('0')
    expect(formatTokens(Number.NaN)).toBe('0')
  })
})

describe('formatPercent', () => {
  test('rounds to the nearest, as the status line does, and marks a small share', () => {
    // 109k and 116k of 1M: the status line reads 11% and 12%.
    expect(formatPercent(109_000, 1_000_000)).toBe('11%')
    expect(formatPercent(116_000, 1_000_000)).toBe('12%')
    expect(formatPercent(114_000, 1_000_000)).toBe('11%')
    expect(formatPercent(95_000, 1_000_000)).toBe('10%')
    expect(formatPercent(5000, 1_000_000)).toBe('1%')
    expect(formatPercent(2000, 1_000_000)).toBe('<1%')
    expect(formatPercent(1, 1_000_000)).toBe('<1%')
    expect(formatPercent(0, 1_000_000)).toBe('0%')
    expect(formatPercent(10, 0)).toBe('0%')
    expect(formatPercent(1_200_000, 1_000_000)).toBe('120%')
  })

  test('never reads 100% before the window is full', () => {
    expect(formatPercent(996_000, 1_000_000)).toBe('99%')
    expect(formatPercent(999_999, 1_000_000)).toBe('99%')
    expect(formatPercent(1_000_000, 1_000_000)).toBe('100%')
  })
})

describe('formatShare', () => {
  test('shows one decimal below 10%, so small rows add up to their group', () => {
    // 46k and 44k of 1M are 4.6% and 4.4%: together the 9% of 90k.
    expect(formatShare(46_000, 1_000_000)).toBe('4.6%')
    expect(formatShare(44_000, 1_000_000)).toBe('4.4%')
    // A whole number keeps its decimal, so the share column lines up.
    expect(formatShare(20_000, 1_000_000)).toBe('2.0%')
    expect(formatShare(10_400, 1_000_000)).toBe('1.0%')
    expect(formatShare(400, 1_000_000)).toBe('<0.1%')
    expect(formatShare(500, 1_000_000)).toBe('0.1%')
    expect(formatShare(0, 1_000_000)).toBe('0%')
    expect(formatShare(10, 0)).toBe('0%')
  })

  test('rounds to the nearest, so rows add up to their group within rounding', () => {
    expect(formatShare(877_000, 1_000_000)).toBe('88%')
    expect(formatShare(312_000, 1_000_000)).toBe('31%')
    expect(formatShare(18_000, 1_000_000)).toBe('1.8%')
    expect(formatShare(18_460, 1_000_000)).toBe('1.8%')
    expect(formatShare(18_460 + 90, 1_000_000)).toBe('1.9%')
    // 9.96% rounds to 10.0 tenths: shown as a whole percent, not "10.0%".
    expect(formatShare(99_600, 1_000_000)).toBe('10%')
    // A row that is almost all of its group is not shown as all of it.
    expect(formatShare(996_000, 1_000_000)).toBe('99%')
    expect(formatShare(1_000_000, 1_000_000)).toBe('100%')
  })
})
