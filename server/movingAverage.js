// 역할: 이동평균 계산만 담당하는 순수 함수. 일봉/4시간봉 등 어떤 시간봉의
// 종가 배열이든 상관없이 재사용할 수 있도록 데이터 공급 로직과 완전히 분리해 둔다.

// values: 종가 배열(오래된 -> 최신 순), period: 이동평균 기간(예: 200).
// 앞쪽 (period - 1)개는 평균 낼 데이터가 부족하므로 가짜 값 대신 null을 넣는다.
export function calculateMovingAverages(values, period) {
  if (!Array.isArray(values) || !Number.isInteger(period) || period < 1) {
    return []
  }

  const result = new Array(values.length).fill(null)
  let windowSum = 0

  for (let i = 0; i < values.length; i++) {
    windowSum += values[i]
    if (i >= period) {
      windowSum -= values[i - period]
    }
    if (i >= period - 1) {
      result[i] = windowSum / period
    }
  }

  return result
}
