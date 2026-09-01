import { useEffect, useRef } from 'react'
import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'
import { MA_COLORS } from './chartColors'

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
export default function CandleChart({ candles, ma, timeframe }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)

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

  return <div ref={containerRef} className="candle-chart-canvas" />
}
