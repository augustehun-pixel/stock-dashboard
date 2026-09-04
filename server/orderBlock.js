// 역할: docs/trading-rules/order-block.md 기준 Order Block Detection 순수 계산 로직.
// API 호출, 캔들 수집, timeframe별 데이터 조립은 이 파일에 절대 넣지 않는다(역할 분리) -
// 이미 조립된 OHLC 캔들 배열(어떤 timeframe이든 동일 규칙 적용 - 문서의 Timeframe Rule 참고)을
// 그대로 받아서 계산만 한다.
//
// Detection 필수 조건(문서 2·3절 일반 OB, 15·16·17절 이중장악형)만 구현한다. Quality
// 평가(문서 7절, bodyRatio 포함)는 여기서 판단하지 않고 계산 값만 함께 반환한다.

function isBearishCandle(candle) {
  return candle.close < candle.open
}

function isBullishCandle(candle) {
  return candle.close > candle.open
}

function getBodyHigh(candle) {
  return Math.max(candle.open, candle.close)
}

function getBodyLow(candle) {
  return Math.min(candle.open, candle.close)
}

function getBodySize(candle) {
  return Math.abs(candle.close - candle.open)
}

// 같은 가격도 포함하는 100% engulfing 판정(문서 3절 "같은 가격은 포함한다" -> >=/<=).
function engulfsBody(previous, current) {
  return getBodyHigh(current) >= getBodyHigh(previous) && getBodyLow(current) <= getBodyLow(previous)
}

function buildOrderBlock(type, index, current, previous) {
  const obHigh = getBodyHigh(previous)
  const obLow = getBodyLow(previous)
  const previousBodySize = getBodySize(previous)
  const currentBodySize = getBodySize(current)

  return {
    type,
    index,
    time: current.timestamp ?? current.date ?? null,
    obHigh,
    obLow,
    obMid: (obHigh + obLow) / 2,
    // 손절/무효화 판정(문서 7·8절)이 나중에 쓸 기준 캔들의 꼬리 실측값. 여기서는 값만 담아
    // 반환할 뿐, 이 파일의 detection 로직에는 전혀 쓰지 않는다.
    referenceHigh: previous.high,
    referenceLow: previous.low,
    previousBodySize,
    currentBodySize,
    // Quality 평가(문서 10절)용 값. Detection 조건으로는 절대 쓰지 않는다.
    bodyRatio: currentBodySize / previousBodySize,
  }
}

// 이중장악형(문서 14~17절) 결과 객체 조립. 기존 buildOrderBlock과 같은 필드 구조를 최대한
// 유지하고, 문서 19절이 요구하는 stopLoss 하나만 추가한다. OB 영역은 항상 Candle2의 몸통만
// 사용하고(문서 14절), referenceHigh/referenceLow도 같은 이유로 Candle2의 꼬리 실측값을 담는다.
function buildDoubleOrderBlock(type, index, candle1, candle2, candle3) {
  const obHigh = getBodyHigh(candle2)
  const obLow = getBodyLow(candle2)
  const previousBodySize = getBodySize(candle2)
  const currentBodySize = getBodySize(candle3)

  return {
    type,
    index,
    time: candle3.timestamp ?? candle3.date ?? null,
    obHigh,
    obLow,
    obMid: (obHigh + obLow) / 2,
    referenceHigh: candle2.high,
    referenceLow: candle2.low,
    previousBodySize,
    currentBodySize,
    // Quality 평가(문서 6절)용 값. Detection 조건으로는 절대 쓰지 않는다.
    bodyRatio: currentBodySize / previousBodySize,
    // 손절/무효화 기준(문서 19절). 여기서만 꼬리(High/Low)를 사용한다.
    stopLoss:
      type === 'bullish-double'
        ? Math.min(candle1.low, candle2.low, candle3.low)
        : Math.max(candle1.high, candle2.high, candle3.high),
  }
}

// 연속된 3개 캔들에서 engulfing이 두 번 연속 발생하는 이중장악형(문서 14~17절)을 탐지한다.
// engulfing 판정은 일반 OB와 동일하게 몸통(open/close)만 사용하고, wick은 stopLoss 계산에만
// 쓴다(문서 17절 "High/Low는 engulfing 판정에 사용하지 않음").
function detectDoubleEngulfingOrderBlocks(candles) {
  const doubleOrderBlocks = []

  for (let index = 2; index < candles.length; index += 1) {
    const candle1 = candles[index - 2]
    const candle2 = candles[index - 1]
    const candle3 = candles[index]

    const leg1Engulfs = engulfsBody(candle1, candle2)
    const leg2Engulfs = engulfsBody(candle2, candle3)

    // 상승형: 음봉 -> 양봉 -> 음봉 (문서 15절)
    if (
      isBearishCandle(candle1) &&
      isBullishCandle(candle2) &&
      isBearishCandle(candle3) &&
      leg1Engulfs &&
      leg2Engulfs
    ) {
      doubleOrderBlocks.push(buildDoubleOrderBlock('bullish-double', index, candle1, candle2, candle3))
      continue
    }

    // 하락형: 양봉 -> 음봉 -> 양봉 (문서 16절)
    if (
      isBullishCandle(candle1) &&
      isBearishCandle(candle2) &&
      isBullishCandle(candle3) &&
      leg1Engulfs &&
      leg2Engulfs
    ) {
      doubleOrderBlocks.push(buildDoubleOrderBlock('bearish-double', index, candle1, candle2, candle3))
    }
  }

  return doubleOrderBlocks
}

// candles: [{ open, high, low, close, timestamp?, date? }, ...] (오래된 -> 최신 순, 어떤
// timeframe이든 동일하게 적용 - docs/trading-rules/order-block.md의 Timeframe Rule 참고)
// 반환: [{ type, index, time, obHigh, obLow, obMid, referenceHigh, referenceLow,
//          previousBodySize, currentBodySize, bodyRatio, stopLoss? }, ...] (오래된 -> 최신 순).
// type은 'bullish' | 'bearish' | 'bullish-double' | 'bearish-double'. stopLoss는 이중장악형에만 있다.
export function detectOrderBlocks(candles) {
  if (!Array.isArray(candles) || candles.length < 2) return []

  const generalOrderBlocks = []

  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1]
    const current = candles[index]

    if (isBearishCandle(previous) && isBullishCandle(current) && engulfsBody(previous, current)) {
      generalOrderBlocks.push(buildOrderBlock('bullish', index, current, previous))
      continue
    }

    if (isBullishCandle(previous) && isBearishCandle(current) && engulfsBody(previous, current)) {
      generalOrderBlocks.push(buildOrderBlock('bearish', index, current, previous))
    }
  }

  const doubleOrderBlocks = detectDoubleEngulfingOrderBlocks(candles)

  // 문서 18절: 일반 OB와 이중장악형 OB가 같은 영역(Candle2 몸통)에서 동시에 성립하면
  // 이중장악형을 우선하고 중복 표시하지 않는다. 이중장악형의 leg2(Candle2->Candle3)는
  // 정의상 같은 인덱스의 일반 OB(previous=Candle2, current=Candle3)와 항상 같은 영역을
  // 만들어내므로, 그 인덱스의 일반 OB만 제거하면 된다.
  const doubleIndices = new Set(doubleOrderBlocks.map((ob) => ob.index))
  const filteredGeneralOrderBlocks = generalOrderBlocks.filter((ob) => !doubleIndices.has(ob.index))

  return [...filteredGeneralOrderBlocks, ...doubleOrderBlocks].sort((a, b) => a.index - b.index)
}
