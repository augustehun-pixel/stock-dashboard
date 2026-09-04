// lightweight-charts v5 Series Primitive: Order Block 가격 영역(obHigh~obLow)을 캔들
// 시리즈 위에 반투명 사각형으로 그린다.
//
// DOM/SVG 오버레이 방식(별도로 좌표를 동기화해야 하고, 팬/줌 중 캔들과 어긋날 수 있음)
// 대신, lightweight-charts가 공식 제공하는 Series Primitive 확장점을 사용한다 - 렌더러의
// renderer()가 매 프레임 호출되며 그때마다 series.priceToCoordinate / chart.timeScale()의
// 좌표 변환을 다시 불러 좌표를 구하기 때문에, 차트를 확대/축소/좌우 이동해도 별도 동기화
// 코드 없이 항상 정확한 가격·시간 위치에 맞춰 그려진다.
//
// 이 파일은 좌표 계산과 캔버스 draw만 담당한다. OB 판정/생명주기 규칙, 그리고 시간값을
// lightweight-charts time 형식으로 바꾸는 변환(toChartTime)은 CandleChart.jsx가 담당하고
// 이미 변환된 값만 setOrderBlock()으로 넘겨준다.
//
// 왼쪽 경계(x1)는 캔들 "중심"이 아니라 "edge"에 맞춰야 한다. timeToCoordinate(time)은 그
// 캔들의 중심 좌표를 반환하므로, 그대로 쓰면 박스가 OB 캔들을 절반만 덮고 시작해 버린다.
// 이를 고치기 위해 정수가 아닌 logical index(예: index - 0.5)를 timeScale().
// logicalToCoordinate()에 넘기는 방법을 시도했었는데, 이 라이브러리 버전은 정수가 아닌
// logical을 받으면 좌표를 계산하지 않고 0을 반환한다(isInteger 체크 실패 시 조기 반환) -
// 그 결과 모든 OB 박스의 왼쪽 경계가 차트 맨 왼쪽(0)에 고정되는 회귀가 있었다. 그래서 대신,
// "OB 캔들 중심 좌표 - 다음 캔들과의 간격(spacing)/2" 방식으로 왼쪽 edge를 구한다. 둘 다
// 실제 데이터의 시각이므로 timeToCoordinate가 항상 정수 인덱스로 변환해 정상 좌표를 반환하고,
// spacing은 현재 zoom에서의 실제 캔들 간격을 그대로 반영한다(고정 픽셀 값을 쓰지 않음). 이
// 계산은 좌표를 "읽기"만 할 뿐 chart의 timeScale(zoom/visible range/scroll)에는 전혀 영향을
// 주지 않는다 - setVisibleLogicalRange/fitContent 등은 이 파일 어디에서도 호출하지 않는다.
//
// 오른쪽 경계는 "마지막 캔들"이 아니라 pane(캔들 시리즈가 그려지는 캔버스) 자체의 오른쪽
// 끝까지 그린다 - TradingView의 zone extend와 동일한 표현. 캔들 좌표(timeScale)에 얽매이지
// 않고 draw() 안에서 매 프레임 target.useBitmapCoordinateSpace가 주는 실제 렌더 폭
// (scope.mediaSize.width)을 그대로 오른쪽 경계로 쓴다 - 미래의 가짜 캔들/timestamp를 만들지
// 않고, 차트 크기가 바뀌어도(리사이즈) 다음 프레임에 자동으로 다시 맞춰진다.
//
// 중요: obHigh/obLow로부터 계산된 y1/y2(따라서 top/bottom)는 절대 확대·보정하지 않는다.
// 실제 가격 영역이 화면에서 1px 미만이면 채우기 사각형도 정확히 그만큼만 얇게 그려진다 -
// "최소 높이의 가짜 박스"를 만들지 않는다. 대신 상단선(obHigh)과 하단선(obLow)을 각각 별도
// 선(stroke)으로 그린다. 선은 항상 렌더링 두께(lineWidth)를 갖기 때문에 - 가격축 그리드선이나
// lightweight-charts의 기본 price line이 원래 그렇듯 - top===bottom이거나 그 차이가 1px보다
// 작아도 두 선이 겹쳐 최소한 하나의 뚜렷한 선으로는 항상 보인다. 이 선의 "두께"는 시각적
// 표현일 뿐 obHigh/obLow 값 자체를 바꾸는 것이 아니다.
const BORDER_WIDTH_PX = 2
// 라벨(예: "하락 OB")은 박스가 1~2px로 얇을 때 안에 넣으면 읽을 수 없으므로, 박스 오른쪽
// 끝 부근에 별도의 작은 배지(badge)로 그린다 - obHigh/obLow가 만드는 실제 가격 영역과는
// 무관한 순수 UI 오버레이라 top/bottom(가격 좌표)에 전혀 영향을 주지 않는다. 세로 위치는
// OB 영역의 중앙값((top+bottom)/2, 선형 가격축이므로 priceToCoordinate((obHigh+obLow)/2)와
// 동일)에 맞춘다.
const BADGE_FONT_PX = 11
const BADGE_PADDING_X_PX = 6
const BADGE_PADDING_Y_PX = 3
const BADGE_MARGIN_RIGHT_PX = 8
const BADGE_TEXT_COLOR = '#f8fafc'

class OrderBlockBoxPaneRenderer {
  constructor(viewData) {
    this._viewData = viewData
  }

