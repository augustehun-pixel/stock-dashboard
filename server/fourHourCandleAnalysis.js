// 역할: "4시간봉 데이터 파이프라인" 조립 담당.
// minuteCandles.js(1분봉 공급)와 fourHourCandles.js(4시간봉 합성)를 조합하기만 하고,
// 이 둘의 세부 구현에는 관여하지 않는다(역할 분리).
//
// 이번 단계에서는 "깨끗한 4시간봉 OHLCV 시리즈"까지만 만든다.
// MA200 계산, 골든크로스 판정, UI 연결은 다음 단계에서 다룬다 - 여기서는 하지 않는다.
// (나중에 4시간봉 MA200이 필요해지면, 이미 있는 movingAverage.js를 그대로 재사용해
//  일봉 MA200(ma200Analysis.js)과 똑같은 방식으로 조합하는 새 파일을 추가하면 된다.)

import { getTossAccessToken } from './tossClient.js'
import { fetchMinuteCandles } from './minuteCandles.js'
import { aggregateToFourHourCandles } from './fourHourCandles.js'

// 목표: 4시간봉 최소 200개 이상(여유를 둬서 220개) 확보.
// 정규장은 하루에 2개 구간(09:00~12:59, 13:00~15:30)뿐이므로 220개 = 110거래일 필요.
const TARGET_FOUR_HOUR_CANDLES = 220
const TRADING_DAYS_NEEDED = Math.ceil(TARGET_FOUR_HOUR_CANDLES / 2)

// 정규장은 하루 390분(09:00~15:30)이지만, 실제로는 시간외/연장거래 캔들도 섞여 들어오기
// 때문에(실측 확인) 같은 거래일 수를 확보하려면 원본 1분봉을 더 많이 받아야 한다.
// 넉넉하게 1.8배 여유를 두고, 실제 결과가 부족하면 이 상수만 조정하면 된다.
const REGULAR_SESSION_MINUTES_PER_DAY = 390
const RAW_CANDLE_BUFFER_MULTIPLIER = 1.8
const MIN_RAW_MINUTE_CANDLES = Math.ceil(
  TRADING_DAYS_NEEDED * REGULAR_SESSION_MINUTES_PER_DAY * RAW_CANDLE_BUFFER_MULTIPLIER,
)

// 1분봉을 몇백 페이지씩 모으는 건 비용이 크므로(초기 백필), 캐시를 넉넉히(1시간) 유지한다.
// 어차피 4시간봉은 4시간에 한 번만 바뀌는 데이터라 자주 새로고침할 필요가 없다.
const CACHE_TTL_MS = 60 * 60 * 1000
const fourHourCandleCache = new Map()

export async function getFourHourCandles(code) {
  const cached = fourHourCandleCache.get(code)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.data
  }

  const accessToken = await getTossAccessToken()
  const minuteCandles = await fetchMinuteCandles(accessToken, code, MIN_RAW_MINUTE_CANDLES)

  if (minuteCandles.length === 0) {
    throw new Error('1분봉 데이터를 가져오지 못함')
  }

  const fourHourCandles = aggregateToFourHourCandles(minuteCandles)

  fourHourCandleCache.set(code, { data: fourHourCandles, expiresAt: Date.now() + CACHE_TTL_MS })
  return fourHourCandles
}
