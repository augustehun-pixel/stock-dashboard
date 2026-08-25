// 역할: 토스증권 1분봉(minute candle) 데이터 공급.
// dailyCandles.js와 같은 before pagination 방식(응답의 nextBefore를 다음 요청의 before로
// 그대로 사용)을 그대로 쓴다. 1분봉은 하루에도 캔들이 많이 나오므로, 필요한 만큼 모으려면
// 일봉보다 훨씬 많은 페이지를 넘겨야 할 수 있어 안전 한도(MAX_PAGES)를 넉넉히 둔다.
// 4시간봉으로 합성하는 로직(fourHourCandles.js)은 이 파일에 넣지 않는다(역할 분리).

import { TOSS_API_BASE, fetchWithRetry } from './tossClient.js'

// 페이지를 무한정 넘기지 않도록 안전장치를 둔다(요청 과다 방지, rate limit 보호).
// 페이지당 최대 200개이므로 2500페이지면 최대 50만 개까지 모을 수 있다.
// (과거 골든/데드크로스를 찾기 위해 더 넓은 과거 데이터가 필요해 500 -> 2500으로 올림.
//  minCount가 작으면 원래처럼 적은 페이지만 쓰이므로 기존 호출부 동작에는 영향 없다.)
const MAX_PAGES = 2500

// minCount개 이상의 1분봉을 모을 때까지, 혹은 더 가져올 데이터가 없을 때까지 페이지를 넘긴다.
// timestamp(문자열) 기준으로 중복을 제거하고, 오래된 -> 최신 순으로 정렬해 돌려준다.
// 정규장/시간외 구분이나 4시간봉으로 묶는 일은 하지 않는다(순수 데이터 공급만 담당).
export async function fetchMinuteCandles(accessToken, code, minCount) {
  const authHeader = { Authorization: `Bearer ${accessToken}` }
  const collected = new Map()
  let before = null

  for (let page = 0; page < MAX_PAGES; page++) {
    // 마지막 페이지에서는 필요한 만큼만 요청해서 과도하게 받아오지 않게 한다.
    const remaining = minCount - collected.size
    const requestCount = Math.min(200, Math.max(remaining, 1))

    const url = new URL(`${TOSS_API_BASE}/api/v1/candles`)
    url.searchParams.set('symbol', code)
    url.searchParams.set('interval', '1m')
    url.searchParams.set('count', String(requestCount))
    if (before) {
      url.searchParams.set('before', before)
    }

    const response = await fetchWithRetry(url.toString(), { headers: authHeader })

    if (!response.ok) {
      // 이미 어느 정도 모아둔 데이터가 있으면 그걸로 진행하고, 하나도 없으면 실패로 처리한다.
      if (collected.size > 0) break
      throw new Error(`1분봉 조회 실패 (HTTP ${response.status})`)
    }

    const data = await response.json()
    const candles = data.result?.candles ?? []
    if (candles.length === 0) break

    for (const candle of candles) {
      if (!collected.has(candle.timestamp)) {
        collected.set(candle.timestamp, {
          timestamp: candle.timestamp,
          open: Number(candle.openPrice),
          high: Number(candle.highPrice),
          low: Number(candle.lowPrice),
          close: Number(candle.closePrice),
          volume: candle.volume !== undefined && candle.volume !== null ? Number(candle.volume) : null,
        })
      }
    }

    before = data.result?.nextBefore ?? null
    if (collected.size >= minCount || !before) break
  }

  return Array.from(collected.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}
