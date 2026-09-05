// 역할: trading-rules/breakout.md 기준 돌파매매 구조(H1-L-H2-추세선-돌파-진입-손절) 순수 계산 로직.
// API 호출, 캔들 수집, timeframe 조립은 이 파일에 넣지 않는다(orderBlock.js와 동일한 역할 분리) -
// 이미 조립된 OHLCV 캔들 배열(오래된 -> 최신 순, chartCandles.js와 동일한 필드 구조:
// { open, high, low, close, volume, timestamp?, date? })을 그대로 받아서 계산만 한다.
//
// V1 범위(문서 15절 익절 정책)에 따라 TAKE_PROFIT은 계산하지 않는다(MANUAL).
//
// 이 파일에서 사용하는 두 가지 세부 규칙은 breakout.md에 문구 그대로 명시되어 있지 않고,
// 2026-09-05 세션에서 사용자에게 직접 확인받은 내용이다(문서 16절 원칙에 따라 임의로 만들지 않음):
//   1) H1 판정 기준: "다음 봉의 high가 현재 봉의 high보다 낮으면 그 고점을 H1으로 본다."
//      (좌우 N봉 비교가 아니라 바로 다음 한 봉만 보는 단측 비교 - fractal/pivot 아님)
//   2) H1/H2의 "가격(price)"은 캔들의 high 필드를 사용한다("고점"이라는 표현에 따른 자연스러운 선택).
// 문서가 이 두 가지를 공식적으로 규정하도록 갱신할지는 사용자가 별도로 판단한다(이 파일에서
// trading-rules/breakout.md를 수정하지 않는다).

const MAX_H1_H2_DISTANCE = 100 // 문서 6절: H1~최종 H2 거리는 100캔들 이내

function getCandleTime(candle) {
  return candle.timestamp ?? candle.date ?? null
}

// 입력 데이터 안전성 가드(매매 규칙 아님). chartCandles.js는 실제 API에 거래량이 없으면
// volume을 null로 채울 수 있다. null은 숫자 비교에서 0으로 취급되어(`null > 1000` → false지만
// `1000 > null` → true) H1/H2의 거래량이 null일 때 이후 비교가 항상 통과해버리는 거짓 신호를
// 만들 수 있다. 그래서 H1/H2/Breakout 확정에는 항상 유효한 숫자 거래량만 인정한다.
function hasValidVolume(candle) {
  return typeof candle.volume === 'number' && Number.isFinite(candle.volume)
}

// trading-rules/breakout.md 맨 끝 "핵심 판정 로직" 블록을 그대로 옮긴 순수 판정 함수.
// H1/H2 자체를 찾는 로직(아래 detectBreakoutState)과는 분리되어 있다 - 이미 식별된 값들을
// 받아서 문서의 AND 조건만 그대로 평가한다.
export function isStructureValid({
  h1Price,
  h1Volume,
  h2Price,
  h2Volume,
  distance,
  trendlineSlope,
  lMaintained,
}) {
  return (
    h2Price > h1Price &&
    h2Volume > h1Volume &&
    distance <= MAX_H1_H2_DISTANCE &&
    trendlineSlope > 0 &&
    lMaintained
  )
}

// H1과 최종 H2를 연결한 고점 추세선의, 임의의 인덱스 시점 값(문서 8절: "각 이후 캔들 시점에서
// 계산할 수 있게 한다"). h1/h2는 { index, price } 형태.
export function calculateTrendlineValueAt(h1, h2, index) {
  const slope = (h2.price - h1.price) / (h2.index - h1.index)
  return h1.price + slope * (index - h1.index)
}