  draw(target) {
    const data = this._viewData
    if (!data) return
    if (data.x1 === null || data.y1 === null || data.y2 === null) return

    // lightweight-charts의 내부 렌더 루프(rAF) 안에서 호출된다 - React 바깥이라 여기서 던진
    // 예외는 앱 전체를 흰 화면으로 만들 수 있다. OB 박스 하나를 못 그리는 것과 차트 전체가
    // 멈추는 것은 전혀 다른 문제이므로 반드시 이 draw 호출만 격리한다.
    try {
      target.useBitmapCoordinateSpace((scope) => {
        const ctx = scope.context
        const hRatio = scope.horizontalPixelRatio
        const vRatio = scope.verticalPixelRatio

        const left = data.x1 * hRatio
        // 오른쪽 경계: 캔들/시간이 아니라 이 pane의 실제 렌더 폭 그대로(TradingView 스타일
        // extend) - scope.mediaSize.width는 draw() 시점의 CSS px 폭이라 리사이즈에도 항상
        // 최신 값을 읽는다. chart의 timeScale/visible range는 전혀 건드리지 않는다.
        const right = scope.mediaSize.width * hRatio
        // obHigh/obLow에서 나온 top/bottom을 그대로 쓴다 - 여기서 값을 넓히거나 보정하지 않는다.
        const top = Math.min(data.y1, data.y2) * vRatio
        const bottom = Math.max(data.y1, data.y2) * vRatio

        // 채우기: 실제 가격 영역(top~bottom) 그대로. 캔들/이동평균선/거래량을 가리지 않도록
        // 낮은 불투명도를 유지한다.
        ctx.fillStyle = data.fillColor
        ctx.fillRect(left, top, right - left, bottom - top)

        // 테두리: obHigh 위치(top)와 obLow 위치(bottom)에 각각 수평선을 그린다. 화면 배율과
        // 무관하게 항상 실제 BORDER_WIDTH_PX CSS px 두께로 보이도록 vRatio를 곱한다. 상/하단
        // 선을 따로 그리므로 두 값이 거의 같아 사각형이 안 보일 만큼 얇아도 선 자체는 항상 보인다.
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

        // 배지: OB 영역(top~bottom)이 1~2px로 얇아도 항상 읽을 수 있도록, 가격 영역과는
        // 독립적인 별도 사각형을 박스 오른쪽 끝 부근에 그린다. 세로 중심은 OB 영역의
        // 중앙값(top/bottom의 중점 - 선형 가격축이므로 obMid의 좌표와 동일)에 맞추되,
        // 배지 자체의 상/하 높이는 top/bottom(obHigh/obLow)과 무관하게 폰트 크기 기준으로
        // 고정한다 - 이래야 얇은 박스에서도 배지 텍스트가 실제로 보인다. top/bottom(가격
        // 좌표) 값 자체는 여기서 전혀 읽거나 바꾸지 않는다(배치 기준으로만 사용).
        if (data.label) {
          const fontSize = BADGE_FONT_PX * vRatio
          const paddingX = BADGE_PADDING_X_PX * hRatio
          const paddingY = BADGE_PADDING_Y_PX * vRatio
          const marginRight = BADGE_MARGIN_RIGHT_PX * hRatio

          ctx.font = `${fontSize}px sans-serif`
          const textWidth = ctx.measureText(data.label).width
          const badgeWidth = textWidth + paddingX * 2
          const badgeHeight = fontSize + paddingY * 2
          const centerY = (top + bottom) / 2
          const badgeRight = right - marginRight
          const badgeLeft = badgeRight - badgeWidth
          const badgeTop = centerY - badgeHeight / 2

          ctx.fillStyle = data.borderColor
          ctx.fillRect(badgeLeft, badgeTop, badgeWidth, badgeHeight)

          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillStyle = BADGE_TEXT_COLOR
          ctx.fillText(data.label, badgeLeft + badgeWidth / 2, centerY)
        }
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
      // x1: OB 캔들의 왼쪽 edge = OB 캔들 중심 좌표 - (OB캔들-다음캔들 간 실제 간격)/2.
      // 위 파일 상단 설명 참고 - 정수 logical index 트릭 대신 timeToCoordinate 호출만으로
      // 계산해서 이 버전의 lightweight-charts에서도 항상 올바른 좌표를 얻는다. 오른쪽 경계는
      // 더 이상 캔들 시각에 의존하지 않고 draw()가 pane 폭으로 직접 계산한다(위 설명 참고).
      const timeScale = chart.timeScale()
      const startAnchorX = timeScale.timeToCoordinate(orderBlock.startAnchorTime)
      const startNeighborX = timeScale.timeToCoordinate(orderBlock.startNeighborTime)
      const startSpacing =
        startAnchorX !== null && startNeighborX !== null ? Math.abs(startNeighborX - startAnchorX) : 0
      const x1 = startAnchorX !== null ? startAnchorX - startSpacing / 2 : null

      const y1 = series.priceToCoordinate(orderBlock.obHigh)
      const y2 = series.priceToCoordinate(orderBlock.obLow)

      return new OrderBlockBoxPaneRenderer({
        x1,
        y1,
        y2,
        fillColor: orderBlock.fillColor,
        borderColor: orderBlock.borderColor,
        label: orderBlock.label,
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

  // orderBlock: { startAnchorTime, startNeighborTime, obHigh, obLow, fillColor, borderColor,
  // label } (startAnchorTime은 왼쪽 edge를 구할 OB 캔들, startNeighborTime은 그 간격(spacing)
  // 계산용 인접 캔들 - 둘 다 이미 lightweight-charts time 형식으로 변환된 값. 오른쪽 경계는
  // 더 이상 이 객체로 넘기지 않고 draw() 시점의 pane 폭으로 계산한다. label은 선택) 또는
  // null(그리지 않음).
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
