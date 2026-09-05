// server/breakoutFeed.js(종목 코드 -> Toss 캔들 조회 -> 미완성 캔들 제외 -> breakout.js 필드
// 변환 -> HTTP 응답 조립) 회귀 테스트. getChartCandles(chartCandles.js, 실제 Toss 호출)만
// mock하고, breakout.js의 detectBreakoutState는 실제 구현을 그대로 사용해서 "필드가 실제로
// 올바르게 전달되는지"까지 함께 검증한다. index.js는 여기서 import하지 않는다(server.listen
// 부작용 회피). 시간에 따라 결과가 흔들리지 않도록 모든 테스트가 now를 직접 주입한다.
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./chartCandles.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, getChartCandles: vi.fn() }
})

import { getChartCandles } from './chartCandles.js'
import {
  getBreakoutResponse,
  filterUnclosedTrailingCandle,
  isCandleSafelyClosed,
} from './breakoutFeed.js'

beforeEach(() => {
  getChartCandles.mockReset()
})

// 아래 fixture들이 쓰는 날짜는 전부 실제 "오늘"(2026-09-05, 시스템 기준)보다 명백히 과거라서,
// getBreakoutResponse의 기본 now(new Date())로도 항상 "마감된 캔들"로 통과한다.
describe('getBreakoutResponse - 정상 요청', () => {
  it('유효한 H1-H2 구조가 있는 캔들이면 200과 breakout 상태를 반환한다', async () => {
    getChartCandles.mockResolvedValue([
      { date: '2025-01-06', timestamp: '2025-01-06T00:00:00.000+09:00', open: 95, high: 100, low: 94, close: 99, volume: 1000 },
      { date: '2025-01-07', timestamp: '2025-01-07T00:00:00.000+09:00', open: 98, high: 90, low: 85, close: 94, volume: 800 },
      { date: '2025-01-08', timestamp: '2025-01-08T00:00:00.000+09:00', open: 104, high: 108, low: 92, close: 107, volume: 1500 },
    ])

    const result = await getBreakoutResponse('005930', '1d')

    expect(result.statusCode).toBe(200)
    expect(result.body.status).toBe('WAITING_FOR_BREAKOUT')
    expect(result.body.h1).toMatchObject({ price: 100, volume: 1000 })
    expect(result.body.h2).toMatchObject({ price: 108, volume: 1500 })
    expect(getChartCandles).toHaveBeenCalledWith('005930', '1d')
  })
})

describe('getBreakoutResponse - 잘못된 interval', () => {
  it('지원하지 않는 interval이면 400을 반환하고 Toss를 호출하지 않는다', async () => {
    const result = await getBreakoutResponse('005930', '3분봉')

    expect(result.statusCode).toBe(400)
    expect(result.body.error).toMatch(/지원하지 않는 시간봉/)
    expect(getChartCandles).not.toHaveBeenCalled()
  })
})

describe('getBreakoutResponse - 캔들 데이터 부족', () => {
  it('캔들이 없으면 200과 NO_STRUCTURE를 반환한다(에러 아님)', async () => {
    getChartCandles.mockResolvedValue([])

    const result = await getBreakoutResponse('005930', '1d')

    expect(result.statusCode).toBe(200)
    expect(result.body.status).toBe('NO_STRUCTURE')
    expect(result.body.h1).toBeNull()
  })

  it('캔들이 1개뿐이라 H1 확정에 필요한 다음 봉이 없으면 NO_STRUCTURE를 반환한다', async () => {
    getChartCandles.mockResolvedValue([
      { date: '2025-01-06', timestamp: '2025-01-06T00:00:00.000+09:00', open: 95, high: 100, low: 94, close: 99, volume: 1000 },
    ])

    const result = await getBreakoutResponse('005930', '1d')

    expect(result.statusCode).toBe(200)
    expect(result.body.status).toBe('NO_STRUCTURE')
  })
})

describe('getBreakoutResponse - Toss upstream 오류', () => {
  it('getChartCandles가 실패하면 502를 반환하고 원본 오류 메시지를 그대로 노출하지 않는다', async () => {
    getChartCandles.mockRejectedValue(new Error('일봉 조회 실패 (HTTP 500)'))

    const result = await getBreakoutResponse('005930', '1d')

    expect(result.statusCode).toBe(502)
    expect(result.body.error).toBe('Breakout 탐지에 실패했습니다.')
    expect(result.body.error).not.toMatch(/500/)
  })
})

