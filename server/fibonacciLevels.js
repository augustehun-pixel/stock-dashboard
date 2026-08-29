// 역할: 이미 확정된 기준 저점(referenceLow)과 확정 고점(confirmedHigh)만 입력받아
// Fibonacci 되돌림 레벨(0.5, 0.618)의 가격을 계산하고, 골든크로스 이후 일봉에서 그
// 레벨에 실제로 도달했는지/구조가 무효화됐는지를 판정하는 순수 계산 로직만 담당한다.
// API 호출, 토큰, MA200/골든크로스/기준저점/확정고점 계산은 이 파일에 절대 넣지 않는다
// (역할 분리) - crossoverAnalysis.js가 이미 확보된 dailySeries와 referenceLow/confirmedHigh를
// 넘겨준다.
//
// 규칙 근거 (2026-08-29 세션에서 사용자가 하나씩 확정한 Fibonacci 매매 규칙):
// - 사용 레벨: 0.5, 0.618만 (우선순위 없음, 각각 독립적으로 취급)
// - 기준 저점 = Fib 1(100%), 확정 고점 = Fib 0(0%)
// - 레벨 도달 판정: 그날의 저가(low)가 레벨 가격 이하면 도달 (종가는 사용하지 않음)
// - 감시 시작: 골든크로스 당일부터 즉시
// - 구조 무효 조건: 종가(close)가 기준 저점 아래로 마감하면 그 시점부터 무효
// - 매수/매도 신호, 다른 조건과의 결합 등은 아직 미정 - 이 파일에서 절대 임의로 추가하지 않는다.

const FIBONACCI_LEVELS = [0.5, 0.618]

// Price(L) = confirmedHigh - L * (confirmedHigh - referenceLow)
function calculateFibonacciPrice(level, referenceLow, confirmedHigh) {
  return confirmedHigh - level * (confirmedHigh - referenceLow)
}

// dailySeries: [{ date, close, high, low, ma200 }, ...] (오래된 -> 최신, 날짜순 정렬됨)
// goldenCrossDate: "YYYY-MM-DD" (감시 시작일, 포함)
// referenceLow / confirmedHigh: 숫자(가격) - 이미 골든크로스 이전 데이터만으로 확정된 값을
// 그대로 받아 쓴다. 이 함수는 그 값을 절대 재계산하지 않는다.
//
// look-ahead 금지: 기준 저점/확정 고점은 여기서 다시 계산하지 않고 입력받은 값을 그대로
// 쓰므로, 골든크로스 이후 데이터를 아무리 훑어도 과거 판단(저점/고점)이 바뀌지 않는다.
// 도달/무효 판정도 감시 구간(date >= goldenCrossDate) 안에서 실제 존재하는 날짜를 오래된
// 순서대로 훑어 "최초로 조건을 만족한 날"만 기록할 뿐, 미래 특정 시점을 미리 참조해서
// 더 이른 날짜의 결과를 앞당기는 일은 없다.
//
// 무효화 이후 처리 (2026-08-29 세션에서 확정된 규칙): 골든크로스 당일부터 날짜순으로
// 하루씩 처리하되, 같은 거래일 안에서는 (1) 그날 저가로 아직 기록되지 않은 레벨의 최초
// 도달만 먼저 기록한 다음 (2) 그날 종가로 무효 여부를 판정한다 - 장중 저가와 종가 중
// 어느 쪽이 먼저 발생했는지 알 수 없으므로, 무효화 당일의 저가 도달은 유효하게 기록한
// 뒤에 종가로 무효 처리한다. 무효로 판정된 날짜(invalidatedDate) 이후의 거래일은 아예
// 순회를 멈춰서, 그 이후의 저가가 레벨에 닿아도 현재 구조의 도달로 절대 기록되지 않는다.
export function calculateFibonacciAnalysis(dailySeries, goldenCrossDate, referenceLow, confirmedHigh) {
  const fibonacciLevels = {}
  for (const level of FIBONACCI_LEVELS) {
    fibonacciLevels[level] = calculateFibonacciPrice(level, referenceLow, confirmedHigh)
  }

  const watchWindow = Array.isArray(dailySeries)
    ? dailySeries.filter((day) => day.date >= goldenCrossDate)
    : []

  const levelStatus = {}
  for (const level of FIBONACCI_LEVELS) {
    levelStatus[level] = { reached: false, firstReachedDate: null }
  }

  let invalidatedDate = null

  for (const day of watchWindow) {
    // 1) 그날의 저가로, 아직 도달 기록이 없는 레벨만 확인해 최초 도달일을 기록한다.
    for (const level of FIBONACCI_LEVELS) {
      const status = levelStatus[level]
      if (!status.reached && day.low !== null && day.low !== undefined && day.low <= fibonacciLevels[level]) {
        status.reached = true
        status.firstReachedDate = day.date
      }
    }

    // 2) 그날의 종가로 무효 여부를 확인한다. 무효면 이 거래일까지만 기록하고 순회를 멈춘다 -
    //    그 다음 거래일부터는 현재 구조의 도달 여부를 더 이상 검사하지 않는다.
    if (day.close !== null && day.close !== undefined && day.close < referenceLow) {
      invalidatedDate = day.date
      break
    }
  }

  return {
    referenceLow,
    confirmedHigh,
    fibonacciLevels,
    levelStatus,
    isValid: invalidatedDate === null,
    invalidatedDate,
  }
}
