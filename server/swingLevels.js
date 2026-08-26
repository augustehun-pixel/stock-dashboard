// 역할: 골든크로스를 기준으로 한 "기준 저점"과 "고점 후보"만 계산하는 순수 로직.
// API 호출, 토큰, MA200 계산은 이 파일에 절대 넣지 않는다(역할 분리) -
// crossoverAnalysis.js가 이미 확보된 dailySeries(날짜/close/high/low/ma200)를 넘겨준다.
//
// 중요: "가장 최근 고점"이 무엇인지는 아직 정의되지 않았다. 이 파일은 그 정의를
// 절대 임의로 만들지 않는다 - 골든크로스 이후의 고가(high) 후보를 날짜순으로
// 나열만 하고, 그중 무엇을 "고점"으로 볼지 고르는 로직은 넣지 않는다.

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
