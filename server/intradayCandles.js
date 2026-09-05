// 역할: 1분봉 배열을 "N분봉"(예: 30분, 60분)으로 합성하는 순수 계산 로직만 담당.
// fourHourCandles.js(AM/PM 2세션 합성)와 같은 원칙을 따르되, 세션을 고정 2개로 나누는 대신
// 정규장 시작(09:00)부터 bucketMinutes 간격으로 나눈다. 정규장(09:00~15:30) 밖의 캔들
// (장전/시간외)은 쓰지 않고, 캔들이 하나도 없는 구간은 만들지 않는다(가짜 값 금지).
//
// data.js도, fourHourCandles.js도 건드리지 않는다 - 상세 차트 전용 새 파일이다.

// export: breakoutFeed.js가 "미완성 캔들 필터링"에 정규장 경계를 그대로 재사용하기 위해
// 노출한다(값/로직 변경 없음, 가시성만 추가).
export const SESSION_START_MINUTE = 9 * 60 // 09:00
export const SESSION_END_MINUTE = 15 * 60 + 30 // 15:30

function resolveBucketStartMinute(timestamp, bucketMinutes) {
  const hour = Number(timestamp.slice(11, 13))
  const minute = Number(timestamp.slice(14, 16))
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null

  const minuteOfDay = hour * 60 + minute
  if (minuteOfDay < SESSION_START_MINUTE || minuteOfDay > SESSION_END_MINUTE) return null

  const offset = minuteOfDay - SESSION_START_MINUTE
  const bucketIndex = Math.floor(offset / bucketMinutes)
  return SESSION_START_MINUTE + bucketIndex * bucketMinutes
}

function formatBucketTimestamp(date, bucketStartMinute) {
  const hh = String(Math.floor(bucketStartMinute / 60)).padStart(2, '0')
  const mm = String(bucketStartMinute % 60).padStart(2, '0')
  return `${date}T${hh}:${mm}:00.000+09:00`
}

// minuteCandles: [{ timestamp, open, high, low, close, volume }, ...] (순서 무관)
// 반환: [{ date, timestamp, open, high, low, close, volume }, ...] (오래된 -> 최신 순).
// timestamp는 버킷 "시작" 시각(KST, "+09:00" 고정 - 실제 응답 형식과 동일)이다.
export function aggregateToFixedMinuteCandles(minuteCandles, bucketMinutes) {
  if (!Array.isArray(minuteCandles) || minuteCandles.length === 0) return []
  if (!Number.isInteger(bucketMinutes) || bucketMinutes < 1) return []

  const buckets = new Map()

  for (const candle of minuteCandles) {
    const bucketStartMinute = resolveBucketStartMinute(candle.timestamp, bucketMinutes)
    if (bucketStartMinute === null) continue // 정규장 밖 캔들은 쓰지 않는다.

    const date = candle.timestamp.slice(0, 10)
    const bucketKey = `${date}-${bucketStartMinute}`

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { date, bucketStartMinute, candles: [] })
    }
    buckets.get(bucketKey).candles.push(candle)
  }

  const result = []
  for (const { date, bucketStartMinute, candles } of buckets.values()) {
    if (candles.length === 0) continue // 방어적 체크(이론상 발생하지 않음).

    candles.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    const open = candles[0].open
    const close = candles[candles.length - 1].close
    const high = Math.max(...candles.map((c) => c.high))
    const low = Math.min(...candles.map((c) => c.low))

    const hasVolume = candles.every((c) => c.volume !== null && Number.isFinite(c.volume))
    const volume = hasVolume ? candles.reduce((sum, c) => sum + c.volume, 0) : null

    result.push({
      date,
      timestamp: formatBucketTimestamp(date, bucketStartMinute),
      open,
      high,
      low,
      close,
      volume,
    })
  }

  return result.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}
