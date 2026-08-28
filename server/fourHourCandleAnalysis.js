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
import { MIN_DAILY_CANDLES } from './ma200Analysis.js'

// 4시간봉 MA200이 "일봉 MA200이 유효한 구간 전체"를 놓치지 않고 덮어야, 오래된 골든/
// 데드크로스도 놓치지 않는다(기존 604거래일 기준으로는 STX엔진의 2024-05-28 골든크로스가
// 비교 구간 밖에 있어 탐지되지 않았던 사례로 확인됨). 최소 요구량 계산:
//  - 일봉 MA200 워밍업: 200거래일 (calculateMovingAverages period=200)
//  - 일봉 확보량: MIN_DAILY_CANDLES(900)거래일 -> 일봉 MA200 유효 구간 = 900 - 200 + 1 = 701거래일
//  - 4시간봉 MA200 워밍업: 4시간봉 200개 = 100거래일 (정규장 하루 2구간: AM/PM)
//  - 위 701거래일 전체를 4시간봉으로도 비교하려면 최소 100 + 701 = 801거래일치 원본 데이터 필요
// MIN_DAILY_CANDLES를 그대로 재사용하면(900 >= 801) 항상 이 최소치를 만족하면서, 일봉 쪽
// 깊이가 나중에 바뀌어도 두 파이프라인이 자동으로 같이 늘어나 다시 어긋나지 않는다.
const TRADING_DAYS_NEEDED = MIN_DAILY_CANDLES

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
