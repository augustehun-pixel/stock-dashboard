// 역할: docs/trading-rules/order-block.md 기준 Order Block "생명주기"(유지/무효화/교체) 계산.
// detectOrderBlocks(server/orderBlock.js)가 찾아낸 Order Block 목록과, 그 계산에 쓰인
// 캔들 배열을 입력으로 받아 각 OB가 시간이 지남에 따라 active -> invalidated 또는
// active -> replaced 로 어떻게 바뀌는지만 계산한다. Detection 로직(engulfing 판정 등)은
// 이 파일에 절대 새로 만들지 않고, orderBlock.js가 이미 계산해 둔 값(referenceHigh/
// referenceLow/stopLoss)만 그대로 사용한다.
//
// 일반 OB와 이중장악형 OB가 같은 영역에서 중복되는 문제(문서 18절)는 detectOrderBlocks가
// 이미 해결해서 넘겨준다 - 이 파일은 입력으로 받은 orderBlocks를 그대로 신뢰하고, 여기서
// 다시 중복 제거를 하지 않는다.

function getCandleTime(candle) {
  return candle.timestamp ?? candle.date ?? null
}

// 무효화 판정 기준값. 일반 OB는 기준 캔들(previous)의 꼬리(문서 9·10절), 이중장악형은
// 이미 계산된 stopLoss(문서 19절)를 그대로 쓴다. 새 기준을 만들지 않는다.
function getInvalidationThreshold(orderBlock) {
  if (orderBlock.type === 'bullish-double' || orderBlock.type === 'bearish-double') {
    return orderBlock.stopLoss
  }
  return orderBlock.type === 'bullish' ? orderBlock.referenceLow : orderBlock.referenceHigh
}

// Bullish(-double) 계열은 기준 저가를 하향 이탈(candle.low가 기준보다 낮음)하면 무효,
// Bearish(-double) 계열은 기준 고가를 상향 돌파(candle.high가 기준보다 높음)하면 무효.
function isInvalidatedByCandle(orderBlock, candle) {
  const threshold = getInvalidationThreshold(orderBlock)
  const isBullishFamily = orderBlock.type === 'bullish' || orderBlock.type === 'bullish-double'
  return isBullishFamily ? candle.low < threshold : candle.high > threshold
}

// orderBlocks: detectOrderBlocks()의 반환값 (index 오름차순, 한 index당 최대 1개 - 문서 18절
// 우선순위가 이미 적용된 상태이므로 여기서 다시 중복을 걸러내지 않는다)
// candles: detectOrderBlocks() 계산에 쓰인 것과 동일한 캔들 배열(오래된 -> 최신 순)
// 반환: orderBlocks와 같은 개수/순서로, 각 원소에 status/startTime/endTime/replacedBy가
// 추가된 새 배열 (원본 orderBlocks 객체는 변경하지 않는다).
export function resolveOrderBlockLifecycle(orderBlocks, candles) {
  if (!Array.isArray(orderBlocks) || orderBlocks.length === 0) return []

  const creationByIndex = new Map(orderBlocks.map((ob) => [ob.index, ob]))
  const stateByIndex = new Map(
    orderBlocks.map((ob) => [
      ob.index,
      { ...ob, status: 'active', startTime: ob.time, endTime: null, replacedBy: null },
    ]),
  )

  let activeIndex = null

  // 과거 -> 현재 순서로 캔들을 한 번만 훑는다. 각 시점에서는 그 시점까지의 정보만 사용하고
  // (look-ahead 없음), 아직 오지 않은 캔들의 값은 전혀 참조하지 않는다.
  for (let i = 0; i < candles.length; i += 1) {
    const candle = candles[i]

    // 1) 현재 active OB가 이번 캔들의 꼬리로 무효화되는지 먼저 확인한다. OB를 확정지은
    //    캔들 자신(activeIndex)은 검사하지 않고, 그 다음 캔들부터 검사한다 - "생성된 순간
    //    active 상태가 된다"(규칙 1)는 원칙에 따라 확정 캔들 자체는 스스로를 무효화하지 않는다.
    if (activeIndex !== null && i > activeIndex) {
      const active = stateByIndex.get(activeIndex)
      if (active.status === 'active' && isInvalidatedByCandle(active, candle)) {
        active.status = 'invalidated'
        active.endTime = getCandleTime(candle)
        activeIndex = null
      }
    }

    // 2) 이번 캔들 위치에서 새로 생성된 OB가 있으면, 기존 active OB를 교체한다(문서 12절).
    //    방향이 같든 다르든 무조건 교체한다. 바로 위 1)에서 이미 무효화 처리됐다면(같은
    //    캔들에서 무효화와 신규 생성이 동시에 발생한 경우) 무효화 상태를 그대로 두고
    //    덮어쓰지 않는다 - 가격이 실제로 침범한 사실이 교체보다 먼저 일어난 것으로 본다.
    const created = creationByIndex.get(i)
    if (created) {
      if (activeIndex !== null) {
        const previousActive = stateByIndex.get(activeIndex)
        if (previousActive.status === 'active') {
          previousActive.status = 'replaced'
          previousActive.endTime = created.time
          previousActive.replacedBy = created.index
        }
      }
      activeIndex = created.index
    }
  }

  return orderBlocks.map((ob) => stateByIndex.get(ob.index))
}
