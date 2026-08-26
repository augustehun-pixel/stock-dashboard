// 역할: 토스증권 일봉(daily candle) 데이터 공급.
// before pagination(실제 응답에 들어있는 nextBefore 값을 다음 요청의 before로 그대로 사용하는
// 방식, 실제 API 호출로 동작을 확인함)을 이용해 count=200 제한보다 더 많은 과거 일봉을 모은다.
// MA200 계산이나 다른 어떤 분석 로직도 이 파일 안에 넣지 않는다(역할 분리).

import { TOSS_API_BASE, fetchWithRetry } from './tossClient.js'

// 페이지를 무한정 넘기지 않도록 안전장치를 둔다(요청 과다 방지, rate limit 보호).
// 페이지당 최대 200개이므로 6페이지면 최대 1200개까지 모을 수 있다.
// (2년치 크로스오버 비교를 위해 MIN_DAILY_CANDLES가 900까지 늘어나 5페이지로는 여유가
//  거의 없어져서, 최소한의 여유를 두려고 5 -> 6으로 올림. 적게 필요할 땐 기존처럼 적은
//  페이지만 쓰이므로 다른 호출부 동작에는 영향 없다.)
const MAX_PAGES = 6

// minCount개 이상의 일봉을 모을 때까지, 혹은 더 가져올 데이터가 없을 때까지 페이지를 넘긴다.
// 날짜(YYYY-MM-DD) 기준으로 중복을 제거하고, 오래된 날짜 -> 최신 날짜 순으로 정렬해 돌려준다.
export async function fetchDailyCandles(accessToken, code, minCount) {
  const authHeader = { Authorization: `Bearer ${accessToken}` }
  const collected = new Map()
  let before = null

  for (let page = 0; page < MAX_PAGES; page++) {
    // 마지막 페이지에서는 필요한 만큼만 요청해서(예: 240개 목표면 200+40),
    // 매번 200개씩 통째로 긁어와 필요 이상으로(예: 400개) 받아오지 않게 한다.
    const remaining = minCount - collected.size
    const requestCount = Math.min(200, Math.max(remaining, 1))

    const url = new URL(`${TOSS_API_BASE}/api/v1/candles`)
    url.searchParams.set('symbol', code)
    url.searchParams.set('interval', '1d')
    url.searchParams.set('count', String(requestCount))
    if (before) {
      url.searchParams.set('before', before)
    }

    const response = await fetchWithRetry(url.toString(), { headers: authHeader })

    if (!response.ok) {
      // 이미 어느 정도 모아둔 데이터가 있으면 그걸로 진행하고, 하나도 없으면 실패로 처리한다.
      if (collected.size > 0) break
      throw new Error(`일봉 조회 실패 (HTTP ${response.status})`)
    }

    const data = await response.json()
    const candles = data.result?.candles ?? []
    if (candles.length === 0) break

    for (const candle of candles) {
      const date = candle.timestamp.slice(0, 10) // "YYYY-MM-DD"
      if (!collected.has(date)) {
        // close는 MA200 계산에, high/low는 골든크로스 기준 저점/고점 후보 탐색(swingLevels.js)에
        // 쓰인다. 필드 이름(openPrice/highPrice/lowPrice/closePrice)은 실제 API 응답으로
        // 이미 확인된 그대로 사용한다(추측 아님 - server/index.js의 getStockInfo에서도
        // 같은 필드명으로 이미 정상 동작 중).
        collected.set(date, {
          close: Number(candle.closePrice),
          high: Number(candle.highPrice),
          low: Number(candle.lowPrice),
        })
      }
    }

    before = data.result?.nextBefore ?? null
    if (collected.size >= minCount || !before) break
  }

  return Array.from(collected.entries())
    .map(([date, { close, high, low }]) => ({ date, close, high, low }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
