// 역할: 종목 코드 -> Toss 캔들 조회(getChartCandles, chartCandles.js와 완전히 동일한 파이프라인을
// 그대로 재사용 - 새 fetch/변환 로직을 만들지 않는다) -> "완전히 마감된 캔들만" 걸러서
// breakout.js가 기대하는 캔들 필드로 변환 -> detectBreakoutState 호출 -> HTTP 응답
// (statusCode/body) 조립까지 담당한다.
//
// server/index.js가 이 함수의 결과를 그대로 res.writeHead/res.end에 넘기기만 하면 되도록
// 응답 형태까지 여기서 만든다 - index.js를 실제로 import하지 않고도(=서버를 listen하지 않고도)
// vitest로 이 파이프라인 전체(잘못된 interval/캔들 부족/Toss 오류/필드 전달/미완성 캔들 제외)를
// 검증하기 위함이다.
//
// breakout.js의 매매 판정 로직(H1/H2/L/추세선/돌파/진입/손절/100캔들/거래량 조건)은 이 파일에서
// 절대 다시 구현하지 않고 detectBreakoutState를 그대로 호출만 한다. 이 파일이 담당하는 것은
// 오직 "아직 안전하게 마감됐다고 보기 어려운 마지막 캔들을 breakout.js에 넣지 않는다"뿐이다.
//
// 미완성(진행 중) 캔들 판정: Toss API 응답 자체에는 "이 캔들이 닫혔는지"를 알려주는 필드가
// 없음을 실제 API 호출로 확인했다(2026-09-05 조사). 대신 이 프로젝트에 이미 있는 정규장 시간
// 상수/구조를 그대로 재사용한다 - 새 시장시간 규칙을 여기서 만들지 않는다:
//   - SESSION_START_MINUTE / SESSION_END_MINUTE (intradayCandles.js, 09:00~15:30 정규장)
//   - SESSIONS의 AM/PM 경계 (fourHourCandles.js, 09:00~12:59 / 13:00~15:30)
//   - CLOSING_AUCTION_MINUTE(15:31) (chartCandles.js, 정규장 마감 동시호가가 "15:31" 라벨
//     1분봉으로 찍힌다는 실측 확인 - 정규장 마감에 걸치는 period는 이 값을 마감 기준으로 쓴다)
// 판정 방법: 캔들의 날짜가 오늘(KST)보다 과거면 무조건 마감. 오늘이면 그 period의 마감
// 기준 시각(위 상수들로 계산) + 아래 grace period를 서버 현재 시각(KST)이 지났는지로 판단한다.
//
// grace period(DATA_CONFIRMATION_GRACE_MINUTES)는 매매 조건이 아니라, "period가 막 끝난
// 캔들을 Toss 데이터 반영 지연 가능성 없이 안전하게 확정 캔들로 쓰기 위한" 순수 데이터 안전
// 장치다. chartCandles.js가 이미 발견한 마감 동시호가 지연(15:31)과는 별개로, 그 외 모든
// period 경계에도 동일하게 적용하는 일반적인 여유분이다.

import { getChartCandles, isSupportedChartTimeframe, CLOSING_AUCTION_MINUTE } from './chartCandles.js'
import { SESSION_END_MINUTE } from './intradayCandles.js'
import { SESSIONS } from './fourHourCandles.js'
import { detectBreakoutState } from './breakout.js'

const DATA_CONFIRMATION_GRACE_MINUTES = 2 // 매매 조건 아님 - 데이터 확정 안전 지연(순수 안전장치)

// getChartCandles가 '30m'/'1h' 버킷을 만들 때 실제로 쓰는 값과 동일(chartCandles.js 호출부
// 참고). 새 숫자를 만든 게 아니라 interval 문자열 자체가 뜻하는 분 단위를 그대로 옮긴 것.
const BUCKET_MINUTES_BY_TIMEFRAME = { '30m': 30, '1h': 60 }

const PM_SESSION_START_MINUTE = SESSIONS.find((session) => session.label === 'PM').startMinute

function parseMinuteOfDay(timestamp) {
  return Number(timestamp.slice(11, 13)) * 60 + Number(timestamp.slice(14, 16))
}

