// trading-rules/breakout.md의 구조/거래량/시간축/추세선/돌파/진입/손절 규칙(4~14절, 핵심 판정
// 로직 블록)을 그대로 보호하는 회귀 테스트. detectBreakoutState()/isStructureValid() 자체는
// 이 파일에서 수정하지 않고, 이미 구현된 규칙이 계속 지켜지는지만 검증한다.
import { describe, expect, it } from 'vitest'
import { detectBreakoutState, isStructureValid } from './breakout.js'

describe('isStructureValid - 핵심 판정 로직(문서 맨 끝 블록)', () => {
  it('A: H2 > H1, Volume(H2) > Volume(H1), 100캔들 이하 → 구조 유효', () => {
    expect(
      isStructureValid({
        h1Price: 100,
        h1Volume: 1000,
        h2Price: 108,
        h2Volume: 1500,
        distance: 50,
        trendlineSlope: 0.16,
        lMaintained: true,
      }),
    ).toBe(true)
  })

  it('B: H2 <= H1 → INVALID', () => {
    expect(
      isStructureValid({
        h1Price: 100,
        h1Volume: 1000,
        h2Price: 100,
        h2Volume: 1500,
        distance: 50,
        trendlineSlope: 0,
        lMaintained: true,
      }),
    ).toBe(false)
  })

  it('C: H2 > H1이지만 Volume(H2) <= Volume(H1) → 해당 고점은 H2가 아님(구조 무효)', () => {
    expect(
      isStructureValid({
        h1Price: 100,
        h1Volume: 1000,
        h2Price: 103,
        h2Volume: 700,
        distance: 10,
        trendlineSlope: 0.3,
        lMaintained: true,
      }),
    ).toBe(false)
  })
})

