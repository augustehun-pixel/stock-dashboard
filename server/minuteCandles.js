// 역할: 토스증권 1분봉(minute candle) 데이터 공급.
// dailyCandles.js와 같은 before pagination 방식(응답의 nextBefore를 다음 요청의 before로
// 그대로 사용)을 그대로 쓴다. 1분봉은 하루에도 캔들이 많이 나오므로, 필요한 만큼 모으려면
// 일봉보다 훨씬 많은 페이지를 넘겨야 할 수 있어 안전 한도(MAX_PAGES)를 넉넉히 둔다.
// 4시간봉으로 합성하는 로직(fourHourCandles.js)은 이 파일에 넣지 않는다(역할 분리).
//
// 1분봉은 한 번 확정되면 절대 바뀌지 않으므로 디스크 캐시(candleCache.js)에 쌓아두고,
// 다음 호출부터는 "캐시 이후 새로 생긴 것만" 앞에서 보충하고, 그래도 minCount에
// 모자라면 "캐시보다 더 과거"만 이어서 받는다 - 이미 받아둔 구간을 처음부터 다시
// 요청하지 않기 위함(1년치처럼 큰 minCount를 매번 새로 긁어오면 429 위험도 커지고 느려짐).

import { TOSS_API_BASE, fetchWithRetry } from './tossClient.js'
import { readCandleCache, writeCandleCache } from './candleCache.js'

// 페이지를 무한정 넘기지 않도록 안전장치를 둔다(요청 과다 방지, rate limit 보호).
// 페이지당 최대 200개이므로 2500페이지면 최대 50만 개까지 모을 수 있다.
// (과거 골든/데드크로스를 찾기 위해 더 넓은 과거 데이터가 필요해 500 -> 2500으로 올림.
//  minCount가 작으면 원래처럼 적은 페이지만 쓰이므로 기존 호출부 동작에는 영향 없다.)
const MAX_PAGES = 2500

// 페이지 요청 사이에 짧게 쉬어서 짧은 시간에 요청이 몰리는 것을 피한다(429 예방).
// fetchWithRetry의 재시도/백오프는 "이미 429가 난 뒤" 대응이고, 이 딜레이는 애초에
// 429가 덜 나게 만드는 예방 차원이다.
const REQUEST_DELAY_MS = 150

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchMinutePage(accessToken, code, count, before) {
  const authHeader = { Authorization: `Bearer ${accessToken}` }
  const url = new URL(`${TOSS_API_BASE}/api/v1/candles`)
  url.searchParams.set('symbol', code)
  url.searchParams.set('interval', '1m')
  url.searchParams.set('count', String(count))
  if (before) {
    url.searchParams.set('before', before)
  }

  const response = await fetchWithRetry(url.toString(), { headers: authHeader })
  if (!response.ok) {
    throw new Error(`1분봉 조회 실패 (HTTP ${response.status})`)
  }

  const data = await response.json()
  return { candles: data.result?.candles ?? [], nextBefore: data.result?.nextBefore ?? null }
}

function toCandle(raw) {
  return {
    timestamp: raw.timestamp,
    open: Number(raw.openPrice),
    high: Number(raw.highPrice),
    low: Number(raw.lowPrice),
    close: Number(raw.closePrice),
    volume: raw.volume !== undefined && raw.volume !== null ? Number(raw.volume) : null,
  }
}

// minCount개 이상의 1분봉을 모을 때까지, 혹은 더 가져올 데이터가 없을 때까지 페이지를 넘긴다.
// timestamp(문자열) 기준으로 중복을 제거하고, 오래된 -> 최신 순으로 정렬해 돌려준다.
// 정규장/시간외 구분이나 4시간봉으로 묶는 일은 하지 않는다(순수 데이터 공급만 담당).
export async function fetchMinuteCandles(accessToken, code, minCount) {
  const cacheKey = `minute-${code}`
  const cached = readCandleCache(cacheKey) ?? []
  const collected = new Map(cached.map((c) => [c.timestamp, c]))

  let pagesUsed = 0

  // 1) 최신 쪽 보충: 캐시에 저장된 가장 최근 시각 "이후"에 새로 생긴 1분봉만 받는다.
  //    캐시가 비어있으면(첫 실행) 이 단계는 하지 않고 바로 2번으로 넘어간다.
  const newestCachedTimestamp = cached.length > 0 ? cached[cached.length - 1].timestamp : null
  if (newestCachedTimestamp) {
    let before = null
    while (pagesUsed < MAX_PAGES) {
      const { candles, nextBefore } = await fetchMinutePage(accessToken, code, 200, before)
      pagesUsed += 1
      if (candles.length === 0) break

      let reachedCache = false
      for (const raw of candles) {
        if (raw.timestamp <= newestCachedTimestamp) {
          reachedCache = true // 이미 캐시에 있는 시점까지 내려왔으므로 여기서 멈춰도 됨
        } else {
          collected.set(raw.timestamp, toCandle(raw))
        }
      }

      before = nextBefore
      if (reachedCache || !before) break
      await sleep(REQUEST_DELAY_MS)
    }
  }

  // 2) 과거 쪽 확장: 그래도 minCount에 모자라면, 캐시의 가장 오래된 시각부터 이어서
  //    더 과거로 페이지를 넘긴다(캐시가 없으면 처음=지금부터 과거로, 기존 동작과 동일).
  let before = cached.length > 0 ? cached[0].timestamp : null
  while (collected.size < minCount && pagesUsed < MAX_PAGES) {
    const remaining = minCount - collected.size
    const requestCount = Math.min(200, Math.max(remaining, 1))

    const { candles, nextBefore } = await fetchMinutePage(accessToken, code, requestCount, before)
    pagesUsed += 1
    if (candles.length === 0) break

    for (const raw of candles) {
      if (!collected.has(raw.timestamp)) {
        collected.set(raw.timestamp, toCandle(raw))
      }
    }

    before = nextBefore
    if (!before) break
    await sleep(REQUEST_DELAY_MS)
  }

  const result = Array.from(collected.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp))
  writeCandleCache(cacheKey, result)
  return result
}
