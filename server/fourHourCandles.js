// 역할: 1분봉 배열을 "4시간봉"으로 합성하는 순수 계산 로직만 담당.
// 데이터를 어떻게 가져오는지(minuteCandles.js)나 나중에 이걸로 뭘 계산하는지(이동평균 등)는
// 이 파일이 알 필요가 없다(역할 분리).
//
// 고정 규칙 (한국 정규장 기준):
//  - 첫 번째 구간: 09:00 ~ 12:59
//  - 두 번째 구간: 13:00 ~ 15:30
//  - 날짜가 다르면 절대 같은 구간으로 합치지 않는다 (버킷 키에 날짜를 포함)
//  - 위 두 구간을 벗어나는 캔들(장 시작 전, 시간외/연장거래 등)은 사용하지 않는다
//  - 어느 구간에 캔들이 하나도 없으면(휴장일 등) 그 구간 자체를 만들지 않는다 (가짜 값 금지)

// timestamp는 항상 "YYYY-MM-DDTHH:mm:ss.sss+09:00" 형식으로 온다(실제 응답으로 확인함).
// new Date().getHours()는 서버 실행 환경의 시간대에 따라 달라질 수 있어 위험하므로,
// 문자열에서 시:분을 직접 잘라내 KST 기준 시각을 안전하게 구한다.
// export: breakoutFeed.js가 "미완성 캔들 필터링"에 4시간봉 AM/PM 세션 경계를 그대로
// 재사용하기 위해 노출한다(값/로직 변경 없음, 가시성만 추가).
export const SESSIONS = [
  { label: 'AM', startMinute: 9 * 60, endMinute: 13 * 60 - 1 }, // 09:00 ~ 12:59
  { label: 'PM', startMinute: 13 * 60, endMinute: 15 * 60 + 30 }, // 13:00 ~ 15:30
]

function resolveSession(timestamp) {
  const hour = Number(timestamp.slice(11, 13))
  const minute = Number(timestamp.slice(14, 16))
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null

  const minuteOfDay = hour * 60 + minute
  for (const session of SESSIONS) {
    if (minuteOfDay >= session.startMinute && minuteOfDay <= session.endMinute) {
      return session.label
    }
  }
  return null
}

// minuteCandles: [{ timestamp, open, high, low, close, volume }, ...] (순서 무관)
// 반환: [{ date, session, open, high, low, close, volume }, ...] (오래된 -> 최신 순)
export function aggregateToFourHourCandles(minuteCandles) {
  if (!Array.isArray(minuteCandles) || minuteCandles.length === 0) return []

  // 날짜(YYYY-MM-DD) + 세션(AM/PM)을 키로 묶는다. 날짜가 다르면 키 자체가 달라지므로
  // 절대 서로 다른 날짜의 캔들이 하나로 합쳐지지 않는다.
  const buckets = new Map()

  for (const candle of minuteCandles) {
    const session = resolveSession(candle.timestamp)
    if (!session) continue // 정규장 시간 밖(장전/시간외) 캔들은 사용하지 않는다.

    const date = candle.timestamp.slice(0, 10)
    const bucketKey = `${date}-${session}`

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { date, session, candles: [] })
    }
    buckets.get(bucketKey).candles.push(candle)
  }

  const result = []
  for (const { date, session, candles } of buckets.values()) {
    if (candles.length === 0) continue // 방어적 체크(이론상 발생하지 않음).

    // 같은 구간 안에서 시간 순으로 정렬해야 시가/종가가 정확하게 나온다.
    candles.sort((a, b) => a.timestamp.localeCompare(b.timestamp))

    const open = candles[0].open
    const close = candles[candles.length - 1].close
    const high = Math.max(...candles.map((c) => c.high))
    const low = Math.min(...candles.map((c) => c.low))

    // volume이 하나라도 없으면 합계 자체가 부정확해지므로, 전부 있을 때만 합산하고
    // 아니면 null로 정직하게 비워둔다(가짜 값 금지).
    const hasVolume = candles.every((c) => c.volume !== null && Number.isFinite(c.volume))
    const volume = hasVolume ? candles.reduce((sum, c) => sum + c.volume, 0) : null

    result.push({ date, session, open, high, low, close, volume })
  }

  // 날짜 -> 세션(AM이 PM보다 먼저) 순서로 정렬해 오래된 -> 최신 순으로 만든다.
  return result.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    if (a.session === b.session) return 0
    return a.session === 'AM' ? -1 : 1
  })
}
