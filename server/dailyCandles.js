// 역할: 토스증권 일봉(daily candle) 데이터 공급.
// before pagination(실제 응답에 들어있는 nextBefore 값을 다음 요청의 before로 그대로 사용하는
// 방식, 실제 API 호출로 동작을 확인함)을 이용해 count=200 제한보다 더 많은 과거 일봉을 모은다.
// MA200 계산이나 다른 어떤 분석 로직도 이 파일 안에 넣지 않는다(역할 분리).
//
// 일봉도 1분봉(minuteCandles.js)과 같은 이유로 디스크 캐시(candleCache.js)를 쓴다:
// 한 번 확정된 과거 일봉은 절대 바뀌지 않으므로, 다음 호출부터는 "캐시 이후 새로 생긴
// 것만" 앞에서 보충하고, 그래도 minCount에 모자라면 "캐시보다 더 과거"만 이어서 받는다.
// (이전에는 매번 처음부터 최대 6페이지를 다시 받아왔음 - 같은 종목을 반복 분석할 때
// 불필요한 중복 요청의 원인이었다.)

import { TOSS_API_BASE, fetchWithRetry } from './tossClient.js'
import { readCandleCache, writeCandleCache } from './candleCache.js'

// 페이지를 무한정 넘기지 않도록 안전장치를 둔다(요청 과다 방지, rate limit 보호).
// 페이지당 최대 200개이므로 6페이지면 최대 1200개까지 모을 수 있다.
// (2년치 크로스오버 비교를 위해 MIN_DAILY_CANDLES가 900까지 늘어나 5페이지로는 여유가
//  거의 없어져서, 최소한의 여유를 두려고 5 -> 6으로 올림. 적게 필요할 땐 기존처럼 적은
//  페이지만 쓰이므로 다른 호출부 동작에는 영향 없다.)
const MAX_PAGES = 6

// 페이지 요청 사이에 짧게 쉬어서 짧은 시간에 요청이 몰리는 것을 피한다(429 예방).
// minuteCandles.js와 동일한 값을 쓴다. 캐시가 따뜻할 때는 보통 1페이지만 쓰이므로
// 실제로 이 지연이 누적되는 경우는 드물다.
const REQUEST_DELAY_MS = 150

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchDailyPage(accessToken, code, count, before) {
  const authHeader = { Authorization: `Bearer ${accessToken}` }
  const url = new URL(`${TOSS_API_BASE}/api/v1/candles`)
  url.searchParams.set('symbol', code)
  url.searchParams.set('interval', '1d')
  url.searchParams.set('count', String(count))
  if (before) {
    url.searchParams.set('before', before)
  }

  const response = await fetchWithRetry(url.toString(), { headers: authHeader })
  if (!response.ok) {
    throw new Error(`일봉 조회 실패 (HTTP ${response.status})`)
  }

  const data = await response.json()
  return { candles: data.result?.candles ?? [], nextBefore: data.result?.nextBefore ?? null }
}

// close는 MA200 계산에, high/low는 골든크로스 기준 저점/고점 후보 탐색(swingLevels.js)에
// 쓰인다. 필드 이름(openPrice/highPrice/lowPrice/closePrice)은 실제 API 응답으로
// 이미 확인된 그대로 사용한다(추측 아님 - server/index.js의 getStockInfo에서도
// 같은 필드명으로 이미 정상 동작 중).
// timestamp는 캐시 재사용 시 "이 지점보다 과거/최신" pagination 기준(before 커서)으로만
// 쓰고, 바깥으로 반환하는 최종 결과에는 포함하지 않는다(기존 반환 형태 유지).
function toRecord(candle) {
  return {
    date: candle.timestamp.slice(0, 10), // "YYYY-MM-DD"
    timestamp: candle.timestamp,
    close: Number(candle.closePrice),
    high: Number(candle.highPrice),
    low: Number(candle.lowPrice),
  }
}

// minCount개 이상의 일봉을 모을 때까지, 혹은 더 가져올 데이터가 없을 때까지 페이지를 넘긴다.
// 날짜(YYYY-MM-DD) 기준으로 중복을 제거하고, 오래된 날짜 -> 최신 날짜 순으로 정렬해 돌려준다.
export async function fetchDailyCandles(accessToken, code, minCount) {
  const cacheKey = `daily-${code}`
  const cached = readCandleCache(cacheKey) ?? []
  const collected = new Map(cached.map((c) => [c.date, c]))

  let pagesUsed = 0

  // 1) 최신 쪽 보충: 캐시에 저장된 가장 최근 날짜 "이후"에 새로 생긴 일봉만 받는다.
  //    캐시가 비어있으면(첫 실행) 이 단계는 하지 않고 바로 2번으로 넘어간다.
  const newestCachedDate = cached.length > 0 ? cached[cached.length - 1].date : null
  if (newestCachedDate) {
    let before = null
    while (pagesUsed < MAX_PAGES) {
      const { candles, nextBefore } = await fetchDailyPage(accessToken, code, 200, before)
      pagesUsed += 1
      if (candles.length === 0) break

      let reachedCache = false
      for (const raw of candles) {
        const record = toRecord(raw)
        if (record.date <= newestCachedDate) {
          reachedCache = true // 이미 캐시에 있는 날짜까지 내려왔으므로 여기서 멈춰도 됨
        } else {
          collected.set(record.date, record)
        }
      }

      before = nextBefore
      if (reachedCache || !before) break
      await sleep(REQUEST_DELAY_MS)
    }
  }

  // 2) 과거 쪽 확장: 그래도 minCount에 모자라면, 캐시의 가장 오래된 날짜부터 이어서
  //    더 과거로 페이지를 넘긴다(캐시가 없으면 처음=지금부터 과거로, 기존 동작과 동일).
  let before = cached.length > 0 ? cached[0].timestamp : null
  while (collected.size < minCount && pagesUsed < MAX_PAGES) {
    // 마지막 페이지에서는 필요한 만큼만 요청해서(예: 240개 목표면 200+40),
    // 매번 200개씩 통째로 긁어와 필요 이상으로(예: 400개) 받아오지 않게 한다.
    const remaining = minCount - collected.size
    const requestCount = Math.min(200, Math.max(remaining, 1))

    const { candles, nextBefore } = await fetchDailyPage(accessToken, code, requestCount, before)
    pagesUsed += 1
    if (candles.length === 0) break

    for (const raw of candles) {
      const record = toRecord(raw)
      if (!collected.has(record.date)) {
        collected.set(record.date, record)
      }
    }

    before = nextBefore
    if (!before) break
    await sleep(REQUEST_DELAY_MS)
  }

  const result = Array.from(collected.values()).sort((a, b) => a.date.localeCompare(b.date))
  writeCandleCache(cacheKey, result)
  return result.map(({ date, close, high, low }) => ({ date, close, high, low }))
}
