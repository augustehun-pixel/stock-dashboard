// OrderBlockBoxPrimitive.js가 실제로 구현한 "OB 박스 표시 규칙"을 보호하는 회귀 테스트.
// 이 파일은 OrderBlockBoxPrimitive의 좌표 계산/그리기 로직 자체만 검증한다 - CandleChart.jsx가
// obCandleIndex(=confirmIndex-1)를 어떻게 골라내는지는 primitive의 책임이 아니므로
// ./CandleChart.test.jsx에서 별도로 검증한다.
//
// lightweight-charts 전체를 mock하지 않고, primitive가 실제로 호출하는 최소한의 인터페이스
// (chart.timeScale().timeToCoordinate, series.priceToCoordinate, target.useBitmapCoordinateSpace)
// 만 흉내 낸 뒤 OrderBlockBoxPrimitive의 공개 API(attached/setOrderBlock/paneViews)를 그대로
// 호출한다 - 좌표 계산 로직을 다시 구현해서 비교하지 않는다.
import { describe, expect, it } from 'vitest'
import { OrderBlockBoxPrimitive } from './OrderBlockBoxPrimitive.js'

function createMockChart(coordMap) {
  return {
    timeScale: () => ({
      // 실제 lightweight-charts와 동일하게, 좌표를 모르는 시간은 null을 반환한다.
      timeToCoordinate: (time) => {
        const key = JSON.stringify(time)
        return Object.prototype.hasOwnProperty.call(coordMap, key) ? coordMap[key] : null
      },
      // setVisibleLogicalRange/fitContent/scrollToPosition 등은 의도적으로 정의하지 않는다.
      // primitive가 만약 zoom/scroll을 바꾸는 메서드를 호출하려 하면 "is not a function"으로
      // 즉시 테스트가 실패해야 하고, 실제로는 실패하지 않는 것 자체가 "건드리지 않는다"는 증거다.
    }),
  }
}

function createMockSeries(priceMap) {
  return {
    priceToCoordinate: (price) =>
      Object.prototype.hasOwnProperty.call(priceMap, price) ? priceMap[price] : null,
  }
}

function createMockDrawTarget({ width = 1000, height = 400, hRatio = 1, vRatio = 1 } = {}) {
  const fillRects = []
  const lines = []
  const fillTexts = []
  let currentPoint = null

  const ctx = {
    fillRect: (x, y, w, h) => fillRects.push({ x, y, w, h, fillStyle: ctx.fillStyle }),
    beginPath: () => {
      currentPoint = null
    },
    moveTo: (x, y) => {
      currentPoint = { x, y }
    },
    lineTo: (x, y) => {
      lines.push({ from: currentPoint, to: { x, y }, strokeStyle: ctx.strokeStyle, lineWidth: ctx.lineWidth })
      currentPoint = { x, y }
    },
    stroke: () => {},
    measureText: (text) => ({ width: text.length * 6 }),
    fillText: (text, x, y) => fillTexts.push({ text, x, y, fillStyle: ctx.fillStyle }),
    fillStyle: null,
    strokeStyle: null,
    lineWidth: null,
    font: null,
    textAlign: null,
    textBaseline: null,
  }

  return {
    useBitmapCoordinateSpace(callback) {
      callback({ context: ctx, horizontalPixelRatio: hRatio, verticalPixelRatio: vRatio, mediaSize: { width, height } })
    },
    fillRects,
    lines,
    fillTexts,
  }
}

function setup({ chartCoords, priceCoords, orderBlock }) {
  const primitive = new OrderBlockBoxPrimitive()
  const chart = createMockChart(chartCoords)
  const series = createMockSeries(priceCoords)
  primitive.attached({ chart, series, requestUpdate: () => {} })
  primitive.setOrderBlock(orderBlock)
  return { primitive, chart, series }
}

