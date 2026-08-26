// 역할: 일봉 MA200 분석 endpoint가 쓸 최종 데이터를 조립.
// "일봉 데이터 공급"(dailyCandles.js)과 "이동평균 계산"(movingAverage.js)을 조합하기만 하고,
// 이 둘의 세부 구현에는 관여하지 않는다(역할 분리).
//
// 4시간봉 MA200, 골든크로스 판정, 피보나치 되돌림은 이번 단계에서 다루지 않는다.
// 나중에 fourHourMA200 데이터 공급원이 생기면, 같은 movingAverage.js를 그대로 재사용해
// 이 파일과 같은 형태의 별도 분석 모듈(예: fourHourMA200Analysis.js)을 추가하면 된다.

import { getTossAccessToken } from './tossClient.js'
import { fetchDailyCandles } from './dailyCandles.js'
import { calculateMovingAverages } from './movingAverage.js'

const MA_PERIOD = 200

// 최근 30거래일치 MA200 선을 그리는 용도라면 200 + (30 - 1) = 229개면 충분하지만,
// 일봉 vs 4시간봉 크로스오버 비교 구간(최대 604거래일, 2단계 목표인 2년치)의 모든
// 지점에서 일봉 MA200도 확정되어 있어야 하므로, 그 구간 전체(604) + 일봉 MA200 자체의
// 워밍업(200) = 최소 804개가 필요하다. 여유를 두어 900으로 잡는다.
const MIN_DAILY_CANDLES = 900

// 같은 종목을 짧은 시간 안에 다시 요청해도 매번 pagination을 반복하지 않도록
// 아주 단순한 메모리 캐시를 둔다(서버가 켜져 있는 동안만 유지, 복잡한 무효화 로직 없음).
const CACHE_TTL_MS = 5 * 60 * 1000
const ma200Cache = new Map()

export async function getDailyMA200Series(code) {
  const cached = ma200Cache.get(code)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data
  }

  const accessToken = await getTossAccessToken()
  const candles = await fetchDailyCandles(accessToken, code, MIN_DAILY_CANDLES)

  if (candles.length === 0) {
    throw new Error('일봉 데이터를 가져오지 못함')
  }

  const closes = candles.map((candle) => candle.close)
  const ma200Values = calculateMovingAverages(closes, MA_PERIOD)

  const series = candles.map((candle, index) => ({
    date: candle.date,
    close: candle.close,
    high: candle.high,
    low: candle.low,
    ma200: ma200Values[index],
  }))

  ma200Cache.set(code, { data: series, expiresAt: Date.now() + CACHE_TTL_MS })
  return series
}
