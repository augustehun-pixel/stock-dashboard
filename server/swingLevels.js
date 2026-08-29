// 역할: 골든크로스를 기준으로 한 "기준 저점"과 "확정된 가장 최근 고점"을 계산하는 순수 로직.
// API 호출, 토큰, MA200 계산은 이 파일에 절대 넣지 않는다(역할 분리) -
// crossoverAnalysis.js가 이미 확보된 dailySeries(날짜/close/high/low/ma200)를 넘겨준다.
//
// "확정된 가장 최근 고점" 규칙은 2026-08-29 세션에서 확정됨(findConfirmedHigh 참고,
// docs/golden-cross-peak-rule-progress.md에 근거 기록). listPostGoldenCrossHighCandidates는
// 이 규칙과 무관한 별개 조사(골든크로스 "이후" 구간)이므로 그대로 둔다.

// dailySeries: [{ date, close, high, low, ma200 }, ...] (오래된 -> 최신, 날짜순 정렬됨)
// goldenCrossDate: "YYYY-MM-DD" (골든크로스가 확정된 거래일)
//
// look-ahead 금지: date < goldenCrossDate인 지점만 본다(당일과 그 이후는 절대 포함하지 않음).
// closePrice가 아니라 실제 저가(low)를 기준으로 가장 낮은 지점을 찾는다.
// 반환: { searchStartDate, searchEndDateExclusive, date, low } | null (이전 데이터가 하나도 없으면 null)
export function findReferenceLow(dailySeries, goldenCrossDate) {
  if (!Array.isArray(dailySeries) || dailySeries.length === 0) return null

  const beforeGoldenCross = dailySeries.filter(
    (day) => day.date < goldenCrossDate && day.low !== null && day.low !== undefined,
  )
  if (beforeGoldenCross.length === 0) return null

  let lowest = beforeGoldenCross[0]
  for (const day of beforeGoldenCross) {
    if (day.low < lowest.low) lowest = day
  }

  return {
    searchStartDate: beforeGoldenCross[0].date,
    searchEndDateExclusive: goldenCrossDate,
    date: lowest.date,
    low: lowest.low,
  }
}

// look-ahead 금지의 반대 방향: date > goldenCrossDate인 지점만 후보로 내놓는다
// (골든크로스 당일과 그 이전은 "이후 고점" 후보에 포함하지 않는다).
// 여기서 "이 중 어떤 게 진짜 고점인지"는 절대 고르지 않는다 - 사람이 다음 단계에서 정의한다.
// 반환: [{ date, high }, ...] (오래된 -> 최신)
export function listPostGoldenCrossHighCandidates(dailySeries, goldenCrossDate) {
  if (!Array.isArray(dailySeries) || dailySeries.length === 0) return []

  return dailySeries
    .filter((day) => day.date > goldenCrossDate && day.high !== null && day.high !== undefined)
    .map((day) => ({ date: day.date, high: day.high }))
}

// "확정된 가장 최근 고점"의 후보 재료: 로컬 피크(전날 고가 < 오늘 고가 > 다음날 고가).
// 탐색 구간: 기준 저점(exclusive) ~ 골든크로스(exclusive).
// look-ahead 금지: "다음날"이 골든크로스 당일 이상이면 그 날은 절대 후보로 확정할 수 없으므로 제외.
// (docs/golden-cross-peak-rule-progress.md의 scratchpad 재사용 로직을 그대로 옮긴 것 - 정의 변경 없음)
function findLocalPeakCandidates(dailySeries, referenceLowDate, goldenCrossDate) {
  const candidates = []
  for (let i = 1; i < dailySeries.length - 1; i++) {
    const day = dailySeries[i]
    const prev = dailySeries[i - 1]
    const next = dailySeries[i + 1]
    if (day.date <= referenceLowDate) continue
    if (day.date >= goldenCrossDate) continue
    if (next.date >= goldenCrossDate) continue
    if (day.high > prev.high && day.high > next.high) {
      candidates.push({ date: day.date, high: day.high })
    }
  }
  return candidates
}

// "확정된 가장 최근 고점" 규칙 (2026-08-29 세션에서 확정, docs 기록 참고):
// 1) 기준 저점 이후 ~ 골든크로스 이전 구간에서 로컬 피크(전날<오늘>다음날)를 찾고,
//    그중 골든크로스에 가장 가까운 것을 "확정된 로컬 피크"로 둔다.
// 2) 골든크로스 직전 거래일은 "다음날"이 골든크로스 당일이라 위 방식으로는 절대 로컬
//    피크로 확정될 수 없는 구조적 한계가 있다(findLocalPeakCandidates가 항상 제외함).
//    그래서 그 직전 거래일의 고가가 (1)에서 찾은 확정 로컬 피크보다 더 높다면
//    (= 골든크로스 직전까지 이미 그 로컬 피크를 넘어서며 계속 상승 중이었다는 뜻)
//    로컬 피크 대신 그 직전 거래일을 고점으로 채택한다. 그렇지 않다면(더 낮거나 로컬
//    피크가 없다면) 기존처럼 확정 로컬 피크를 그대로 쓴다.
// look-ahead 금지: 골든크로스 당일 및 이후 데이터는 여기서 전혀 참조하지 않는다 - "직전
// 거래일" 자체가 이미 date < goldenCrossDate로 한정된 값이다.
// 반환: { date, high } | null (기준 저점 이후 데이터가 하나도 없으면 null)
export function findConfirmedHigh(dailySeries, referenceLowDate, goldenCrossDate) {
  if (!Array.isArray(dailySeries) || dailySeries.length === 0) return null

  const lastConfirmedLocalPeak = findLocalPeakCandidates(dailySeries, referenceLowDate, goldenCrossDate).at(-1) ?? null

  const dayBeforeGoldenCross = dailySeries
    .filter((day) => day.date > referenceLowDate && day.date < goldenCrossDate)
    .at(-1) ?? null

  if (
    dayBeforeGoldenCross &&
    (!lastConfirmedLocalPeak || dayBeforeGoldenCross.high > lastConfirmedLocalPeak.high)
  ) {
    return { date: dayBeforeGoldenCross.date, high: dayBeforeGoldenCross.high }
  }

  return lastConfirmedLocalPeak
}