describe('OrderBlockBoxPrimitive - 좌표 계산(renderer)', () => {
  it('x1은 OB candle(startAnchorTime) 좌표 기준이고, confirmation candle(startNeighborTime)은 spacing 계산에만 쓰인다', () => {
    // anchor(OB candle) 좌표=100, neighbor(confirmation candle) 좌표=120 -> spacing=20 -> x1=90
    const { primitive } = setup({
      chartCoords: { '"anchor"': 100, '"neighbor"': 120 },
      priceCoords: { 200: 50, 100: 150 },
      orderBlock: {
        startAnchorTime: 'anchor',
        startNeighborTime: 'neighbor',
        obHigh: 200,
        obLow: 100,
        fillColor: 'fill',
        borderColor: 'border',
        label: '상승 OB',
      },
    })

    const renderer = primitive.paneViews()[0].renderer()
    expect(renderer).not.toBeNull()

    const target = createMockDrawTarget()
    renderer.draw(target)

    expect(target.fillRects[0].x).toBe(90)
  })

  it('y1/y2는 obHigh/obLow(BODY)만 사용하고, referenceHigh/referenceLow(wick) 값은 전혀 읽지 않는다', () => {
    const { primitive } = setup({
      chartCoords: { '"anchor"': 0, '"neighbor"': 10 },
      priceCoords: { 105: 20, 100: 40 }, // obHigh=105->20, obLow=100->40
      orderBlock: {
        startAnchorTime: 'anchor',
        startNeighborTime: 'neighbor',
        obHigh: 105,
        obLow: 100,
        // CandleChart.jsx는 이 필드들을 실제로 넘기지 않지만, 혹시 넘겨도 renderer()가
        // 이 값을 무시하는지 확인하기 위해 obHigh/obLow와 다른 값을 일부러 섞는다.
        referenceHigh: 999,
        referenceLow: 1,
        fillColor: 'fill',
        borderColor: 'border',
        label: '상승 OB',
      },
    })

    const renderer = primitive.paneViews()[0].renderer()
    const target = createMockDrawTarget()
    renderer.draw(target)

    expect(target.fillRects[0].y).toBe(20) // top = obHigh 좌표
    expect(target.fillRects[0].h).toBe(20) // bottom(40) - top(20), obLow 좌표 기준
  })
})

describe('OrderBlockBoxPrimitive - 오른쪽 pane 끝까지 연장', () => {
  it('오른쪽 경계는 마지막 캔들 좌표가 아니라 pane 렌더 폭(mediaSize.width) 그대로이며, 폭이 바뀌면 다시 계산된다', () => {
    const { primitive } = setup({
      chartCoords: { '"anchor"': 50, '"neighbor"': 70 },
      priceCoords: { 100: 10, 90: 30 },
      orderBlock: {
        startAnchorTime: 'anchor',
        startNeighborTime: 'neighbor',
        obHigh: 100,
        obLow: 90,
        fillColor: 'fill',
        borderColor: 'border',
        label: '하락 OB',
      },
    })

    const renderer = primitive.paneViews()[0].renderer()

    const narrowTarget = createMockDrawTarget({ width: 800 })
    renderer.draw(narrowTarget)
    expect(narrowTarget.fillRects[0].w).toBe(800 - 40) // left = anchor(50) - spacing(20)/2 = 40

    const widerTarget = createMockDrawTarget({ width: 1600 })
    renderer.draw(widerTarget)
    expect(widerTarget.fillRects[0].w).toBe(1600 - 40)
  })
})

describe('OrderBlockBoxPrimitive - 라벨', () => {
  it('상승/하락 OB 라벨 텍스트가 그려지고, 박스 오른쪽 끝 근처(왼쪽 절반이 아님)에 배치된다', () => {
    const { primitive } = setup({
      chartCoords: { '"anchor"': 50, '"neighbor"': 70 },
      priceCoords: { 100: 10, 90: 30 },
      orderBlock: {
        startAnchorTime: 'anchor',
        startNeighborTime: 'neighbor',
        obHigh: 100,
        obLow: 90,
        fillColor: 'fill',
        borderColor: 'border',
        label: '상승 OB',
      },
    })

    const renderer = primitive.paneViews()[0].renderer()
    const target = createMockDrawTarget({ width: 1000 })
    renderer.draw(target)

    expect(target.fillTexts).toHaveLength(1)
    expect(target.fillTexts[0].text).toBe('상승 OB')
    expect(target.fillTexts[0].x).toBeGreaterThan(500)
  })

  it('label이 없으면 텍스트를 그리지 않는다', () => {
    const { primitive } = setup({
      chartCoords: { '"anchor"': 50, '"neighbor"': 70 },
      priceCoords: { 100: 10, 90: 30 },
      orderBlock: {
        startAnchorTime: 'anchor',
        startNeighborTime: 'neighbor',
        obHigh: 100,
        obLow: 90,
        fillColor: 'fill',
        borderColor: 'border',
        label: null,
      },
    })

    const renderer = primitive.paneViews()[0].renderer()
    const target = createMockDrawTarget()
    renderer.draw(target)

    expect(target.fillTexts).toHaveLength(0)
  })
})