describe('detectBreakoutState - H1/H2/L 구조 탐지', () => {
  it('A: 유효한 H1-H2 구조가 완성되면 WAITING_FOR_BREAKOUT(구조 유효, 아직 진입 아님)', () => {
    const candles = [
      { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }, // H1 후보
      { timestamp: 't1', open: 98, high: 90, low: 85, close: 94, volume: 800 }, // 다음 봉 high 하락 -> t0가 H1
      { timestamp: 't2', open: 104, high: 108, low: 92, close: 107, volume: 1500 }, // price/volume 모두 H1 초과 -> H2 확정
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('WAITING_FOR_BREAKOUT')
    expect(result.h1).toMatchObject({ index: 0, price: 100, volume: 1000 })
    expect(result.h2).toMatchObject({ index: 2, price: 108, volume: 1500 })
  })

  it('D: 중간 고점이 거래량 조건 탈락 후, 100캔들 이내 가격/거래량 모두 만족하는 고점이 final H2', () => {
    const candles = [
      { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }, // H1
      { timestamp: 't1', open: 98, high: 97, low: 93, close: 94, volume: 800 }, // H1 확정용 다음 봉
      { timestamp: 't2', open: 95, high: 103, low: 92, close: 102, volume: 700 }, // price>H1이지만 volume<H1 -> 중간 고점(거절)
      { timestamp: 't3', open: 100, high: 101, low: 90, close: 98, volume: 750 }, // 역시 volume 부족 -> 거절
      { timestamp: 't4', open: 104, high: 108, low: 99, close: 107, volume: 1500 }, // price/volume 모두 충족 -> final H2
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('WAITING_FOR_BREAKOUT')
    // 중간에 거절된 고점들 때문에 H1이 바뀌지 않았어야 한다.
    expect(result.h1).toMatchObject({ index: 0, price: 100 })
    expect(result.h2).toMatchObject({ index: 4, price: 108, volume: 1500 })
    expect(result.l).toBe(90) // H1~final H2 구간 전체 최저 low
  })

  it('E: final H2가 H1에서 100캔들 초과 → INVALID', () => {
    const h1Candle = { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }
    // t0 이후 101개 캔들(H1~해당 캔들 거리가 1~101)을 전부 H1보다 낮은 고점으로 채운다.
    const fillers = Array.from({ length: 101 }, (_, i) => ({
      timestamp: `f${i}`,
      open: 90,
      high: 90,
      low: 80,
      close: 88,
      volume: 500,
    }))
    const lateCandle = {
      // 인덱스 102, H1(인덱스 0)과 거리 102 > 100 -> 가격/거래량이 충족돼도 확정 불가
      timestamp: 'late',
      open: 105,
      high: 110,
      low: 95,
      close: 109,
      volume: 1500,
    }

    const result = detectBreakoutState([h1Candle, ...fillers, lateCandle])

    expect(result.status).toBe('INVALID')
  })

  it('F: H1~final H2 사이 여러 저점 중 가장 낮은 low가 L', () => {
    const candles = [
      { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }, // H1
      { timestamp: 't1', open: 92, high: 90, low: 85, close: 88, volume: 700 },
      { timestamp: 't2', open: 88, high: 92, low: 70, close: 90, volume: 600 }, // 가장 낮은 low
      { timestamp: 't3', open: 90, high: 95, low: 88, close: 93, volume: 650 },
      { timestamp: 't4', open: 105, high: 110, low: 91, close: 109, volume: 1500 }, // final H2
    ]

    const result = detectBreakoutState(candles)

    expect(result.l).toBe(70)
  })

  it('G: H2 이후 대기 중 price가 L을 하회하면 INVALID', () => {
    const candles = [
      { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }, // H1
      { timestamp: 't1', open: 92, high: 90, low: 85, close: 88, volume: 700 }, // L 후보(85)
      { timestamp: 't2', open: 104, high: 108, low: 92, close: 107, volume: 1500 }, // H2 확정, L = min(94,85,92) = 85
      { timestamp: 't3', open: 90, high: 95, low: 80, close: 82, volume: 900 }, // low 80 < L(85) -> INVALID
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('INVALID')
  })
})

describe('detectBreakoutState - 돌파/진입', () => {
  // 공통 기반: H1(index0, price100) - H2(index2, price108) 확정까지는 동일하고,
  // 이후 돌파봉만 시나리오별로 바꾼다. 추세선 값(index3) = 100 + slope*3, slope=(108-100)/2=4 -> 112.
  const base = [
    { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }, // H1
    { timestamp: 't1', open: 92, high: 90, low: 85, close: 88, volume: 700 },
    { timestamp: 't2', open: 104, high: 108, low: 92, close: 107, volume: 1500 }, // H2 확정
  ]

  it('H: 꼬리만 추세선을 넘으면(몸통은 아래) NO ENTRY', () => {
    const candles = [
      ...base,
      // 추세선(112) 위로 high(115)는 넘지만 몸통(min(105,106)=105)은 아래 -> 진입 아님
      { timestamp: 't3', open: 105, high: 115, low: 100, close: 106, volume: 2000 },
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('WAITING_FOR_BREAKOUT')
    expect(result.entryIndex).toBeNull()
  })

  it('I: 몸통은 돌파했지만 Volume(Breakout) <= Volume(H2) → NO ENTRY', () => {
    const candles = [
      ...base,
      // 몸통 min(113,118)=113 > 112(추세선)이지만 volume(1400) <= H2 volume(1500)
      { timestamp: 't3', open: 113, high: 120, low: 110, close: 118, volume: 1400 },
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('WAITING_FOR_BREAKOUT')
    expect(result.entryIndex).toBeNull()
  })

  it('J: 몸통 전체가 추세선 위에서 마감 AND Volume(Breakout) > Volume(H2) → ENTRY_VALID', () => {
    const candles = [
      ...base,
      { timestamp: 't3', open: 113, high: 120, low: 110, close: 118, volume: 2000 },
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('ENTRY_VALID')
    expect(result.entryIndex).toBe(3)
  })

  it('K: 진입 이후 꼬리만 추세선 아래로 내려간 경우 STOP LOSS 아님', () => {
    const candles = [
      ...base,
      { timestamp: 't3', open: 113, high: 120, low: 110, close: 118, volume: 2000 }, // ENTRY_VALID(index3)
      // index4 추세선 값 = 100+4*4 = 116. low(90)는 아래지만 몸통 max(114,117)=117 > 116 -> 손절 아님
      { timestamp: 't4', open: 114, high: 118, low: 90, close: 117, volume: 1800 },
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('ENTRY_VALID')
    expect(result.stopLossIndex).toBeNull()
  })

  it('L: 진입 이후 몸통이 추세선 아래에서 마감하면 STOP LOSS', () => {
    const candles = [
      ...base,
      { timestamp: 't3', open: 113, high: 120, low: 110, close: 118, volume: 2000 }, // ENTRY_VALID(index3)
      // index4 추세선 값 = 116. 몸통 max(114,115)=115 < 116 -> 손절
      { timestamp: 't4', open: 114, high: 117, low: 108, close: 115, volume: 1200 },
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('STOP_LOSS')
    expect(result.stopLossIndex).toBe(4)
  })
})

describe('detectBreakoutState - 오탐 방지/경계', () => {
  it('캔들이 없으면 NO_STRUCTURE를 반환한다', () => {
    expect(detectBreakoutState([])).toMatchObject({ status: 'NO_STRUCTURE', h1: null, h2: null })
  })

  it('H1 후보만 있고 H2 조건을 만족하는 고점이 없으면 WAITING_FOR_H2로 대기한다', () => {
    const candles = [
      { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }, // H1
      { timestamp: 't1', open: 92, high: 90, low: 85, close: 88, volume: 700 },
      { timestamp: 't2', open: 88, high: 95, low: 84, close: 90, volume: 600 }, // price(95) < H1(100) -> 거절
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('WAITING_FOR_H2')
    expect(result.h2).toBeNull()
  })

  it('A: 다음 캔들이 존재하지 않으면(마지막 캔들) H1을 확정하지 않는다(look-ahead 금지)', () => {
    const candles = [
      { timestamp: 't0', open: 85, high: 90, low: 80, close: 88, volume: 900 },
      { timestamp: 't1', open: 92, high: 100, low: 91, close: 99, volume: 1000 }, // 가장 높은 고점이지만 다음 봉이 없음
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('NO_STRUCTURE')
    expect(result.h1).toBeNull()
  })

  it('B: next.high === current.high(동일)면 H1로 확정하지 않는다 (strictly lower만 인정)', () => {
    const candles = [
      { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }, // 다음 봉과 high가 같음 -> H1 아님
      { timestamp: 't1', open: 96, high: 100, low: 93, close: 98, volume: 900 }, // 다음 봉(95)이 진짜로 더 낮음 -> 이 봉이 H1
      { timestamp: 't2', open: 90, high: 95, low: 88, close: 91, volume: 800 },
    ]

    const result = detectBreakoutState(candles)

    expect(result.h1).toMatchObject({ index: 1, price: 100 })
  })

  it('C: H1~H2 거리가 정확히 100캔들이면 여전히 유효 범위(초과 아님)', () => {
    const h1Candle = { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }
    // t0 이후 99개 필러(인덱스 1~99) -> 다음 확정 캔들(인덱스 100)과의 거리는 정확히 100.
    const fillers = Array.from({ length: 99 }, (_, i) => ({
      timestamp: `f${i}`,
      open: 90,
      high: 90,
      low: 80,
      close: 88,
      volume: 500,
    }))
    const h2Candle = {
      timestamp: 'h2', // 인덱스 100, 거리 100 - 100 <= 100 이므로 유효해야 한다
      open: 105,
      high: 110,
      low: 95,
      close: 109,
      volume: 1500,
    }

    const result = detectBreakoutState([h1Candle, ...fillers, h2Candle])

    expect(result.status).toBe('WAITING_FOR_BREAKOUT')
    expect(result.h2).toMatchObject({ index: 100, price: 110 })
  })

  it('D: H1~H2 거리가 101캔들이면 INVALID(가격/거래량이 충족돼도 확정 불가)', () => {
    const h1Candle = { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }
    // t0 이후 100개 필러(인덱스 1~100) -> 후보(인덱스 101)와의 거리는 101 > 100.
    const fillers = Array.from({ length: 100 }, (_, i) => ({
      timestamp: `f${i}`,
      open: 90,
      high: 90,
      low: 80,
      close: 88,
      volume: 500,
    }))
    const candidate = {
      timestamp: 'over', // 인덱스 101, 거리 101 > 100
      open: 105,
      high: 110,
      low: 95,
      close: 109,
      volume: 1500,
    }

    const result = detectBreakoutState([h1Candle, ...fillers, candidate])

    expect(result.status).toBe('INVALID')
    expect(result.h2).toBeNull()
  })

  it('E: 거래량이 null/undefined인 캔들은 H1/H2/Breakout으로 확정되지 않는다(입력 안전성)', () => {
    const candles = [
      // H1 후보지만 volume이 null -> 이후 비교 기준으로 쓸 수 없으므로 H1로 확정하면 안 된다.
      // (가드가 없다면 null이 숫자 비교에서 0으로 취급되어 다음 H2/Breakout 거래량 비교가
      // 항상 통과해버리는 거짓 신호가 발생한다 - 실제로 가드 적용 전 이 fixture로 재현 확인함.)
      { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: null },
      { timestamp: 't1', open: 92, high: 90, low: 85, close: 88, volume: 800 }, // high(90) < 100 -> 가드 없으면 t0가 H1이 됨
      { timestamp: 't2', open: 104, high: 108, low: 92, close: 107, volume: 1500 }, // 가드 없으면 거짓 H2
      { timestamp: 't3', open: 113, high: 120, low: 110, close: 118, volume: 2000 }, // 가드 없으면 거짓 ENTRY
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('NO_STRUCTURE')
    expect(result.h1).toBeNull()
    expect(result.entryIndex).toBeNull()
  })

  it('E-2: H1은 유효하지만 H2 후보의 거래량이 undefined면 H2로 확정하지 않고 계속 대기한다', () => {
    const candles = [
      { timestamp: 't0', open: 95, high: 100, low: 94, close: 99, volume: 1000 }, // H1
      { timestamp: 't1', open: 92, high: 90, low: 85, close: 88, volume: 700 },
      // price(108) > H1(100)이지만 volume이 undefined -> H2로 확정 금지, 계속 대기해야 한다.
      { timestamp: 't2', open: 104, high: 108, low: 92, close: 107, volume: undefined },
    ]

    const result = detectBreakoutState(candles)

    expect(result.status).toBe('WAITING_FOR_H2')
    expect(result.h2).toBeNull()
  })
})
