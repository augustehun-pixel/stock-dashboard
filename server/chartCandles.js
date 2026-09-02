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

// 차트 표시용 4시간봉 PM(오후) 캔들 마감 보정 --------------------------------------
// fourHourCandles.js의 PM 세션은 13:00~15:30(분단위 930)까지만 담는데, 실측 결과
// (005930, 여러 거래일 확인) 정규장 마감 동시호가 체결은 항상 "15:31" 라벨의 1분봉으로
// 찍히고(체결 시각이 정확히 15:30:00이라 다음 분 경계로 넘어가는 것으로 보임 - 09:00 개장
// 동시호가가 "09:01" 라벨로 찍혀 자연스럽게 포함되는 것과 대칭되는 현상), 그 다음
// (15:32~)은 시간외 거래(15:40 이후)가 시작되기 전까지 거래량 0으로 비어 있다.
// 이 라벨링 특성은 특정 하루만이 아니라 모든 거래일에 동일하게 적용되므로(실측으로 여러
// 날짜에서 확인), "가장 최근 캔들만" 보정하면 다른 과거 PM 캔들과 종가 기준이 달라져
// 오히려 일관성이 깨진다 - 그래서 PM 캔들 전체에 같은 규칙을 적용한다.
// golden-cross/Fibonacci가 쓰는 aggregateToFourHourCandles(fourHourCandles.js)의 세션
// 경계는 건드리지 않고(공유 로직 변경 금지), 차트에 보여줄 PM 캔들만 이 마감 동시호가
// 체결가로 보정한다.
const SHARED_PM_SESSION_END_MINUTE = 15 * 60 + 30 // 15:30 (fourHourCandles.js와 동일)
const CLOSING_AUCTION_MINUTE = 15 * 60 + 31 // 15:31 (실측 확인)

// date(YYYY-MM-DD) -> 그날 마감 동시호가 체결 1분봉. minuteCandles 전체를 한 번만 훑어서
// (930, 931] 구간에 걸리는 캔들만 날짜별로 모아둔다(4시간봉 개수만큼 매번 훑지 않기 위함).
function buildClosingAuctionCandlesByDate(minuteCandles) {
  const byDate = new Map()
  for (const candle of minuteCandles) {
    const hour = Number(candle.timestamp.slice(11, 13))
    const minute = Number(candle.timestamp.slice(14, 16))
    const minuteOfDay = hour * 60 + minute
    if (minuteOfDay <= SHARED_PM_SESSION_END_MINUTE || minuteOfDay > CLOSING_AUCTION_MINUTE) continue
    byDate.set(candle.timestamp.slice(0, 10), candle)
  }
  return byDate
}

function applyRegularSessionCloseAuction(fourHourCandles, minuteCandles) {
  if (fourHourCandles.length === 0) return fourHourCandles

  const auctionByDate = buildClosingAuctionCandlesByDate(minuteCandles)
  if (auctionByDate.size === 0) return fourHourCandles

  return fourHourCandles.map((candle) => {
    if (candle.session !== 'PM') return candle // 보정 대상은 PM(장마감) 캔들뿐

    const auction = auctionByDate.get(candle.date)
    // 마감 동시호가 체결 데이터가 아직 없으면(장중이거나 데이터 지연) 그대로 둔다 - 가짜 값 금지.
    if (!auction) return candle

    const hasVolume =
      candle.volume !== null && auction.volume !== null && Number.isFinite(auction.volume)

    return {
      ...candle,
      close: auction.close,
      high: Math.max(candle.high, auction.high),
      low: Math.min(candle.low, auction.low),
      volume: hasVolume ? candle.volume + auction.volume : candle.volume,
    }
  })
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
    const minuteCandles = await fetchMinuteCandles(accessToken, code, minMinuteCandlesForTradingDays(3))
    const corrected = applyRegularSessionCloseAuction(candles, minuteCandles)
    // getFourHourCandles(골든크로스와 공유하는 원본)는 { date, session, ... }만 주고
    // timestamp가 없다. 원본을 바꾸지 않고, 다른 시간봉과 형태를 맞추기 위해
    // date + session(AM=09:00 시작, PM=13:00 시작)만으로 시각을 계산해 덧붙인다.
    return corrected.map((candle) => ({
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
