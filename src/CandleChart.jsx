import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import { MA_COLORS } from './chartColors'
import { OrderBlockBoxPrimitive } from './OrderBlockBoxPrimitive'

// lightweight-charts는 캔버스 위에 직접 그리기 때문에 App.css의 CSS 변수를 상속받지
// 못한다. 다크모드 팔레트(--card-bg/--section-border/--text-secondary/--positive/
// --negative)와 같은 값을 여기 직접 맞춰 넣는다 - 팔레트가 바뀌면 함께 바꿔야 한다.
const CHART_BG = '#161d2e' // --card-bg
const GRID_COLOR = 'rgba(151, 161, 181, 0.12)' // --text-secondary 기반, 은은하게
const AXIS_COLOR = 'rgba(151, 161, 181, 0.3)'
const TEXT_COLOR = '#97a1b5' // --text-secondary
// 국내 증권 화면 관례: 상승=빨강, 하락=파랑 (이 프로젝트의 --positive/--negative와 동일).
const UP_COLOR = '#ff6b6b'
const DOWN_COLOR = '#6ea8fe'
// Order Block 박스 색상. 캔들 자체는 이 프로젝트 관례상 상승=빨강/하락=파랑이라, OB 박스에
// 같은 색을 쓰면 겹치는 캔들·꼬리·이동평균선 사이에서 묻혀 안 보이는 문제가 있었다(실측 확인:
// obHigh~obLow 폭이 좁은 OB는 얇은 파란 테두리가 파란 캔들/청록 MA20 라인과 사실상 구분 불가).
// 그래서 OB만은 캔들과 다른, 국제적으로 통용되는 상승=초록/하락=빨강 계열을 쓴다 - bullish/
// bearish가 한눈에 구분되면서도 기존 캔들 색과는 섞이지 않는다. fill은 캔들/이동평균선을
// 가리지 않을 정도의 낮은 불투명도, border는 완전 불투명(1.0 - 더 진하게 할 수 없는 최댓값)으로
// 얇은 OB(실측 시 obHigh~obLow가 화면에서 1~2px밖에 안 되는 경우도 있음)도 경계가 뚜렷이
// 보이도록 한다. fill 불투명도는 박스가 오른쪽으로 pane 끝까지 넓게 퍼지는 점을 고려해
// (차트를 과하게 가리지 않게) 살짝만 올렸다 - 순수 시각 표현 조정이며 obHigh/obLow 좌표에는
// 영향 없음.
const OB_BULLISH_FILL = 'rgba(74, 222, 128, 0.22)'
const OB_BULLISH_BORDER = 'rgba(34, 197, 94, 1)'
const OB_BEARISH_FILL = 'rgba(239, 68, 68, 0.22)'
const OB_BEARISH_BORDER = 'rgba(220, 38, 38, 1)'

const MA_PERIODS = [5, 20, 60, 120]

const DAILY_TIMEFRAMES = new Set(['1d', '1w'])
// 초기에 화면에 바로 보이는 캔들 수(전체 데이터를 지우는 게 아니라 시작 보기 범위만 좁힌다 -
// 사용자가 직접 스크롤/핀치줌하면 그 이전 데이터도 계속 볼 수 있다).
const DEFAULT_VISIBLE_BARS = 120

// 일/주봉은 날짜 단위(business day)로, 분/시간봉은 시:분까지 보여야 하므로 UTCTimestamp로
// 넘긴다. lightweight-charts는 UTCTimestamp를 그대로(UTC로) 축에 표시하므로, KST 시:분
// 숫자가 축에 그대로 보이도록 9시간을 더해 "KST 벽시계 값 = UTC 값"으로 맞추는 트릭을 쓴다.
function toChartTime(timestamp, timeframe) {
  if (DAILY_TIMEFRAMES.has(timeframe)) {
    const [year, month, day] = timestamp.slice(0, 10).split('-').map(Number)
    return { year, month, day }
  }
  return Math.floor(Date.parse(timestamp) / 1000) + 9 * 3600
}

