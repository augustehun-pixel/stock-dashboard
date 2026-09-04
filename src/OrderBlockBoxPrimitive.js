// lightweight-charts v5 Series Primitive: Order Block 가격 영역(obHigh~obLow)을 캔들
// 시리즈 위에 반투명 사각형으로 그린다.
//
// DOM/SVG 오버레이 방식(별도로 좌표를 동기화해야 하고, 팬/줌 중 캔들과 어긋날 수 있음)
// 대신, lightweight-charts가 공식 제공하는 Series Primitive 확장점을 사용한다 - 렌더러의
// renderer()가 매 프레임 호출되며 그때마다 series.priceToCoordinate / chart.timeScale()
// .timeToCoordinate를 다시 불러 좌표를 구하기 때문에, 차트를 확대/축소/좌우 이동해도
// 별도 동기화 코드 없이 항상 정확한 가격·시간 위치에 맞춰 그려진다.
//
// 이 파일은 좌표 계산과 캔버스 draw만 담당한다. OB 판정/생명주기 규칙, 그리고 시간값을
// lightweight-charts time 형식으로 바꾸는 변환(toChartTime)은 CandleChart.jsx가 담당하고
// 이미 변환된 값만 setOrderBlock()으로 넘겨준다.
//
// 중요: obHigh/obLow로부터 계산된 y1/y2(따라서 top/bottom)는 절대 확대·보정하지 않는다.
// 실제 가격 영역이 화면에서 1px 미만이면 채우기 사각형도 정확히 그만큼만 얇게 그려진다 -
// "최소 높이의 가짜 박스"를 만들지 않는다. 대신 상단선(obHigh)과 하단선(obLow)을 각각 별도
// 선(stroke)으로 그린다. 선은 항상 렌더링 두께(lineWidth)를 갖기 때문에 - 가격축 그리드선이나
// lightweight-charts의 기본 price line이 원래 그렇듯 - top===bottom이거나 그 차이가 1px보다
// 작아도 두 선이 겹쳐 최소한 하나의 뚜렷한 선으로는 항상 보인다. 이 선의 "두께"는 시각적
// 표현일 뿐 obHigh/obLow 값 자체를 바꾸는 것이 아니다.
const BORDER_WIDTH_PX = 1.5

class OrderBlockBoxPaneRenderer {
  constructor(viewData) {
    this._viewData = viewData
  }

  draw(target) {
    const data = this._viewData
    if (!data) return
    if (data.x1 === null || data.x2 === null || data.y1 === null || data.y2 === null) return

    // lightweight-charts의 내부 렌더 루프(rAF) 안에서 호출된다 - React 바깥이라 여기서 던진
    // 예외는 앱 전체를 흰 화면으로 만들 수 있다. OB 박스 하나를 못 그리는 것과 차트 전체가
    // 멈추는 것은 전혀 다른 문제이므로 반드시 이 draw 호출만 격리한다.
    try {
      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context
        const hRatio = scope.horizontalPixelRatio
        const vRatio = scope.verticalPixelRatio

        const left = Math.min(data.x1, data.x2) * hRatio
        const right = Math.max(data.x1, data.x2) * hRatio
        // obHigh/obLow에서 나온 top/bottom을 그대로 쓴다 - 여기서 값을 넓히거나 보정하지 않는다.
        const top = Math.min(data.y1, data.y2) * vRatio
        const bottom = Math.max(data.y1, data.y2) * vRatio

        // 채우기: 실제 가격 영역(top~bottom) 그대로. 캔들/이동평균선/거래량을 가리지 않도록
        // 낮은 불투명도를 유지한다.
        ctx.fillStyle = data.fillColor
        ctx.fillRect(left, top, right - left, bottom - top)

        // 테두리: obHigh 위치(top)와 obLow 위치(bottom)에 각각 수평선을 그린다. 화면 배율과
        // 무관하게 항상 실제 1.5 CSS px 두께로 보이도록 vRatio를 곱한다. 상/하단 선을 따로
        // 그리므로 두 값이 거의 같아 사각형이 안 보일 만큼 얇아도 선 자체는 항상 보인다.
        const lineWidth = BORDER_WIDTH_PX * vRatio
        ctx.strokeStyle = data.borderColor
        ctx.lineWidth = lineWidth

        ctx.beginPath()
        ctx.moveTo(left, top)
        ctx.lineTo(right, top)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(left, bottom)
        ctx.lineTo(right, bottom)
        ctx.stroke()

        // 좌/우 테두리(시작/끝 시점을 명확히 보여주는 용도). top===bottom이면 세로선은
        // 길이 0이라 그려지지 않을 뿐, 별도 보정은 아니다.
        ctx.beginPath()
        ctx.moveTo(left, top)
        ctx.lineTo(left, bottom)
        ctx.stroke()

        ctx.beginPath()
        ctx.moveTo(right, top)
        ctx.lineTo(right, bottom)
        ctx.stroke()
      })
    } catch (error) {
      console.error('Order Block 박스 draw 실패 (차트의 나머지 부분은 계속 표시됩니다):', error)
    }
  }
}

class OrderBlockBoxPaneView {
  constructor(source) {
    this._source = source
  }

  // renderer()가 draw 시점마다 새로 좌표를 계산하므로 여기서는 할 일이 없다.
  update() {}

  renderer() {
    const { chart, series, orderBlock } = this._source
    if (!chart || !series || !orderBlock) return null

    // renderer()도 lightweight-charts 내부 렌더 루프에서 호출되므로 draw()와 동일한 이유로
    // 격리한다 - 좌표 계산이 실패해도 OB 박스만 안 그려질 뿐 차트 자체는 계속 동작해야 한다.
    try {
      const x1 = chart.timeScale().timeToCoordinate(orderBlock.startTime)
      const x2 = chart.timeScale().timeToCoordinate(orderBlock.endTime)
      const y1 = series.priceToCoordinate(orderBlock.obHigh)
      const y2 = series.priceToCoordinate(orderBlock.obLow)

      return new OrderBlockBoxPaneRenderer({
        x1,
        x2,
        y1,
        y2,
        fillColor: orderBlock.fillColor,
        borderColor: orderBlock.borderColor,
      })
    } catch (error) {
      console.error('Order Block 박스 좌표 계산 실패 (차트의 나머지 부분은 계속 표시됩니다):', error)
      return null
    }
  }
}

export class OrderBlockBoxPrimitive {
  constructor() {
    this._chart = null
    this._series = null
    this._orderBlock = null
    this._requestUpdate = null
    this._paneViews = [new OrderBlockBoxPaneView(this)]
  }

  get chart() {
    return this._chart
  }

  get series() {
    return this._series
  }

  get orderBlock() {
    return this._orderBlock
  }

  // orderBlock: { startTime, endTime, obHigh, obLow, fillColor, borderColor } (startTime/endTime는
  // 이미 lightweight-charts time 형식으로 변환된 값) 또는 null(그리지 않음).
  setOrderBlock(orderBlock) {
    this._orderBlock = orderBlock
    this._requestUpdate?.()
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart
    this._series = series
    this._requestUpdate = requestUpdate
  }

  detached() {
    this._chart = null
    this._series = null
    this._requestUpdate = null
  }

  updateAllViews() {}

  paneViews() {
    return this._paneViews
  }
}