// KST(+09:00 고정 - 한국은 DST 없음) 기준 "지금"의 날짜/분을, 서버 실행 환경의 로컬 시간대에
// 의존하지 않고 안전하게 구한다(fourHourCandles.js가 이미 "new Date().getHours() 금지"라고
// 남긴 것과 같은 이유 - 여기서도 문자열/절대시각 기반으로만 계산한다).
// now는 절대시각(Date 또는 ms)이며, 테스트에서 주입/mock할 수 있다.
function resolveKstNow(now) {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000
  const shifted = new Date(now.getTime() + KST_OFFSET_MS)
  return {
    date: shifted.toISOString().slice(0, 10),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  }
}

// 그 period의 "자연스러운" 종료 시각(분) - 마감 동시호가 지연을 반영하기 전 값.
function naturalEndMinute(timeframe, candle) {
  if (timeframe === '1d' || timeframe === '1w') return SESSION_END_MINUTE

  if (timeframe === '4h') {
    const startMinute = parseMinuteOfDay(candle.timestamp)
    return startMinute < PM_SESSION_START_MINUTE ? PM_SESSION_START_MINUTE : SESSION_END_MINUTE
  }

  // '30m' | '1h': timestamp는 버킷 "시작" 시각(intradayCandles.js 기존 규칙).
  const bucketStart = parseMinuteOfDay(candle.timestamp)
  return bucketStart + BUCKET_MINUTES_BY_TIMEFRAME[timeframe]
}

// 정규장 마감에 걸치는(또는 그 이후로 넘어가는) period는, 마감 동시호가 라벨 지연을 그대로
// 반영한다(새 기준이 아니라 chartCandles.js의 기존 실측값 재사용).
function effectiveEndMinute(timeframe, candle) {
  const natural = naturalEndMinute(timeframe, candle)
  return natural >= SESSION_END_MINUTE ? CLOSING_AUCTION_MINUTE : natural
}

// candle이 자신의 period를 완전히 지나 breakout.js에 넘겨도 안전한지 판단한다.
// 과거 날짜(KST 기준)면 무조건 안전. 오늘 날짜면 (종료 시각 + grace period)를 지났는지로
// 판단한다. 미래 날짜(정상적으로는 발생하지 않음)는 안전하지 않은 것으로 취급한다.
export function isCandleSafelyClosed(candle, timeframe, now = new Date()) {
  const kstNow = resolveKstNow(now instanceof Date ? now : new Date(now))

  if (candle.date < kstNow.date) return true
  if (candle.date > kstNow.date) return false

  const boundary = effectiveEndMinute(timeframe, candle) + DATA_CONFIRMATION_GRACE_MINUTES
  return kstNow.minuteOfDay >= boundary
}

// candles의 마지막 캔들만 검사해서, 아직 안전하게 마감됐다고 보기 어려우면 배열에서 제외한다.
// 이미 종료된 이전 캔들들은 손대지 않는다. breakout.js(매매 판정)는 이 함수에서 절대 호출하지
// 않는다 - 오직 "무엇을 넘길지"만 결정한다.
export function filterUnclosedTrailingCandle(candles, timeframe, now = new Date()) {
  if (!Array.isArray(candles) || candles.length === 0) return candles

  const last = candles[candles.length - 1]
  return isCandleSafelyClosed(last, timeframe, now) ? candles : candles.slice(0, -1)
}

export async function getBreakoutResponse(code, interval, { now = new Date() } = {}) {
  if (!isSupportedChartTimeframe(interval)) {
    return { statusCode: 400, body: { error: `지원하지 않는 시간봉입니다: ${interval}` } }
  }

  try {
    const candles = await getChartCandles(code, interval)
    const safeCandles = filterUnclosedTrailingCandle(candles, interval, now)
    const breakoutInput = safeCandles.map((candle) => ({
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
      volume: candle.volume,
      timestamp: candle.timestamp,
    }))
    const breakout = detectBreakoutState(breakoutInput)
    return { statusCode: 200, body: breakout }
  } catch (error) {
    console.error('Breakout 탐지 실패:', error.message)
    return { statusCode: 502, body: { error: 'Breakout 탐지에 실패했습니다.' } }
  }
}