// candles: [{ open, high, low, close, volume, timestamp?, date? }, ...] (오래된 -> 최신 순).
// 항상 "가장 최근에 형성된" 구조만 평가한다(문서 9절) - 과거 H1/H2로 되돌아가 다른 유효 구조를
// 찾지 않는다. 반환값은 마지막 캔들 시점 기준 현재 상태 하나뿐이다.
//
// status:
//   'NO_STRUCTURE'        H1조차 아직 형성되지 않음(탐색 중)
//   'WAITING_FOR_H2'      H1은 있고 최종 H2 확정 대기 중
//   'WAITING_FOR_BREAKOUT' 유효한 H1-L-H2 구조 완성, 추세선 돌파 대기 중(문서 7절 - 시간 제한 없음)
//   'INVALID'             구조 무효화(거리 초과 또는 L 하회) - 새 H1부터 다시 탐색
//   'ENTRY_VALID'         돌파봉이 몸통/거래량 조건을 모두 만족해 진입
//   'STOP_LOSS'           진입 이후 몸통이 추세선 아래에서 마감
export function detectBreakoutState(candles) {
  const empty = {
    status: 'NO_STRUCTURE',
    h1: null,
    h2: null,
    l: null,
    trendlineSlope: null,
    entryIndex: null,
    stopLossIndex: null,
  }

  if (!Array.isArray(candles) || candles.length === 0) return empty

  let status = 'NO_STRUCTURE'
  let h1 = null
  let h2 = null
  let l = null
  let runningLow = null
  let entryIndex = null
  let stopLossIndex = null

  let index = 0
  while (index < candles.length) {
    const candle = candles[index]

    // H1 탐색 중(처음이거나, 이전 구조가 무효화된 이후 - 문서 8·9절: 새 H1부터 다시 찾는다).
    if (status === 'NO_STRUCTURE' || status === 'INVALID') {
      const next = candles[index + 1]
      // 사용자 확인 기준: 다음 봉의 high가 낮아지면(=눌림 시작) 현재 봉이 H1 후보.
      // hasValidVolume: H1의 거래량이 향후 H2/Breakout 비교의 기준값이 되므로, 유효한
      // 숫자가 아니면 이 봉은 H1으로 확정하지 않는다(입력 안전성, 매매 규칙 아님).
      if (next && next.high < candle.high && hasValidVolume(candle)) {
        h1 = { index, time: getCandleTime(candle), price: candle.high, volume: candle.volume }
        h2 = null
        l = null
        runningLow = candle.low
        status = 'WAITING_FOR_H2'
      }
      index += 1
      continue
    }

    // H1 이후 눌림 -> 재상승 구간에서 H2 후보를 관찰(문서 4·5절).
    if (status === 'WAITING_FOR_H2') {
      runningLow = Math.min(runningLow, candle.low)

      // 문서 6절: H1~H2 거리가 100캔들을 넘으면 이 시점에 확정될 후보는 이미 무효.
      // 과거 H1을 다시 찾지 않고 새 구조 탐색으로 넘어간다.
      if (index - h1.index > MAX_H1_H2_DISTANCE) {
        status = 'INVALID'
        index += 1
        continue
      }

      // 필수 조건(문서 4절): price(H2) > price(H1) AND Volume(H2) > Volume(H1), 반드시 AND.
      // 둘 중 하나라도 실패하면(중간 고점) H1/구조/L 구간을 그대로 유지하고 계속 관찰한다.
      // hasValidVolume: 이 봉의 거래량이 향후 Breakout 비교의 기준값이 되므로 먼저 확인한다.
      if (hasValidVolume(candle) && candle.high > h1.price && candle.volume > h1.volume) {
        h2 = { index, time: getCandleTime(candle), price: candle.high, volume: candle.volume }
        l = runningLow // 문서 5절: H1~최종 H2 구간 전체의 최저 low
        status = 'WAITING_FOR_BREAKOUT'
      }
      index += 1
      continue
    }

    // 유효한 H1-L-H2 구조 완성, 실제 돌파를 기다린다(문서 7절: 대기 시간 제한 없음).
    if (status === 'WAITING_FOR_BREAKOUT') {
      // 문서 8절: 대기 중 price < L이면 구조 무효화. 과거 구조로 되돌아가지 않는다.
      if (candle.low < l) {
        status = 'INVALID'
        index += 1
        continue
      }

      const trendlineValue = calculateTrendlineValueAt(h1, h2, index)
      // 문서 11·12절: 돌파봉 몸통 전체가 추세선 위 AND Volume(Breakout) > Volume(H2).
      // 꼬리만 넘은 경우(min(open,close)가 추세선 아래)는 여기서 통과하지 못하고 계속 대기한다.
      // hasValidVolume: 돌파봉 거래량이 유효한 숫자가 아니면 진입시키지 않는다(입력 안전성).
      if (
        hasValidVolume(candle) &&
        Math.min(candle.open, candle.close) > trendlineValue &&
        candle.volume > h2.volume
      ) {
        entryIndex = index
        status = 'ENTRY_VALID'
      }
      index += 1
      continue
    }

    // 진입 이후 손절 조건 감시(문서 14절).
    if (status === 'ENTRY_VALID') {
      const trendlineValue = calculateTrendlineValueAt(h1, h2, index)
      // 몸통 전체가 추세선 아래에서 마감해야 손절. 꼬리만 아래로 내려간 경우는 손절 아님.
      if (Math.max(candle.open, candle.close) < trendlineValue) {
        stopLossIndex = index
        status = 'STOP_LOSS'
      }
      index += 1
      continue
    }

    // STOP_LOSS: V1 범위에서는 손절 이후의 재탐색 규칙이 문서에 없으므로 여기서 멈춘다.
    break
  }

  return {
    status,
    h1,
    h2,
    l,
    trendlineSlope: h1 && h2 ? (h2.price - h1.price) / (h2.index - h1.index) : null,
    entryIndex,
    stopLossIndex,
  }
}
