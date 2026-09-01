// 역할: 상세보기 "캔들 차트"(30분/1시간/4시간/1일/1주) 전용 OHLCV 데이터 조립.
// 골든크로스/MA200 파이프라인(dailyCandles.js, fourHourCandleAnalysis.js)과는 완전히 분리한다:
//  - 일봉은 이 파일에서 직접 fetch한다(별도 캐시 키 "chart-daily-{code}"를 써서
//    dailyCandles.js가 쓰는 "daily-{code}" 캐시와 절대 섞이지 않는다). dailyCandles.js는
//    close/high/low만 담지만, 캔들 차트는 open/volume도 필요해서 그대로 재사용할 수 없다.
//  - 1분봉은 minuteCandles.js의 fetchMinuteCandles를 그대로 재사용한다(같은 캐시 키
//    "minute-{code}"를 공유 - 골든크로스가 이미 받아둔 1분봉이 있으면 그걸 그대로 쓴다).
//  - 4시간봉은 fourHourCandleAnalysis.js의 getFourHourCandles를 그대로 재사용한다
//    (골든크로스가 쓰는 것과 동일한 4시간봉 정의를 그대로 차트에도 보여준다).
// 이 파일은 골든크로스 판정 로직을 전혀 호출하지 않고, 위 모듈들의 코드도 수정하지 않는다.

import { TOSS_API_BASE, fetchWithRetry, getTossAccessToken } from './tossClient.js'
import { readCandleCache, writeCandleCache } from './candleCache.js'
import { fetchMinuteCandles } from './minuteCandles.js'
import { aggregateToFixedMinuteCandles } from './intradayCandles.js'
import { getFourHourCandles } from './fourHourCandleAnalysis.js'

const DAILY_MAX_PAGES = 6
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

function toDailyRecord(candle) {
  return {
    date: candle.timestamp.slice(0, 10),
    timestamp: candle.timestamp,
    open: Number(candle.openPrice),
    high: Number(candle.highPrice),
    low: Number(candle.lowPrice),
    close: Number(candle.closePrice),
    volume: candle.volume !== undefined && candle.volume !== null ? Number(candle.volume) : null,
  }
}

