// docs/trading-rules/order-block.md 2·3·4·5절(일반 Bullish/Bearish OB, 몸통 계산, 작도 규칙)을
// 그대로 보호하기 위한 회귀 테스트. detectOrderBlocks() 자체는 이 파일에서 절대 수정하지 않고,
// 이미 구현된 규칙이 계속 지켜지는지만 검증한다. 오늘 실제 API 데이터(005930 등)로 교차검증한
// 구조(이전 반대방향 캔들의 몸통만 OB 영역, wick 제외)를 작고 명확한 숫자로 재현한 fixture를 쓴다.
import { describe, expect, it } from 'vitest'
import { detectOrderBlocks } from './orderBlock.js'

describe('detectOrderBlocks - Bearish OB (문서 3절)', () => {
  it('이전 양봉을 다음 음봉이 몸통 기준으로 engulfing하면 bearish OB를 만든다', () => {
    const candles = [
      // OB candle: 양봉, 몸통 100~105, wick은 98~106(몸통보다 넓음)
      { timestamp: 't0', open: 100, high: 106, low: 98, close: 105 },
      // confirmation candle: 음봉, 몸통 95~106이 이전 몸통(100~105)을 100% engulfing
      { timestamp: 't1', open: 106, high: 108, low: 90, close: 95 },
    ]

    const result = detectOrderBlocks(candles)

    expect(result).toHaveLength(1)
    const ob = result[0]
    expect(ob.type).toBe('bearish')
    expect(ob.index).toBe(1)
    // OB 영역은 반드시 이전 양봉의 BODY 기준(open/close), wick(98/106)이 아니다.
    expect(ob.obHigh).toBe(105)
    expect(ob.obLow).toBe(100)
  })

  it('경계 가격이 정확히 같아도(>=, <=) engulfing으로 인정한다 (문서 3절 "같은 가격 포함")', () => {
    const candles = [
      { timestamp: 't0', open: 100, high: 105, low: 100, close: 105 },
      // confirmation의 몸통 경계가 previous와 정확히 동일(105~100)
      { timestamp: 't1', open: 105, high: 106, low: 99, close: 100 },
    ]

    const result = detectOrderBlocks(candles)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('bearish')
    expect(result[0].obHigh).toBe(105)
    expect(result[0].obLow).toBe(100)
  })
})

describe('detectOrderBlocks - Bullish OB (문서 2절)', () => {
  it('이전 음봉을 다음 양봉이 몸통 기준으로 engulfing하면 bullish OB를 만든다', () => {
    const candles = [
      // OB candle: 음봉, 몸통 100~105, wick은 95~106(몸통보다 넓음)
      { timestamp: 't0', open: 105, high: 106, low: 95, close: 100 },
      // confirmation candle: 양봉, 몸통 99~110이 이전 몸통(100~105)을 100% engulfing
      { timestamp: 't1', open: 99, high: 112, low: 98, close: 110 },
    ]

    const result = detectOrderBlocks(candles)

    expect(result).toHaveLength(1)
    const ob = result[0]
    expect(ob.type).toBe('bullish')
    expect(ob.index).toBe(1)
    // OB 영역은 반드시 이전 음봉의 BODY 기준(open/close), wick(95/106)이 아니다.
    expect(ob.obHigh).toBe(105)
    expect(ob.obLow).toBe(100)
  })

  it('경계 가격이 정확히 같아도(>=, <=) engulfing으로 인정한다 (문서 2절 "같은 가격 포함")', () => {
    const candles = [
      { timestamp: 't0', open: 105, high: 106, low: 99, close: 100 },
      // confirmation의 몸통 경계가 previous와 정확히 동일(105~100)
      { timestamp: 't1', open: 100, high: 107, low: 99, close: 105 },
    ]

    const result = detectOrderBlocks(candles)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('bullish')
    expect(result[0].obHigh).toBe(105)
    expect(result[0].obLow).toBe(100)
  })
})

describe('detectOrderBlocks - 오탐 방지', () => {
  it('engulfing 조건을 만족하지 못하면 OB로 탐지하지 않는다', () => {
    const candles = [
      // OB candle 후보: 음봉, 몸통 100~105
      { timestamp: 't0', open: 105, high: 106, low: 95, close: 100 },
      // 양봉이지만 몸통(101~104)이 이전 몸통(100~105)을 완전히 감싸지 못함
      { timestamp: 't1', open: 101, high: 112, low: 98, close: 104 },
    ]

    expect(detectOrderBlocks(candles)).toEqual([])
  })

  it('방향 조건을 만족하지 못하면(같은 방향이 연속되면) OB로 탐지하지 않는다', () => {
    const candles = [
      // 음봉 -> 음봉(양봉이어야 bullish 성립): 방향 조건 위반
      { timestamp: 't0', open: 105, high: 106, low: 95, close: 100 },
      { timestamp: 't1', open: 100, high: 112, low: 90, close: 92 },
    ]

    expect(detectOrderBlocks(candles)).toEqual([])
  })

  it('몸통이 아닌 wick만 이전 몸통을 감싸는 경우는 OB로 탐지하지 않는다 (engulfing은 몸통 기준)', () => {
    const candles = [
      // OB candle 후보: 음봉, 몸통 100~105
      { timestamp: 't0', open: 105, high: 106, low: 95, close: 100 },
      // wick(high 130, low 80)은 이전 몸통을 완전히 감싸지만, 몸통(101~104)은 감싸지 못함
      { timestamp: 't1', open: 101, high: 130, low: 80, close: 104 },
    ]

    expect(detectOrderBlocks(candles)).toEqual([])
  })

  it('캔들이 2개 미만이면 빈 배열을 반환한다', () => {
    expect(detectOrderBlocks([])).toEqual([])
    expect(detectOrderBlocks([{ timestamp: 't0', open: 1, high: 2, low: 0, close: 1.5 }])).toEqual([])
  })
})