describe('getBreakoutResponse - breakout.js까지 필드가 정확히 전달되는지', () => {
  it('중간 고점이 거래량 부족으로 거절되는 실제 흐름이 API 응답에도 그대로 반영된다', async () => {
    getChartCandles.mockResolvedValue([
      { date: '2025-01-06', timestamp: '2025-01-06T00:00:00.000+09:00', open: 95, high: 100, low: 94, close: 99, volume: 1000 },
      { date: '2025-01-07', timestamp: '2025-01-07T00:00:00.000+09:00', open: 98, high: 97, low: 93, close: 94, volume: 800 },
      { date: '2025-01-08', timestamp: '2025-01-08T00:00:00.000+09:00', open: 95, high: 103, low: 92, close: 102, volume: 700 }, // 중간 고점(거절)
      { date: '2025-01-09', timestamp: '2025-01-09T00:00:00.000+09:00', open: 100, high: 101, low: 90, close: 98, volume: 750 }, // 중간 고점(거절)
      { date: '2025-01-10', timestamp: '2025-01-10T00:00:00.000+09:00', open: 104, high: 108, low: 99, close: 107, volume: 1500 }, // final H2
    ])

    const result = await getBreakoutResponse('005930', '1d')

    expect(result.statusCode).toBe(200)
    expect(result.body.h1).toMatchObject({ price: 100 })
    expect(result.body.h2).toMatchObject({ price: 108, volume: 1500 })
    expect(result.body.l).toBe(90)
  })

  it('volume이 null인 캔들이 섞여 들어와도(실제 Toss 응답 특성) 거짓 ENTRY를 만들지 않는다', async () => {
    getChartCandles.mockResolvedValue([
      { date: '2025-01-06', timestamp: '2025-01-06T00:00:00.000+09:00', open: 95, high: 100, low: 94, close: 99, volume: null },
      { date: '2025-01-07', timestamp: '2025-01-07T00:00:00.000+09:00', open: 92, high: 90, low: 85, close: 88, volume: 800 },
      { date: '2025-01-08', timestamp: '2025-01-08T00:00:00.000+09:00', open: 104, high: 108, low: 92, close: 107, volume: 1500 },
      { date: '2025-01-09', timestamp: '2025-01-09T00:00:00.000+09:00', open: 113, high: 120, low: 110, close: 118, volume: 2000 },
    ])

    const result = await getBreakoutResponse('005930', '1d')

    expect(result.statusCode).toBe(200)
    expect(result.body.status).toBe('NO_STRUCTURE')
    expect(result.body.entryIndex).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 미완성(진행 중) 캔들 필터링 - now를 직접 주입해서 시간에 흔들리지 않게 검증한다.
// "오늘"은 실제 시스템 날짜인 2026-09-05(KST)로 고정해서 사용한다.
// ---------------------------------------------------------------------------
describe('filterUnclosedTrailingCandle / isCandleSafelyClosed - 일봉', () => {
  it('A: 장중(진행 중인 오늘 일봉)이면 마지막 캔들을 제외한다', () => {
    const candles = [
      { date: '2025-01-06', timestamp: '2025-01-06T00:00:00.000+09:00', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { date: '2026-09-05', timestamp: '2026-09-05T00:00:00.000+09:00', open: 3, high: 4, low: 2.5, close: 3.5, volume: 20 }, // 오늘, 진행 중
    ]
    const now = new Date('2026-09-05T02:00:00.000Z') // KST 11:00 - 장중

    const result = filterUnclosedTrailingCandle(candles, '1d', now)

    expect(result).toHaveLength(1)
    expect(result[0].date).toBe('2025-01-06')
  })

  it('B: 정규장 종료 + grace period 이후면 오늘 일봉도 포함한다', () => {
    const candles = [
      { date: '2025-01-06', timestamp: '2025-01-06T00:00:00.000+09:00', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { date: '2026-09-05', timestamp: '2026-09-05T00:00:00.000+09:00', open: 3, high: 4, low: 2.5, close: 3.5, volume: 20 },
    ]
    const now = new Date('2026-09-05T06:34:00.000Z') // KST 15:34 (마감 동시호가 15:31 + grace 2분 이후)

    const result = filterUnclosedTrailingCandle(candles, '1d', now)

    expect(result).toHaveLength(2)
  })
})

describe('filterUnclosedTrailingCandle / isCandleSafelyClosed - 분봉/시간봉', () => {
  it('C: 현재 진행 중인 1시간봉 bucket이면 마지막 캔들을 제외한다', () => {
    const candles = [
      { date: '2026-09-05', timestamp: '2026-09-05T09:00:00.000+09:00', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
      { date: '2026-09-05', timestamp: '2026-09-05T10:00:00.000+09:00', open: 3, high: 4, low: 2.5, close: 3.5, volume: 20 }, // 10:00~11:00, 진행 중
    ]
    const now = new Date('2026-09-05T01:30:00.000Z') // KST 10:30 - 아직 bucket 안

    const result = filterUnclosedTrailingCandle(candles, '1h', now)

    expect(result).toHaveLength(1)
  })

  it('D: 이미 종료된 이전 bucket은 그대로 포함되고, 진행 중인 마지막 bucket만 제외된다', () => {
    const candles = [
      { date: '2026-09-05', timestamp: '2026-09-05T09:00:00.000+09:00', open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }, // 09:00~10:00, 이미 종료
      { date: '2026-09-05', timestamp: '2026-09-05T10:00:00.000+09:00', open: 3, high: 4, low: 2.5, close: 3.5, volume: 20 }, // 10:00~11:00, 진행 중
    ]
    const now = new Date('2026-09-05T01:30:00.000Z') // KST 10:30

    const result = filterUnclosedTrailingCandle(candles, '1h', now)

    expect(result).toHaveLength(1)
    expect(result[0].timestamp).toBe('2026-09-05T09:00:00.000+09:00') // 이전 bucket은 그대로
  })

  it('E: bucket 종료 직후 grace period 안이면 아직 제외한다', () => {
    const candles = [
      { date: '2026-09-05', timestamp: '2026-09-05T10:00:00.000+09:00', open: 3, high: 4, low: 2.5, close: 3.5, volume: 20 }, // 10:00~11:00
    ]
    const now = new Date('2026-09-05T02:01:00.000Z') // KST 11:01 - 자연 종료(11:00) 1분 후, grace(2분) 안

    const result = filterUnclosedTrailingCandle(candles, '1h', now)

    expect(result).toHaveLength(0)
  })

  it('F: grace period가 지난 뒤면 포함한다', () => {
    const candles = [
      { date: '2026-09-05', timestamp: '2026-09-05T10:00:00.000+09:00', open: 3, high: 4, low: 2.5, close: 3.5, volume: 20 },
    ]
    const now = new Date('2026-09-05T02:02:00.000Z') // KST 11:02 - 자연 종료(11:00) + grace(2분) 정확히 지남

    const result = filterUnclosedTrailingCandle(candles, '1h', now)

    expect(result).toHaveLength(1)
  })
})

describe('getBreakoutResponse - 미완성 캔들로 인한 거짓 신호 방지', () => {
  it('G: 미완성 마지막 캔들이 ENTRY 조건을 잠깐 만족해도 ENTRY_VALID를 발생시키지 않는다', async () => {
    getChartCandles.mockResolvedValue([
      { date: '2025-01-06', timestamp: '2025-01-06T00:00:00.000+09:00', open: 95, high: 100, low: 94, close: 99, volume: 1000 }, // H1
      { date: '2025-01-07', timestamp: '2025-01-07T00:00:00.000+09:00', open: 92, high: 90, low: 85, close: 88, volume: 700 },
      { date: '2025-01-08', timestamp: '2025-01-08T00:00:00.000+09:00', open: 104, high: 108, low: 92, close: 107, volume: 1500 }, // H2 확정
      // 오늘(진행 중) 캔들: 몸통/거래량만 보면 ENTRY 조건을 만족하지만 아직 마감 전이다.
      { date: '2026-09-05', timestamp: '2026-09-05T00:00:00.000+09:00', open: 113, high: 120, low: 110, close: 118, volume: 2000 },
    ])
    const now = new Date('2026-09-05T02:00:00.000Z') // KST 11:00 - 오늘 일봉 아직 진행 중

    const result = await getBreakoutResponse('005930', '1d', { now })

    expect(result.body.status).toBe('WAITING_FOR_BREAKOUT')
    expect(result.body.entryIndex).toBeNull()
  })

  it('H: 미완성 마지막 캔들이 STOP LOSS 조건을 잠깐 만족해도 STOP_LOSS를 발생시키지 않는다', async () => {
    getChartCandles.mockResolvedValue([
      { date: '2025-01-06', timestamp: '2025-01-06T00:00:00.000+09:00', open: 95, high: 100, low: 94, close: 99, volume: 1000 }, // H1
      { date: '2025-01-07', timestamp: '2025-01-07T00:00:00.000+09:00', open: 92, high: 90, low: 85, close: 88, volume: 700 },
      { date: '2025-01-08', timestamp: '2025-01-08T00:00:00.000+09:00', open: 104, high: 108, low: 92, close: 107, volume: 1500 }, // H2 확정
      { date: '2025-01-09', timestamp: '2025-01-09T00:00:00.000+09:00', open: 113, high: 120, low: 110, close: 118, volume: 2000 }, // ENTRY_VALID(이미 마감된 과거 캔들)
      // 오늘(진행 중) 캔들: 몸통만 보면 STOP LOSS 조건을 만족하지만 아직 마감 전이다.
      { date: '2026-09-05', timestamp: '2026-09-05T00:00:00.000+09:00', open: 114, high: 117, low: 108, close: 115, volume: 1200 },
    ])
    const now = new Date('2026-09-05T02:00:00.000Z') // KST 11:00 - 오늘 일봉 아직 진행 중

    const result = await getBreakoutResponse('005930', '1d', { now })

    expect(result.body.status).toBe('ENTRY_VALID')
    expect(result.body.stopLossIndex).toBeNull()
  })
})

describe('isCandleSafelyClosed - 경계값', () => {
  it('과거 날짜는 시각과 무관하게 항상 안전하다', () => {
    const candle = { date: '2020-01-01', timestamp: '2020-01-01T00:00:00.000+09:00' }
    expect(isCandleSafelyClosed(candle, '1d', new Date('2026-09-05T00:00:00.000Z'))).toBe(true)
  })
})
