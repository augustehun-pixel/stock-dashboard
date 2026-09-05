// docs/trading-rules/order-block.md 9·10·11·12절(무효화/유지/교체 규칙)을 그대로 보호하는
// 회귀 테스트. resolveOrderBlockLifecycle()과 detectOrderBlocks()는 이 파일에서 절대 수정하지
// 않고, 이미 구현된 규칙(무효화 기준 = 꼬리/wick, 몸통이 아님)이 계속 지켜지는지만 검증한다.
import { describe, expect, it } from 'vitest'
import { detectOrderBlocks } from './orderBlock.js'
import { resolveOrderBlockLifecycle } from './orderBlockLifecycle.js'

function resolve(candles) {
  const obs = detectOrderBlocks(candles)
  return { obs, resolved: resolveOrderBlockLifecycle(obs, candles) }
}

describe('resolveOrderBlockLifecycle - Bullish OB', () => {
  it('무효화 기준(referenceLow=OB candle의 꼬리 low)을 깨는 캔들이 없으면 active로 유지한다', () => {
    const candles = [
      { timestamp: 't0', open: 105, high: 106, low: 95, close: 100 }, // OB candle(음봉), 꼬리 low=95
      { timestamp: 't1', open: 99, high: 112, low: 98, close: 110 }, // confirmation(양봉)
      { timestamp: 't2', open: 111, high: 115, low: 105, close: 112 }, // low(105) > 95, 무효화 아님
    ]

    const { resolved } = resolve(candles)

    expect(resolved).toHaveLength(1)
    expect(resolved[0].type).toBe('bullish')
    expect(resolved[0].status).toBe('active')
    expect(resolved[0].endTime).toBeNull()
  })

  it('OB 몸통(obLow)이 아니라 꼬리(referenceLow)를 하향 이탈해야 invalidated된다', () => {
    const candles = [
      { timestamp: 't0', open: 105, high: 106, low: 95, close: 100 }, // OB candle: obLow(몸통)=100, referenceLow(꼬리)=95
      { timestamp: 't1', open: 99, high: 112, low: 98, close: 110 }, // confirmation
      // low=97: obLow(100)보다는 낮지만 referenceLow(95)보다는 높음 -> 아직 무효화되면 안 됨
      { timestamp: 't2', open: 108, high: 110, low: 97, close: 109 },
      // low=90: referenceLow(95)를 하향 이탈 -> 이 시점에 invalidated
      { timestamp: 't3', open: 108.7, high: 109, low: 90, close: 108.3 },
    ]

    const { resolved } = resolve(candles)

    expect(resolved).toHaveLength(1)
    const ob = resolved[0]
    expect(ob.type).toBe('bullish')
    expect(ob.referenceLow).toBe(95)
    expect(ob.obLow).toBe(100)
    // t2(low=97)에서는 아직 살아있어야 하고, t3(low=90)에서 비로소 무효화되어야 한다.
    expect(ob.status).toBe('invalidated')
    expect(ob.endTime).toBe('t3')
  })
})

describe('resolveOrderBlockLifecycle - Bearish OB', () => {
  it('OB 몸통(obHigh)이 아니라 꼬리(referenceHigh)를 상향 돌파해야 invalidated된다', () => {
    const candles = [
      { timestamp: 't0', open: 100, high: 106, low: 98, close: 105 }, // OB candle: obHigh(몸통)=105, referenceHigh(꼬리)=106
      { timestamp: 't1', open: 106, high: 108, low: 90, close: 95 }, // confirmation(음봉)
      // high=105.5: obHigh(105)보다는 높지만 referenceHigh(106)보다는 낮음 -> 아직 무효화 아님
      { timestamp: 't2', open: 96, high: 105.5, low: 94, close: 95 },
      // high=107: referenceHigh(106)를 상향 돌파 -> 이 시점에 invalidated
      { timestamp: 't3', open: 95, high: 107, low: 93, close: 94 },
    ]

    const { resolved } = resolve(candles)

    expect(resolved).toHaveLength(1)
    const ob = resolved[0]
    expect(ob.type).toBe('bearish')
    expect(ob.referenceHigh).toBe(106)
    expect(ob.obHigh).toBe(105)
    expect(ob.status).toBe('invalidated')
    expect(ob.endTime).toBe('t3')
  })
})

describe('resolveOrderBlockLifecycle - 교체(문서 12절: 방향 무관, 최신 OB만 active)', () => {
  it('새로운 OB가 생성되면 기존 active OB는 방향이 달라도 즉시 replaced로 바뀐다', () => {
    const candles = [
      { timestamp: 't0', open: 100, high: 106, low: 98, close: 105 }, // bearish OB candle
      { timestamp: 't1', open: 106, high: 108, low: 90, close: 95 }, // bearish OB 확정 (index 1)
      { timestamp: 't2', open: 95, high: 100, low: 92, close: 97 }, // 무관한 필러 캔들(새 OB 형성 안 됨)
      { timestamp: 't3', open: 50, high: 55, low: 40, close: 45 }, // bullish OB candle
      { timestamp: 't4', open: 44, high: 60, low: 43, close: 52 }, // bullish OB 확정 (index 4) - 기존 bearish를 교체
    ]

    const { resolved } = resolve(candles)

    expect(resolved).toHaveLength(2)
    const bearishOb = resolved.find((ob) => ob.type === 'bearish')
    const bullishOb = resolved.find((ob) => ob.type === 'bullish')

    expect(bearishOb.status).toBe('replaced')
    expect(bearishOb.endTime).toBe('t4')
    expect(bearishOb.replacedBy).toBe(bullishOb.index)

    expect(bullishOb.status).toBe('active')
    expect(bullishOb.endTime).toBeNull()
  })
})