// candles: [{ timestamp, open, high, low, close, volume }, ...] (오래된 -> 최신 순)
// ma: { 5: number[], 20: number[], 60: number[], 120: number[] } (candles와 같은 길이/순서)
// activeOrderBlock: GET /api/stock/:code/order-blocks 응답의 activeOrderBlock 그대로
// ({ type, obHigh, obLow, startTime, ... }) 또는 null. Detection/Lifecycle 판정은 전혀
// 다시 하지 않고, 서버가 이미 정해준 obHigh/obLow/startTime을 좌표로만 바꿔서 그린다.
export default function CandleChart({ candles, ma, timeframe, activeOrderBlock }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const orderBlockPrimitiveRef = useRef(null)

  // timeframe이 바뀌면 시간 축 표시 형식(날짜 단위 vs 시:분 단위) 자체가 바뀌므로,
  // 매번 새로 만든다. 데이터 갱신(아래 두 번째 effect)과는 분리해서, 같은 timeframe
  // 안에서 데이터만 바뀔 때는 차트를 재생성하지 않는다.
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { color: CHART_BG }, textColor: TEXT_COLOR, fontSize: 11 },
      grid: { vertLines: { color: GRID_COLOR }, horzLines: { color: GRID_COLOR } },
      rightPriceScale: { borderColor: AXIS_COLOR, scaleMargins: { top: 0.1, bottom: 0.3 } },
      timeScale: {
        borderColor: AXIS_COLOR,
        timeVisible: !DAILY_TIMEFRAMES.has(timeframe),
        secondsVisible: false,
      },
    })

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderVisible: false,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    })

    // Order Block 박스는 캔들 시리즈에 Series Primitive로 붙인다(줌/팬 시 좌표가 항상
    // 캔들과 함께 맞도록 - DOM 오버레이처럼 별도로 좌표를 다시 계산해줄 필요가 없다).
    // timeframe이 바뀌어 차트가 재생성될 때마다 새로 만들어 붙이고, 데이터는 아래 세 번째
    // effect에서 setOrderBlock()으로 채운다.
    // attachPrimitive 실패(예: 설치된 lightweight-charts 버전이 Series Primitive API를
    // 지원하지 않는 경우)가 나머지 차트(캔들/거래량/이동평균선) 렌더링까지 막지 않도록
    // 반드시 이 블록만 try/catch로 격리한다 - 실패해도 OB 박스만 안 보일 뿐 차트는 정상 동작해야 한다.
    try {
      const orderBlockPrimitive = new OrderBlockBoxPrimitive()
      candlestickSeries.attachPrimitive(orderBlockPrimitive)
      orderBlockPrimitiveRef.current = orderBlockPrimitive
    } catch (error) {
      console.error('Order Block 박스 초기화 실패 (차트의 나머지 부분은 계속 표시됩니다):', error)
      orderBlockPrimitiveRef.current = null
    }

    // 거래량은 같은 패널 아래쪽 30%에 별도 가격축(priceScaleId: 'volume')으로 겹쳐 그린다
    // (TradingView lightweight-charts 공식 예제와 동일한 방식). 축 눈금 자체는 숫자가
    // 아니라 막대 상대 크기만 보면 되므로 숨긴다.
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 }, visible: false })

    const maSeries = {}
    for (const period of MA_PERIODS) {
      maSeries[period] = chart.addSeries(LineSeries, {
        color: MA_COLORS[period],
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
    }

    chartRef.current = chart
    seriesRef.current = { candlestickSeries, volumeSeries, maSeries }

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      orderBlockPrimitiveRef.current = null
    }
  }, [timeframe])

  useEffect(() => {
    const series = seriesRef.current
    if (!series || !Array.isArray(candles) || candles.length === 0) return

    const times = candles.map((c) => toChartTime(c.timestamp, timeframe))

    series.candlestickSeries.setData(
      candles.map((c, i) => ({ time: times[i], open: c.open, high: c.high, low: c.low, close: c.close })),
    )

    const hasVolume = candles.every((c) => c.volume !== null && Number.isFinite(c.volume))
    series.volumeSeries.setData(
      hasVolume
        ? candles.map((c, i) => ({
            time: times[i],
            value: c.volume,
            color: c.close >= c.open ? 'rgba(255, 107, 107, 0.5)' : 'rgba(110, 168, 254, 0.5)',
          }))
        : [],
    )

    for (const period of MA_PERIODS) {
      const values = ma?.[period] ?? []
      const lineData = times
        .map((time, i) => ({ time, value: values[i] }))
        .filter((point) => Number.isFinite(point.value))
      series.maSeries[period].setData(lineData)
    }

    chartRef.current
      ?.timeScale()
      .setVisibleLogicalRange({ from: Math.max(0, candles.length - DEFAULT_VISIBLE_BARS), to: candles.length - 1 })
  }, [candles, ma, timeframe])

  // Order Block 박스: activeOrderBlock 하나만 표시한다(과거 OB, 진입선, stopLoss는 이번
  // 단계에서 다루지 않는다). 박스 상/하단은 반드시 obHigh/obLow만 쓴다(wick 절대 사용 금지 -
  // docs/trading-rules/order-block.md 1절, obHigh/obLow 값 자체는 여기서 전혀 바꾸지 않는다).
  // 차트의 visible range/zoom은 이 effect가 절대 건드리지 않는다 - primitive는 이미 그려진
  // 차트 좌표를 읽기만 한다.
  //
  // 왼쪽 경계: 박스는 "OB가 된 캔들 자체"의 전체 폭만 처음부터 포함한다 - 그보다 한 캔들 더
  // 과거로 확장하지 않는다. activeOrderBlock.startTime은 서버가 확정한 시점(engulfing한
  // 캔들의 시각 - server/orderBlock.js buildOrderBlock/buildDoubleOrderBlock의 time)이고,
  // 실제 OB 가격 영역(obHigh/obLow)은 그 바로 이전 캔들의 몸통이다(일반 OB는 engulfing 당한
  // 캔들, 이중장악형은 Candle2 - 문서 2·3·15·16절). candles 배열에서 그 "OB가 된 캔들"
  // (obCandleIndex = confirmIndex - 1)을 anchor로 그대로 쓰고, spacing 계산용으로만 그 바로
  // 다음 캔들(engulfing 캔들 자신)을 함께 넘긴다. 왼쪽 경계 좌표(x1)는 OrderBlockBoxPrimitive가
  // anchor 캔들 중심 좌표에서 두 캔들 간격(현재 zoom의 실제 캔들 간격)의 절반만큼 왼쪽으로
  // 뺀 값으로 계산한다 - anchor 캔들의 시간 좌표(=캔들 중심)를 그대로 x1로 쓰면 그 캔들을
  // 절반만 덮고 시작하기 때문이다.
  //
  // 오른쪽 경계: 특정 캔들(예: 마지막 캔들)에 맞추지 않고 OrderBlockBoxPrimitive가 매 프레임
  // pane의 실제 렌더 폭까지 그린다(TradingView의 zone extend 표현 - 자세한 계산은
  // OrderBlockBoxPrimitive.js 참고). 그래서 여기서는 오른쪽 끝 관련 값을 계산하지 않는다.
  // 미래의 가짜 캔들/timestamp를 만드는 것도 아니고, 차트 scale/visible range도 건드리지 않는다.
  //
  // (참고: lightweight-charts.timeScale().logicalToCoordinate()에 정수가 아닌 logical
  // index를 넘기면 좌표를 계산하지 않고 0을 반환한다 - 이전 시도에서 이 방식을 썼다가 모든
  // OB 박스의 왼쪽 경계가 차트 맨 왼쪽에 고정되는 버그가 났다. 그래서 정수 logical index
  // 대신, 항상 정수 인덱스로 귀결되는 timeToCoordinate(각 캔들의 실제 시각) 호출로만 계산한다.)
  useEffect(() => {
    const primitive = orderBlockPrimitiveRef.current
    if (!primitive) return

    // 여기서 던지는 어떤 예외도(예: 예상과 다른 startTime 형식) 캔들/거래량/이동평균선
    // 렌더링에는 영향을 주면 안 된다 - OB 박스만 안 그려지고 나머지 차트는 그대로 보여야 한다.
    try {
      if (!activeOrderBlock || !Array.isArray(candles) || candles.length === 0) {
        primitive.setOrderBlock(null)
        return
      }

      // confirmIndex: engulfing 캔들(OB를 확정지은 캔들)의 candles 배열 내 위치.
      // obCandleIndex: 실제 OB 가격 영역(obHigh/obLow)이 된 캔들 그 자체 - 박스는 반드시
      // 이 캔들의 왼쪽 edge에서 시작해야 하고, 그보다 한 칸 더 앞(confirmIndex - 2)을 쓰지 않는다.
      // confirmIndex는 항상 candles 안에서 찾을 수 있어야 한다(같은 API 응답의 candles/
      // activeOrderBlock이므로) - 못 찾으면 좌표를 신뢰할 수 없으므로 박스를 그리지 않는다.
      const confirmIndex = candles.findIndex((c) => c.timestamp === activeOrderBlock.startTime)
      if (confirmIndex < 1) {
        primitive.setOrderBlock(null)
        return
      }

      const isBullishFamily = activeOrderBlock.type === 'bullish' || activeOrderBlock.type === 'bullish-double'
      const obCandleIndex = confirmIndex - 1
      // spacing 계산에만 쓰는 인접 캔들(obCandleIndex + 1 = engulfing 캔들 자신 = confirmIndex).
      const neighborIndex = confirmIndex

      primitive.setOrderBlock({
        startAnchorTime: toChartTime(candles[obCandleIndex].timestamp, timeframe),
        startNeighborTime: toChartTime(candles[neighborIndex].timestamp, timeframe),
        obHigh: activeOrderBlock.obHigh,
        obLow: activeOrderBlock.obLow,
        fillColor: isBullishFamily ? OB_BULLISH_FILL : OB_BEARISH_FILL,
        borderColor: isBullishFamily ? OB_BULLISH_BORDER : OB_BEARISH_BORDER,
        label: isBullishFamily ? '상승 OB' : '하락 OB',
      })
    } catch (error) {
      console.error('Order Block 박스 갱신 실패 (차트의 나머지 부분은 계속 표시됩니다):', error)
    }
  }, [activeOrderBlock, candles, timeframe])

  return <div ref={containerRef} className="candle-chart-canvas" />
}