describe('OrderBlockBoxPrimitive - zoom/scroll 후 좌표 재계산', () => {
  it('renderer()를 다시 호출할 때마다 그 시점의 timeToCoordinate/priceToCoordinate 값을 새로 읽는다(좌표를 캐시하지 않는다)', () => {
    let anchorX = 100
    let obHighY = 20

    const chart = {
      timeScale: () => ({
        timeToCoordinate: (time) => (time === 'anchor' ? anchorX : time === 'neighbor' ? anchorX + 20 : null),
      }),
    }
    const series = {
      priceToCoordinate: (price) => (price === 105 ? obHighY : price === 100 ? obHighY + 20 : null),
    }

    const primitive = new OrderBlockBoxPrimitive()
    primitive.attached({ chart, series, requestUpdate: () => {} })
    primitive.setOrderBlock({
      startAnchorTime: 'anchor',
      startNeighborTime: 'neighbor',
      obHigh: 105,
      obLow: 100,
      fillColor: 'fill',
      borderColor: 'border',
      label: null,
    })

    const beforeTarget = createMockDrawTarget()
    primitive.paneViews()[0].renderer().draw(beforeTarget)
    const leftBefore = beforeTarget.fillRects[0].x
    const topBefore = beforeTarget.fillRects[0].y

    // "줌/스크롤"을 시뮬레이션: 같은 orderBlock 데이터인데 차트 좌표 변환 결과만 바뀐다.
    anchorX = 400
    obHighY = 60

    const afterTarget = createMockDrawTarget()
    primitive.paneViews()[0].renderer().draw(afterTarget)
    const leftAfter = afterTarget.fillRects[0].x
    const topAfter = afterTarget.fillRects[0].y

    expect(leftAfter).not.toBe(leftBefore)
    expect(leftAfter).toBe(400 - 10) // spacing 항상 20 -> x1 = anchorX - 10
    expect(topAfter).not.toBe(topBefore)
    expect(topAfter).toBe(60)
  })

  it('primitive는 좌표를 읽는 메서드만 호출하고, zoom/scroll을 바꾸는 timeScale 메서드는 호출하지 않는다', () => {
    // 이 mock의 timeScale()에는 timeToCoordinate만 있고 setVisibleLogicalRange 등은 없다.
    // primitive가 그런 메서드를 호출하려 시도했다면 draw()가 예외를 던졌을 것이다.
    const { primitive } = setup({
      chartCoords: { '"anchor"': 10, '"neighbor"': 30 },
      priceCoords: { 50: 5, 40: 15 },
      orderBlock: {
        startAnchorTime: 'anchor',
        startNeighborTime: 'neighbor',
        obHigh: 50,
        obLow: 40,
        fillColor: 'fill',
        borderColor: 'border',
        label: '상승 OB',
      },
    })

    const renderer = primitive.paneViews()[0].renderer()
    const target = createMockDrawTarget()

    expect(() => renderer.draw(target)).not.toThrow()
  })
})

describe('OrderBlockBoxPrimitive - null/좌표 없음 처리', () => {
  it('orderBlock이 null이면 renderer()가 null을 반환한다', () => {
    const primitive = new OrderBlockBoxPrimitive()
    primitive.attached({ chart: createMockChart({}), series: createMockSeries({}), requestUpdate: () => {} })
    primitive.setOrderBlock(null)

    expect(primitive.paneViews()[0].renderer()).toBeNull()
  })

  it('시간이 좌표로 변환되지 않으면(x1=null) draw()가 아무것도 그리지 않는다', () => {
    const { primitive } = setup({
      chartCoords: {}, // timeToCoordinate가 항상 null
      priceCoords: { 50: 5, 40: 15 },
      orderBlock: {
        startAnchorTime: 'anchor',
        startNeighborTime: 'neighbor',
        obHigh: 50,
        obLow: 40,
        fillColor: 'fill',
        borderColor: 'border',
        label: '상승 OB',
      },
    })

    const renderer = primitive.paneViews()[0].renderer()
    const target = createMockDrawTarget()
    renderer.draw(target)

    expect(target.fillRects).toHaveLength(0)
    expect(target.fillTexts).toHaveLength(0)
  })
})
