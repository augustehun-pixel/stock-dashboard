// 역할: 일봉 MA200과 4시간봉 MA200을 시간 정렬해서 비교하고, 골든크로스/데드크로스가
// 발생한 지점을 찾아내는 "순수 계산" 로직만 담당한다. 데이터를 어디서 어떻게 가져오는지는
// 이 파일이 알 필요가 없다(역할 분리) - crossoverAnalysis.js가 데이터를 붙여서 넘겨준다.

// look-ahead(미래 데이터 사용) 금지 규칙:
// 일봉 MA200은 해당 거래일 "장 마감 후"에야 확정된다. 그래서 어떤 4시간봉이든(오전 09:00~12:59든
// 오후 13:00~15:30든 상관없이) 같은 날짜의 일봉 MA200은 아직 확정 전이라 쓸 수 없다.
// 대신 그 4시간봉 날짜보다 "이전" 거래일 중 가장 최근에 확정된 일봉 MA200을 사용한다.
//
// fourHourSeriesWithMA: [{ date, session, close, ma200 }, ...] (오래된 -> 최신, 날짜순 정렬됨)
// dailySeries: [{ date, close, ma200 }, ...] (오래된 -> 최신, 날짜순 정렬됨)
// 반환: [{ date, session, fourHourMA200, dailyMA200, dailyMA200AsOfDate }, ...]
//       (둘 다 값이 있는 지점만. 어느 한쪽이라도 없으면 그 지점은 만들지 않는다 - 가짜 값 금지)
export function alignFourHourWithDailyMA200(fourHourSeriesWithMA, dailySeries) {
  if (!Array.isArray(fourHourSeriesWithMA) || !Array.isArray(dailySeries)) return []

  let dailyPointer = -1
  const aligned = []

  for (const bar of fourHourSeriesWithMA) {
    // dailyPointer 바로 다음 일봉의 날짜가 이 4시간봉 날짜보다 "이전"인 동안 계속 전진한다.
    // (같은 날짜는 절대 포함하지 않는다 - 아직 확정 전이므로)
    while (dailyPointer + 1 < dailySeries.length && dailySeries[dailyPointer + 1].date < bar.date) {
      dailyPointer += 1
    }

    if (dailyPointer < 0) continue // 이 4시간봉보다 이전에 확정된 일봉이 아직 하나도 없음
    const confirmedDaily = dailySeries[dailyPointer]

    if (bar.ma200 === null || confirmedDaily.ma200 === null) continue // 둘 다 있어야 비교 가능

    aligned.push({
      date: bar.date,
      session: bar.session,
      fourHourMA200: bar.ma200,
      dailyMA200: confirmedDaily.ma200,
      dailyMA200AsOfDate: confirmedDaily.date,
    })
  }

  return aligned
}

// aligned: alignFourHourWithDailyMA200()의 결과 (오래된 -> 최신)
// 골든크로스: 이전 지점 4시간MA200 <= 일봉MA200  ->  현재 지점 4시간MA200 > 일봉MA200
// 데드크로스: 이전 지점 4시간MA200 >= 일봉MA200  ->  현재 지점 4시간MA200 < 일봉MA200
// "이전 vs 현재"를 비교해야 하므로 최소 2개 지점이 있어야 판정할 수 있다.
export function detectCrossovers(aligned) {
  const events = []

  for (let i = 1; i < aligned.length; i++) {
    const prev = aligned[i - 1]
    const curr = aligned[i]

    if (prev.fourHourMA200 <= prev.dailyMA200 && curr.fourHourMA200 > curr.dailyMA200) {
      events.push({ date: curr.date, session: curr.session, type: 'golden' })
    }

    if (prev.fourHourMA200 >= prev.dailyMA200 && curr.fourHourMA200 < curr.dailyMA200) {
      events.push({ date: curr.date, session: curr.session, type: 'dead' })
    }
  }

  const latest = aligned.length > 0 ? aligned[aligned.length - 1] : null
  let currentState = null
  if (latest) {
    if (latest.fourHourMA200 > latest.dailyMA200) currentState = 'above'
    else if (latest.fourHourMA200 < latest.dailyMA200) currentState = 'below'
    else currentState = 'equal'
  }

  const latestGolden = events.filter((e) => e.type === 'golden').at(-1) ?? null
  const latestDead = events.filter((e) => e.type === 'dead').at(-1) ?? null

  return { events, currentState, latest, latestGolden, latestDead }
}
