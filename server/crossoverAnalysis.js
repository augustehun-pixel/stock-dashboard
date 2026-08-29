// 역할: "일봉 MA200 vs 4시간봉 MA200 골든크로스/데드크로스 판정"의 조립 담당.
// 이미 있는 일봉 MA200(ma200Analysis.js)과 4시간봉 캔들(fourHourCandleAnalysis.js)을
// 그대로 재사용하고, 4시간봉에 MA200을 붙이는 것과 두 시리즈를 정렬/비교하는 것은
// 각각 movingAverage.js / maCrossoverSignal.js에 맡긴다 - 이 파일은 조합만 한다.
//
// "최근", "임박", "불안정" 판단과 매수/익절/손절 규칙은 아직 다음 단계로 남아있다.
// Fibonacci 레벨(0.5/0.618) 계산·도달·무효 판정은 fibonacciLevels.js에 위임해 조립만 함
// (2026-08-29 세션에서 추가 - 계산 로직 자체는 이 파일에 없음, 순수 계산은 그쪽에 있음).

import { getDailyMA200Series } from './ma200Analysis.js'
import { getFourHourCandles } from './fourHourCandleAnalysis.js'
import { calculateMovingAverages } from './movingAverage.js'
import { alignFourHourWithDailyMA200, detectCrossovers } from './maCrossoverSignal.js'
import { findReferenceLow, findConfirmedHigh, listPostGoldenCrossHighCandidates } from './swingLevels.js'
import { calculateFibonacciAnalysis } from './fibonacciLevels.js'

const MA_PERIOD = 200

export async function getCrossoverAnalysis(code) {
  const [dailySeries, fourHourCandles] = await Promise.all([
    getDailyMA200Series(code),
    getFourHourCandles(code),
  ])

  if (fourHourCandles.length === 0) {
    throw new Error('4시간봉 데이터가 없어 골든크로스 판정 불가')
  }

  const fourHourCloses = fourHourCandles.map((candle) => candle.close)
  const fourHourMA200Values = calculateMovingAverages(fourHourCloses, MA_PERIOD)
  const fourHourSeriesWithMA = fourHourCandles.map((candle, index) => ({
    date: candle.date,
    session: candle.session,
    close: candle.close,
    ma200: fourHourMA200Values[index],
  }))

  const aligned = alignFourHourWithDailyMA200(fourHourSeriesWithMA, dailySeries)
  const { events, currentState, latest, latestGolden, latestDead } = detectCrossovers(aligned)

  // 가장 최근 골든크로스가 있을 때만 기준 저점/확정 고점/고점 후보를 계산한다.
  const referenceLow = latestGolden ? findReferenceLow(dailySeries, latestGolden.date) : null
  const confirmedHigh =
    latestGolden && referenceLow
      ? findConfirmedHigh(dailySeries, referenceLow.date, latestGolden.date)
      : null
  const postGoldenCrossHighCandidates = latestGolden
    ? listPostGoldenCrossHighCandidates(dailySeries, latestGolden.date)
    : []

  const fibonacci =
    latestGolden && referenceLow && confirmedHigh
      ? calculateFibonacciAnalysis(dailySeries, latestGolden.date, referenceLow.low, confirmedHigh.high)
      : null

  return {
    alignedCount: aligned.length,
    events,
    currentState,
    latest,
    latestGolden,
    latestDead,
    aligned,
    referenceLow,
    confirmedHigh,
    postGoldenCrossHighCandidates,
    fibonacci,
  }
}
