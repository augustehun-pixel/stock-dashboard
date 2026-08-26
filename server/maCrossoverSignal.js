// 역할: 일봉 MA200과 4시간봉 MA200을 "거래일 기준"으로 하나씩 짝지어 비교하고, 골든크로스/
// 데드크로스가 발생한 지점을 찾아내는 "순수 계산" 로직만 담당한다. 데이터를 어디서 어떻게
// 가져오는지는 이 파일이 알 필요가 없다(역할 분리) - crossoverAnalysis.js가 데이터를 붙여서 넘겨준다.

// 최종 전략 규칙: 골든/데드크로스는 4시간마다가 아니라 "하루에 한 번", 장 마감 후 확정된
// 값으로만 판정한다. 그래서 거래일당 비교값을 정확히 하나만 만든다:
//  - 일봉 MA200: 해당 거래일 장 마감 후 확정된 값
//  - 4시간봉 MA200: 해당 거래일의 오후(PM, 13:00~15:30) 구간 확정값
//    (오전 09:00~12:59 구간은 아직 장중이라 절대 쓰지 않는다 - 오전에 교차 모양이 나와도
//     그날의 최종 신호로 취급하면 안 되기 때문)
//
// look-ahead(미래 데이터 사용) 금지: 오후 구간 4시간봉 MA200과 그날의 일봉 MA200은 둘 다
// "같은 거래일 장 마감" 시점에 동시에 확정되는 값이라, 같은 날짜끼리 짝지어도 미래 데이터를
// 끌어다 쓰는 게 아니다. 배열 순서가 아니라 날짜(date) 값으로 직접 짝짓는다.
//
// fourHourSeriesWithMA: [{ date, session, close, ma200 }, ...] (오래된 -> 최신, 날짜순 정렬됨)
// dailySeries: [{ date, close, ma200 }, ...] (오래된 -> 최신, 날짜순 정렬됨)
// 반환: [{ date, session, fourHourMA200, dailyMA200 }, ...] (거래일당 최대 1개)
//       (둘 다 값이 있는 지점만. 어느 한쪽이라도 없으면 그 지점은 만들지 않는다 - 가짜 값 금지)
export function alignFourHourWithDailyMA200(fourHourSeriesWithMA, dailySeries) {
  if (!Array.isArray(fourHourSeriesWithMA) || !Array.isArray(dailySeries)) return []

  const dailyMA200ByDate = new Map(dailySeries.map((d) => [d.date, d.ma200]))
  const aligned = []

  for (const bar of fourHourSeriesWithMA) {
    if (bar.session !== 'PM') continue // 오전 구간은 장중이라 제외

    const dailyMA200 = dailyMA200ByDate.get(bar.date)
    if (bar.ma200 === null || dailyMA200 === undefined || dailyMA200 === null) continue // 둘 다 있어야 비교 가능

    aligned.push({
      date: bar.date,
      session: bar.session,
      fourHourMA200: bar.ma200,
      dailyMA200,
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
