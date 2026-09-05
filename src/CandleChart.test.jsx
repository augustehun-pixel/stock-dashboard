// @vitest-environment jsdom
//
// CandleChart.jsx가 activeOrderBlock으로부터 "OB candle"(=confirmIndex - 1, confirmation
// 직전 캔들)을 정확히 골라 OrderBlockBoxPrimitive에 넘기는지, 그리고 OB 갱신이 차트의
// zoom/visible range를 절대 건드리지 않는지 검증하는 회귀 테스트.
//
// lightweight-charts는 실제 canvas 렌더링이 필요해 jsdom에서 그대로 쓸 수 없으므로,
// CandleChart.jsx가 실제로 호출하는 최소 API(createChart/addSeries/attachPrimitive/
// priceScale/timeScale)만 mock한다. OrderBlockBoxPrimitive는 mock하지 않고 실제 클래스를
// 그대로 사용해서, CandleChart.jsx가 그 실제 인스턴스의 setOrderBlock()에 어떤 값을
// 넘기는지를 spy로 관찰한다 - 좌표 계산 로직 자체는 이미 OrderBlockBoxPrimitive.test.js가
// 검증했으므로, 여기서는 "CandleChart.jsx가 어떤 캔들을 OB candle로 고르는지"와
// "OB 갱신이 zoom을 건드리지 않는지"만 확인한다.
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  setVisibleLogicalRange: vi.fn(),
  capturedPrimitives: [],
}))

vi.mock('lightweight-charts', () => {
  function makeSeries() {
    return {
      setData: vi.fn(),
      priceToCoordinate: vi.fn(() => 0),
      attachPrimitive: vi.fn((primitive) => {
        mocks.capturedPrimitives.push(primitive)
        vi.spyOn(primitive, 'setOrderBlock')
      }),
    }
  }

  function createChart() {
    return {
      addSeries: vi.fn(() => makeSeries()),
      priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
      timeScale: vi.fn(() => ({
        setVisibleLogicalRange: mocks.setVisibleLogicalRange,
      })),
      remove: vi.fn(),
    }
  }

  return {
    createChart: vi.fn(createChart),
    CandlestickSeries: 'CandlestickSeries',
    HistogramSeries: 'HistogramSeries',
    LineSeries: 'LineSeries',
  }
})

const { default: CandleChart } = await import('./CandleChart.jsx')

function buildCandles() {
  return [
    { timestamp: '2024-01-01', open: 10, high: 11, low: 9, close: 10.5 },
    { timestamp: '2024-01-02', open: 10.5, high: 12, low: 10, close: 11 },
    { timestamp: '2024-01-03', open: 15, high: 16, low: 12, close: 13 }, // 음봉(OB candle 후보, index 2)
    { timestamp: '2024-01-04', open: 12.5, high: 17, low: 12, close: 16 }, // 양봉(confirmation, index 3)
    { timestamp: '2024-01-05', open: 16, high: 18, low: 15, close: 17 },
  ]
}

function mount(element) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(element)
  })
  return {
    rerender: (el) => act(() => root.render(el)),
    unmount: () => act(() => root.unmount()),
  }
}

describe('CandleChart - Order Block 표시 규칙', () => {
  let harness = null

  beforeEach(() => {
    mocks.setVisibleLogicalRange.mockClear()
    mocks.capturedPrimitives.length = 0
  })

  afterEach(() => {
    harness?.unmount()
    harness = null
  })

  it('obCandleIndex는 confirmIndex-1(confirmation 직전 캔들)이며, confirmIndex-2는 anchor로 쓰이지 않는다', () => {
    const candles = buildCandles()
    const activeOrderBlock = {
      type: 'bullish',
      startTime: candles[3].timestamp, // confirmation candle
      obHigh: 15,
      obLow: 13,
    }

    harness = mount(<CandleChart candles={candles} ma={{}} timeframe="1d" activeOrderBlock={activeOrderBlock} />)

    expect(mocks.capturedPrimitives).toHaveLength(1)
    const primitive = mocks.capturedPrimitives[0]
    expect(primitive.setOrderBlock).toHaveBeenCalledTimes(1)

    const passedOb = primitive.setOrderBlock.mock.calls[0][0]

    // obCandleIndex = confirmIndex(3) - 1 = 2 -> candles[2](2024-01-03)여야 한다.
    expect(passedOb.startAnchorTime).toEqual({ year: 2024, month: 1, day: 3 })
    // neighbor(spacing 계산 전용)는 confirmation candle(candles[3], 2024-01-04) 자신이어야 한다.
    expect(passedOb.startNeighborTime).toEqual({ year: 2024, month: 1, day: 4 })
    // confirmIndex-2(candles[1], 2024-01-02)는 절대 anchor로 쓰이면 안 된다(이전 캔들 침범 금지).
    expect(passedOb.startAnchorTime).not.toEqual({ year: 2024, month: 1, day: 2 })

    expect(passedOb.obHigh).toBe(15)
    expect(passedOb.obLow).toBe(13)
    expect(passedOb.label).toBe('상승 OB')
  })

  it('bearish 타입이면 "하락 OB" 라벨을 넘긴다', () => {
    const candles = buildCandles()
    const activeOrderBlock = {
      type: 'bearish',
      startTime: candles[3].timestamp,
      obHigh: 15,
      obLow: 13,
    }

    harness = mount(<CandleChart candles={candles} ma={{}} timeframe="1d" activeOrderBlock={activeOrderBlock} />)

    const primitive = mocks.capturedPrimitives[0]
    const passedOb = primitive.setOrderBlock.mock.calls[0][0]
    expect(passedOb.label).toBe('하락 OB')
  })

  it('activeOrderBlock만 바뀌고 candles/timeframe이 그대로면 OB는 갱신되지만 zoom(visible range)은 다시 호출되지 않는다', () => {
    const candles = buildCandles()
    const ma = {}
    const obA = { type: 'bullish', startTime: candles[3].timestamp, obHigh: 15, obLow: 13 }
    const obB = { type: 'bearish', startTime: candles[3].timestamp, obHigh: 16, obLow: 12.5 }

    harness = mount(<CandleChart candles={candles} ma={ma} timeframe="1d" activeOrderBlock={obA} />)

    expect(mocks.setVisibleLogicalRange).toHaveBeenCalledTimes(1) // 최초 데이터 로드 1회

    const primitive = mocks.capturedPrimitives[0]
    expect(primitive.setOrderBlock).toHaveBeenCalledTimes(1)

    // 같은 candles/ma 참조, 같은 timeframe을 유지한 채 activeOrderBlock만 바꾼다.
    harness.rerender(<CandleChart candles={candles} ma={ma} timeframe="1d" activeOrderBlock={obB} />)

    expect(primitive.setOrderBlock).toHaveBeenCalledTimes(2)
    expect(primitive.setOrderBlock.mock.calls[1][0].label).toBe('하락 OB')

    // OB 변경만으로는 zoom/visible range가 절대 다시 설정되면 안 된다.
    expect(mocks.setVisibleLogicalRange).toHaveBeenCalledTimes(1)
  })

  it('activeOrderBlock이 null이면 setOrderBlock(null)을 호출해 박스를 지운다', () => {
    const candles = buildCandles()

    harness = mount(<CandleChart candles={candles} ma={{}} timeframe="1d" activeOrderBlock={null} />)

    const primitive = mocks.capturedPrimitives[0]
    expect(primitive.setOrderBlock).toHaveBeenCalledWith(null)
  })
})