// minCount개 이상의 일봉을 모을 때까지, 혹은 더 가져올 데이터가 없을 때까지 페이지를 넘긴다.
// dailyCandles.js의 캐시 보충 전략(최신 쪽 보충 -> 과거 쪽 확장)과 동일한 방식을 쓰지만,
// 캐시 키와 반환 필드(open/volume 포함)가 다른 완전히 별도의 구현이다.
async function fetchDailyOHLCV(accessToken, code, minCount) {
  const cacheKey = `chart-daily-${code}`
  const cached = readCandleCache(cacheKey) ?? []
  const collected = new Map(cached.map((c) => [c.date, c]))

  let pagesUsed = 0

  const newestCachedDate = cached.length > 0 ? cached[cached.length - 1].date : null
  if (newestCachedDate) {
    let before = null
    while (pagesUsed < DAILY_MAX_PAGES) {
      const { candles, nextBefore } = await fetchDailyPage(accessToken, code, 200, before)
      pagesUsed += 1
      if (candles.length === 0) break

      let reachedCache = false
      for (const raw of candles) {
        const record = toDailyRecord(raw)
        if (record.date <= newestCachedDate) {
          reachedCache = true
        } else {
          collected.set(record.date, record)
        }
      }

      before = nextBefore
      if (reachedCache || !before) break
      await sleep(REQUEST_DELAY_MS)
    }
  }

  let before = cached.length > 0 ? cached[0].timestamp : null
  while (collected.size < minCount && pagesUsed < DAILY_MAX_PAGES) {
    const remaining = minCount - collected.size
    const requestCount = Math.min(200, Math.max(remaining, 1))

    const { candles, nextBefore } = await fetchDailyPage(accessToken, code, requestCount, before)
    pagesUsed += 1
    if (candles.length === 0) break

    for (const raw of candles) {
      const record = toDailyRecord(raw)
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
  return result
}

// ISO 8601 기준(월요일 시작) 주 단위로 일봉을 묶는다. 실제 거래일 데이터만 쓰고,
// 한 주에 거래일이 하루도 없으면(연휴 등) 그 주 자체를 만들지 않는다(가짜 값 금지).
function isoWeekKey(dateStr) {
  const date = new Date(`${dateStr}T00:00:00.000+09:00`)
  // getUTCDay(): 0=일요일. 월요일을 그 주의 시작으로 만들기 위해 보정한다.
  const day = (date.getUTCDay() + 6) % 7
  const monday = new Date(date)
  monday.setUTCDate(date.getUTCDate() - day)
  return monday.toISOString().slice(0, 10)
}

function aggregateToWeeklyOHLCV(dailyOHLCV) {
  if (!Array.isArray(dailyOHLCV) || dailyOHLCV.length === 0) return []

  const buckets = new Map()
  for (const record of dailyOHLCV) {
    const weekKey = isoWeekKey(record.date)
    if (!buckets.has(weekKey)) buckets.set(weekKey, [])
    buckets.get(weekKey).push(record)
  }

  const result = []
  for (const records of buckets.values()) {
    records.sort((a, b) => a.date.localeCompare(b.date))
    const first = records[0]
    const last = records[records.length - 1]

    const hasVolume = records.every((r) => r.volume !== null && Number.isFinite(r.volume))
    const volume = hasVolume ? records.reduce((sum, r) => sum + r.volume, 0) : null

    result.push({
      date: last.date,
      timestamp: last.timestamp,
      open: first.open,
      high: Math.max(...records.map((r) => r.high)),
      low: Math.min(...records.map((r) => r.low)),
      close: last.close,
      volume,
    })
  }

  return result.sort((a, b) => a.date.localeCompare(b.date))
}

// 대상 표시 구간 + MA120 워밍업을 함께 감안한 최소 데이터량.
// 30분/1시간봉은 1분봉을 원본으로 쓰므로, 목표 거래일 수 * 정규장 390분 * 여유배율(1.8, 시간외
// 캔들 혼입 대비 - fourHourCandleAnalysis.js와 동일한 근거)만큼 1분봉을 미리 받아둔다.
const REGULAR_SESSION_MINUTES_PER_DAY = 390
const RAW_CANDLE_BUFFER_MULTIPLIER = 1.8

function minMinuteCandlesForTradingDays(tradingDays) {
  return Math.ceil(tradingDays * REGULAR_SESSION_MINUTES_PER_DAY * RAW_CANDLE_BUFFER_MULTIPLIER)
}

const SUPPORTED_TIMEFRAMES = new Set(['30m', '1h', '4h', '1d', '1w'])

export function isSupportedChartTimeframe(timeframe) {
  return SUPPORTED_TIMEFRAMES.has(timeframe)
}

// timeframe: '30m' | '1h' | '4h' | '1d' | '1w'
// 반환: [{ date, timestamp, open, high, low, close, volume }, ...] (오래된 -> 최신 순)
export async function getChartCandles(code, timeframe) {
  if (!isSupportedChartTimeframe(timeframe)) {
    throw new Error(`지원하지 않는 시간봉: ${timeframe}`)
  }

  const accessToken = await getTossAccessToken()

  if (timeframe === '1d') {
    return fetchDailyOHLCV(accessToken, code, 300)
  }

  if (timeframe === '1w') {
    const daily = await fetchDailyOHLCV(accessToken, code, 700)
    return aggregateToWeeklyOHLCV(daily)
  }

  if (timeframe === '4h') {
    const candles = await getFourHourCandles(code)
    // getFourHourCandles(골든크로스와 공유하는 원본)는 { date, session, ... }만 주고
    // timestamp가 없다. 원본을 바꾸지 않고, 다른 시간봉과 형태를 맞추기 위해
    // date + session(AM=09:00 시작, PM=13:00 시작)만으로 시각을 계산해 덧붙인다.
    return candles.map((candle) => ({
      date: candle.date,
      timestamp: `${candle.date}T${candle.session === 'AM' ? '09:00:00' : '13:00:00'}.000+09:00`,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
    }))
  }

  if (timeframe === '30m') {
    const minuteCandles = await fetchMinuteCandles(accessToken, code, minMinuteCandlesForTradingDays(60))
    return aggregateToFixedMinuteCandles(minuteCandles, 30)
  }

  // '1h'
  const minuteCandles = await fetchMinuteCandles(accessToken, code, minMinuteCandlesForTradingDays(90))
  return aggregateToFixedMinuteCandles(minuteCandles, 60)
}
