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
// 이 값은 fourHourCandleAnalysis.js가 "일봉 MA200과 같은 깊이까지 4시간봉을 확보하는"
// 기준으로도 그대로 재사용한다(두 파이프라인이 항상 같은 거래일 수를 보도록 export).
// 900이라는 크기 자체에 특별한 의미는 없고, 넉넉한 여유치일 뿐이다 - 실제 최소
// 요구량 계산 근거는 fourHourCandleAnalysis.js의 TRADING_DAYS_NEEDED 주석 참고.
export const MIN_DAILY_CANDLES = 900

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
