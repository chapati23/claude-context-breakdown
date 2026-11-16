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
  test('rounds down, and marks a small share', () => {
    expect(formatPercent(95_000, 1_000_000)).toBe('9%')
    expect(formatPercent(2000, 1_000_000)).toBe('<1%')
    expect(formatPercent(0, 1_000_000)).toBe('0%')
    expect(formatPercent(10, 0)).toBe('0%')
    expect(formatPercent(1_200_000, 1_000_000)).toBe('120%')
  })
})

describe('formatShare', () => {
  test('shows one decimal below 10%, so small rows add up to their group', () => {
    // 46k and 44k of 1M are 4.6% and 4.4%: together the 9% of 90k.
    expect(formatShare(46_000, 1_000_000)).toBe('4.6%')
    expect(formatShare(44_000, 1_000_000)).toBe('4.4%')
    expect(formatShare(20_000, 1_000_000)).toBe('2%')
    expect(formatShare(500, 1_000_000)).toBe('<0.1%')
    expect(formatShare(877_000, 1_000_000)).toBe('87%')
    expect(formatShare(0, 1_000_000)).toBe('0%')
    expect(formatShare(10, 0)).toBe('0%')
  })
})
