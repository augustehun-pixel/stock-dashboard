import { useCallback, useEffect, useRef, useState } from 'react'
import CandleChart from './CandleChart'
import { MA_COLORS } from './chartColors'
import './App.css'

const defaultStockCodes = ['005930', '000660', '035420']
const WATCHLIST_STORAGE_KEY = 'stock-dashboard:watchlist'
// 이 시간(ms) 이상 카드를 누르고 있으면 "탭"이 아니라 "드래그 시작"으로 본다.
const LONG_PRESS_MS = 400
// 길게 누르기가 확정되기 전에 손가락이 이만큼(px) 넘게 움직이면 스크롤/짧은 탭으로 보고 드래그를 취소한다.
const DRAG_MOVE_CANCEL_PX = 10

// 상단 "가격 추이" 미니 차트는 기간 선택 없이 항상 최근 1개월만 보여준다(compact 유지 목적).
const PRICE_TREND_PERIOD = '1M'

// 캔들 차트의 시간봉 선택지. 순서 고정. value는 서버 API(/api/stock/:code/candles?interval=...)로
// 그대로 전달된다. 토스증권 캔들 API는 실제로 1분봉/일봉만 지원해서(2026-09-01 확인,
// 400 응답의 allowedValues: ["1m","1d"]), 6시간/12시간은 정규장(09:00~15:30, 6.5시간)
// 안에서 의미 있게 나눌 수 있는 데이터가 없다 - 가짜 데이터를 만드는 대신 버튼은 두되
// 비활성화한다(supported: false).
const CHART_TIMEFRAMES = [
  { value: '30m', label: '30분', supported: true },
  { value: '1h', label: '1시간', supported: true },
  { value: '4h', label: '4시간', supported: true },
  { value: '6h', label: '6시간', supported: false },
  { value: '12h', label: '12시간', supported: false },
  { value: '1d', label: '1일', supported: true },
  { value: '1w', label: '1주', supported: true },
]
const DEFAULT_CHART_TIMEFRAME = '1d'
const MA_PERIODS = [5, 20, 60, 120]

// 상단 필터 바의 UI 골격만 미리 만들어둔다. "전체"만 선택 가능하고 나머지는 비활성 상태로만
// 보여준다 - 실제 정렬/필터 로직과 오더블럭/FVG/채널/추세선 같은 향후 분석 필터는 여기 배열에
// 항목만 추가하면 되도록 자리를 남겨두는 목적이라, 지금은 클릭해도 아무 것도 하지 않는다.
const WATCHLIST_FILTERS = [
  { value: 'all', label: '전체' },
  { value: 'price', label: '현재가' },
  { value: 'changeRate', label: '등락률' },
  { value: 'goldenCross', label: '골든크로스' },
  { value: 'fibonacci', label: '피보나치' },
  { value: 'structure', label: '구조 상태' },
]

// localStorage에는 종목코드 목록만 저장한다. 가격/등락률 같은 시세 데이터나
// 비밀값은 절대 저장하지 않고, 새로고침 시 항상 서버에서 다시 받아온다.
function loadWatchlistCodes() {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY)
    if (!raw) return defaultStockCodes
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((code) => typeof code === 'string')) {
      return parsed
    }
    return defaultStockCodes
  } catch {
    return defaultStockCodes
  }
}

function saveWatchlistCodes(codes) {
  try {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(codes))
  } catch {
    // localStorage를 쓸 수 없어도(예: 브라우저 설정으로 차단) 앱은 계속 동작해야 하므로 무시한다.
  }
}

function formatChangeRate(rate) {
  if (rate === null || rate === undefined) return null
  const sign = rate > 0 ? '+' : ''
  return `${sign}${rate.toFixed(2)}%`
}

// 카드와 상세보기 모두에서 등락률에 따른 색상/화살표를 같은 방식으로 계산한다.
function getChangeDisplay(changeRate) {
  const rate = changeRate === null || changeRate === undefined ? null : parseFloat(changeRate)
  let changeClass = 'neutral'
  let arrow = '→'
  if (rate > 0) {
    changeClass = 'positive'
    arrow = '↑'
  } else if (rate < 0) {
    changeClass = 'negative'
    arrow = '↓'
  }
  return { rate, changeClass, arrow }
}

// 차트에 이미 받아온 종가 배열의 첫 값과 마지막 값만으로 선택 기간 수익률을 계산한다.
// 별도 API 호출은 하지 않는다. 데이터가 부족하거나 첫 종가가 0이라 나눗셈이 불가능한 경우,
// 혹은 계산 결과가 NaN/Infinity가 되는 경우에는 화면에 절대 보여주지 않도록 null을 반환한다.
function calculatePeriodReturn(closes) {
  if (!Array.isArray(closes) || closes.length < 2) return null

  const first = Number(closes[0])
  const last = Number(closes[closes.length - 1])
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return null

  const rate = ((last - first) / first) * 100
  return Number.isFinite(rate) ? rate : null
}

function formatPriceValue(value) {
  if (value === null || value === undefined) return '정보 없음'
  return `${Number(value).toLocaleString()}원`
}

function formatTimestamp(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('ko-KR')
}

async function fetchStockData(code) {
  const response = await fetch(`/api/stock/${code}`)
  if (!response.ok) {
    throw new Error('종목 정보를 가져오지 못했습니다')
  }
  const data = await response.json()
  return {
    id: data.code,
    name: data.name,
    // 로고 자리에 쓸 이니셜(getStockInitials)만을 위해 서버가 이미 내려주는 영문명을 추가로
    // 담아둔다. 별도 API 호출은 없다 - 같은 /api/stock/:code 응답에 이미 있던 값이다.
    englishName: data.englishName ?? null,
    code: data.code,
    market: data.market ?? null,
    price: `${Number(data.price).toLocaleString()}원`,
    // 관심종목 목록의 당일 미니차트(시가→현재가 2점)에 쓸 원시 숫자값. 위 price는 이미
    // "1,234원" 형식 문자열이라 계산에 쓸 수 없어 별도로 둔다. 새 계산 로직이 아니라
    // 이미 구하고 있던 숫자(Number(data.price))를 그대로 한 번 더 노출하는 것뿐이다.
    rawPrice: Number(data.price),
    changeRate: formatChangeRate(data.changeRate),
    openPrice: data.openPrice,
    highPrice: data.highPrice,
    lowPrice: data.lowPrice,
    volume: data.volume,
    timestamp: data.timestamp,
    status: 'success',
  }
}

// 로고 이미지가 없을 때 쓸 원형 이니셜 placeholder. "SK하이닉스"처럼 이름 앞에 이미 영문
// 브랜드 접두어가 붙어 있으면 그 접두어를 그대로 쓰고("SK"), 아니면 영문명(있으면)이나
// 종목명의 첫 글자 하나만 쓴다("삼성전자"→영문명 SamsungElec의 "S", "NAVER"→"N").
function getStockInitials(name, englishName) {
  if (!name) return '?'
  const latinPrefixMatch = name.match(/^[A-Za-z]+/)
  if (latinPrefixMatch && latinPrefixMatch[0].length < name.length) {
    return latinPrefixMatch[0].toUpperCase()
  }
  const source = englishName || name
  return source.charAt(0).toUpperCase()
}

// 골든크로스/기준저점/확정고점/피보나치 분석 결과를 서버에서 그대로 받아온다.
// 서버(getCrossoverAnalysis)가 이미 계산을 끝낸 값을 그대로 전달할 뿐, 여기서는
// 아무 계산도 하지 않는다.
async function fetchGoldenCrossAnalysis(code) {
  const response = await fetch(`/api/stock/${code}/golden-cross`)
  if (!response.ok) {
    throw new Error('골든크로스 분석 정보를 가져오지 못했습니다')
  }
  return response.json()
}

// fibonacci 데이터(isValid/invalidatedDate/levelStatus)만 문장으로 옮겨 적을 뿐,
// 매수/매도 같은 새로운 판단 기준은 만들지 않는다.
function buildGoldenCrossSummary(fibonacci) {
  if (!fibonacci) return ''

  const validityText = fibonacci.isValid
    ? '일봉 골든크로스 이후 구조가 유효한 상태입니다.'
    : `일봉 골든크로스 이후 구조가 ${fibonacci.invalidatedDate}에 무효화되었습니다.`

  const reached05 = fibonacci.levelStatus['0.5'].reached
  const reached618 = fibonacci.levelStatus['0.618'].reached

  let reachText
  if (reached05 && reached618) {
    reachText = '0.5, 0.618 모두 도달했습니다.'
  } else if (!reached05 && !reached618) {
    reachText = '0.5, 0.618 모두 아직 도달하지 않았습니다.'
  } else if (reached05) {
    reachText = '0.5는 도달했고, 0.618은 아직 도달하지 않았습니다.'
  } else {
    reachText = '0.618은 도달했고, 0.5는 아직 도달하지 않았습니다.'
  }

  return `${validityText} ${reachText}`
}

// X 대신 휴지통 모양 아이콘으로 삭제 버튼임을 바로 알아볼 수 있게 한다. 새 아이콘 라이브러리를
// 추가하지 않고, 이 프로젝트가 이미 쓰는 방식(순수 SVG)을 그대로 따른다.
function TrashIcon() {
  return (
    <svg
      className="trash-icon"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  )
}

// 선택된 기간의 종가로 아주 단순한 선 차트를 그린다. 새 라이브러리 없이 순수 SVG로 그린다.
// viewBox 좌표계(0~100, 0~32)를 쓰고 CSS로 실제 크기를 맞추기 때문에, 모달 폭에 맞게
// 알아서 늘어나거나 줄어들고 가로 스크롤이 생기지 않는다.
function StockChart({ closes, periodLabel }) {
  if (!closes || closes.length < 2) return null

  const width = 100
  const height = 32
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1

  const points = closes
    .map((close, index) => {
      const x = (index / (closes.length - 1)) * width
      const y = height - ((close - min) / range) * height
      return `${x},${y.toFixed(2)}`
    })
    .join(' ')

  const isUp = closes[closes.length - 1] >= closes[0]

  return (
    <svg
      className="stock-chart"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`최근 ${periodLabel} 가격 추이`}
    >
      <polyline
        points={points}
        fill="none"
        vectorEffect="non-scaling-stroke"
        className={`stock-chart-line ${isUp ? 'positive' : 'negative'}`}
      />
    </svg>
  )
}

function App() {
  const [stocks, setStocks] = useState([])
  const [isLoadingInitial, setIsLoadingInitial] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [addQuery, setAddQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState('')
  const [selectedStock, setSelectedStock] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const stocksRef = useRef(stocks)
  useEffect(() => {
    stocksRef.current = stocks
  }, [stocks])

  // isRefreshingRef가 실제 "잠금"이다(버튼을 연달아 눌러도 중복 요청이 나가지 않게 막는다).
  // isRefreshing state는 버튼 표시("갱신 중...")를 화면에 그려주기 위한 용도로만 쓴다.
  const isRefreshingRef = useRef(false)

  // 관심종목 가격을 다시 받아온다. "지금 새로고침" 버튼을 눌렀을 때만 호출된다.
  // 토스 API 429(요청 과다)를 피하기 위해 (1) 이미 갱신 중이면 새 요청을 건너뛰고,
  // (2) 여러 종목을 한번에 몰아서 요청하지 않고 하나씩 순서대로 요청한다.
  const refreshStocks = useCallback(async () => {
    if (isRefreshingRef.current) return

    const codes = stocksRef.current.map((stock) => stock.code)
    if (codes.length === 0) return

    isRefreshingRef.current = true
    setIsRefreshing(true)
    for (const code of codes) {
      try {
        const updated = await fetchStockData(code)
        setStocks((prevStocks) =>
          prevStocks.map((stock) => (stock.code === code ? updated : stock)),
        )
      } catch {
        // 이 종목만 갱신을 건너뛰고 기존 값을 그대로 둔다. 다른 종목 갱신은 계속 진행한다.
      }
    }
    isRefreshingRef.current = false
    setIsRefreshing(false)
  }, [])

  const [chartStatus, setChartStatus] = useState('idle') // idle | loading | success | error
  const [chartCloses, setChartCloses] = useState(null)
  // 같은 종목의 1개월 차트를 다시 열었을 때 또 요청하지 않도록 두는 아주 단순한 캐시
  // (세션 동안만 메모리에 유지, localStorage에는 저장하지 않음). 키 예: "035420".
  const chartCacheRef = useRef(new Map())

  // 종목을 선택해 우측 상세 패널을 채울 때만 "가격 추이" 미니 차트를 받아온다(항상 1개월
  // 고정). 관심종목 목록의 수동 새로고침(refreshStocks)과는 완전히 분리돼 있어서,
  // 아직 아무 종목도 선택하지 않았을 때는 이 요청이 전혀 발생하지 않는다.
  useEffect(() => {
    if (!selectedStock || selectedStock.status === 'error') {
      setChartStatus('idle')
      setChartCloses(null)
      return
    }

    const code = selectedStock.code
    const cached = chartCacheRef.current.get(code)
    if (cached) {
      setChartCloses(cached)
      setChartStatus('success')
      return
    }

    let cancelled = false
    setChartStatus('loading')
    setChartCloses(null)

    fetch(`/api/stock/${code}/chart?period=${PRICE_TREND_PERIOD}`)
      .then((response) => {
        if (!response.ok) throw new Error('차트 조회 실패')
        return response.json()
      })
      .then((data) => {
        if (cancelled) return
        chartCacheRef.current.set(code, data.closes)
        setChartCloses(data.closes)
        setChartStatus('success')
      })
      .catch(() => {
        if (!cancelled) setChartStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [selectedStock])

  const [candleTimeframe, setCandleTimeframe] = useState(DEFAULT_CHART_TIMEFRAME)
  const [candleStatus, setCandleStatus] = useState('idle') // idle | loading | success | error
  const [candleData, setCandleData] = useState(null) // { candles, ma }
  // "종목 + 시간봉" 조합별 캐시(세션 동안만). 키 예: "035420-4h".
  const candleCacheRef = useRef(new Map())

  // 캔들 차트(30분/1시간/4시간/1일/1주)는 가격 추이 미니 차트와 완전히 분리된 별도 요청이다.
  // 골든크로스 분석(아래)과도 분리돼 있다 - 골든크로스는 항상 일봉 기준으로 별도 계산되고,
  // 여기서 시간봉을 바꿔도 골든크로스 요청/판정에는 전혀 영향을 주지 않는다.
  useEffect(() => {
    if (!selectedStock || selectedStock.status === 'error') {
      setCandleStatus('idle')
      setCandleData(null)
      return
    }

    const code = selectedStock.code
    const requestedTimeframe = candleTimeframe
    const cacheKey = `${code}-${requestedTimeframe}`
    const cached = candleCacheRef.current.get(cacheKey)
    if (cached) {
      setCandleData(cached)
      setCandleStatus('success')
      return
    }

    let cancelled = false
    setCandleStatus('loading')
    setCandleData(null)

    fetch(`/api/stock/${code}/candles?interval=${requestedTimeframe}`)
      .then((response) => {
        if (!response.ok) throw new Error('캔들 차트 조회 실패')
        return response.json()
      })
      .then((data) => {
        if (cancelled) return
        // candles/ma와 timeframe을 하나의 객체로 함께 저장해서, CandleChart가 항상
        // "같은 응답에서 나온" 서로 맞는 조합만 받도록 한다(버튼의 candleTimeframe을
        // 바로 넘기면, 새 시간봉을 고른 직후 아직 이전 응답이 화면에 남아있는 순간에
        // "새 timeframe + 이전 candles"처럼 서로 안 맞는 조합이 잠깐 넘어갈 수 있었음 -
        // lightweight-charts가 시간 축 정렬이 깨졌다고 에러를 던지는 원인이었다).
        const withTimeframe = { ...data, timeframe: requestedTimeframe }
        candleCacheRef.current.set(cacheKey, withTimeframe)
        setCandleData(withTimeframe)
        setCandleStatus('success')
      })
      .catch(() => {
        if (!cancelled) setCandleStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [selectedStock, candleTimeframe])

  const [goldenCrossStatus, setGoldenCrossStatus] = useState('idle') // idle | loading | success | error
  const [goldenCrossData, setGoldenCrossData] = useState(null)

  // 우측 패널에 선택된 종목의 golden-cross 분석 결과를 받아온다. 종목을 바꾸면 이전 종목의
  // loading/error/data를 먼저 초기화한 뒤 새로 요청하므로, 전환 중 이전 종목 데이터가
  // 잠깐이라도 화면에 남지 않는다.
  useEffect(() => {
    if (!selectedStock) {
      setGoldenCrossStatus('idle')
      setGoldenCrossData(null)
      return
    }

    let cancelled = false
    setGoldenCrossStatus('loading')
    setGoldenCrossData(null)

    fetchGoldenCrossAnalysis(selectedStock.code)
      .then((data) => {
        if (cancelled) return
        setGoldenCrossData(data)
        setGoldenCrossStatus('success')
      })
      .catch(() => {
        if (!cancelled) setGoldenCrossStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [selectedStock])

  useEffect(() => {
    async function loadInitialStocks() {
      const codes = loadWatchlistCodes()
      const results = await Promise.allSettled(codes.map((code) => fetchStockData(code)))
      const loadedStocks = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value
        }
        const code = codes[index]
        return {
          id: code,
          name: code,
          code,
          price: '-',
          changeRate: null,
          status: 'error',
        }
      })
      setStocks(loadedStocks)
      setIsLoadingInitial(false)
    }
    loadInitialStocks()
  }, [])


  useEffect(() => {
    const keyword = addQuery.trim()
    if (!keyword) {
      setSearchResults([])
      return
    }

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/stocks/search?q=${encodeURIComponent(keyword)}`)
        if (!response.ok) throw new Error('검색 실패')
        const data = await response.json()
        setSearchResults(data.result ?? [])
      } catch {
        setSearchResults([])
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [addQuery])

  const filteredStocks = stocks.filter((stock) => {
    const keyword = searchTerm.toLowerCase()
    return (
      stock.name.toLowerCase().includes(keyword) ||
      stock.code.toLowerCase().includes(keyword)
    )
  })

  function handleDelete(id, e) {
    e.stopPropagation()
    setStocks((prevStocks) => {
      const updated = prevStocks.filter((stock) => stock.id !== id)
      saveWatchlistCodes(updated.map((stock) => stock.code))
      return updated
    })
    setSelectedStock((prev) => (prev && prev.id === id ? null : prev))
  }

  // 관심종목 카드를 길게 눌러서 드래그로 순서를 바꾼다.
  // dragStateRef: 포인터 하나의 "지금 어떤 상태인지"를 담는 값. 매 프레임 바뀌어도
  // 리렌더링이 필요 없는 값이라 state가 아니라 ref로 둔다.
  // draggingId: 화면에 "떠 있는" 느낌을 그려주기 위한 state (실제로 리렌더링이 필요한 부분).
  // suppressClickRef: 드래그를 끝낸 직후에 뒤따라오는 click 이벤트가 상세보기를 열지 않도록 막는 플래그.
  const cardRefs = useRef(new Map())
  const dragStateRef = useRef({
    pointerId: null,
    id: null,
    startX: 0,
    startY: 0,
    longPressTriggered: false,
    timer: null,
  })
  const suppressClickRef = useRef(false)
  const [draggingId, setDraggingId] = useState(null)

  function findStockIdAtPoint(x, y) {
    for (const [id, node] of cardRefs.current) {
      const rect = node.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return id
      }
    }
    return null
  }

  function handleCardPointerDown(e, stock) {
    // 삭제 버튼 등 카드 안의 다른 버튼을 누른 경우엔 드래그를 시작하지 않는다.
    if (e.target.closest('button')) return
    // 마우스는 왼쪽 버튼으로 누른 경우만 드래그 후보로 본다.
    if (e.pointerType === 'mouse' && e.button !== 0) return

    const dragState = dragStateRef.current
    dragState.pointerId = e.pointerId
    dragState.id = stock.id
    dragState.startX = e.clientX
    dragState.startY = e.clientY
    dragState.longPressTriggered = false

    // 손가락이 카드 밖으로 나가도 이 카드가 계속 이벤트를 받도록 포인터를 붙잡아둔다.
    e.currentTarget.setPointerCapture(e.pointerId)

    dragState.timer = setTimeout(() => {
      dragState.longPressTriggered = true
      setDraggingId(dragState.id)
    }, LONG_PRESS_MS)
  }

  function handleCardPointerMove(e) {
    const dragState = dragStateRef.current
    if (dragState.pointerId !== e.pointerId) return

    if (!dragState.longPressTriggered) {
      const moved = Math.hypot(e.clientX - dragState.startX, e.clientY - dragState.startY)
      if (moved > DRAG_MOVE_CANCEL_PX) {
        // 길게 누르기가 확정되기 전에 움직였다 = 스크롤이나 짧은 탭 의도이므로 드래그를 취소한다.
        clearTimeout(dragState.timer)
        dragState.pointerId = null
      }
      return
    }

    // 드래그 확정 후에는 페이지 스크롤을 막고, 손가락이 있는 카드 자리로 순서를 바로 바꾼다.
    e.preventDefault()
    const overId = findStockIdAtPoint(e.clientX, e.clientY)
    if (overId && overId !== dragState.id) {
      setStocks((prevStocks) => {
        const fromIndex = prevStocks.findIndex((stock) => stock.id === dragState.id)
        const toIndex = prevStocks.findIndex((stock) => stock.id === overId)
        if (fromIndex === -1 || toIndex === -1) return prevStocks

        const updated = [...prevStocks]
        const [moved] = updated.splice(fromIndex, 1)
        updated.splice(toIndex, 0, moved)
        return updated
      })
    }
  }

  function handleCardPointerUp(e) {
    const dragState = dragStateRef.current
    if (dragState.pointerId !== e.pointerId) return

    clearTimeout(dragState.timer)

    if (dragState.longPressTriggered) {
      // 드래그로 바뀐 순서를 기존 localStorage 저장 방식 그대로 저장한다.
      setStocks((prevStocks) => {
        saveWatchlistCodes(prevStocks.map((stock) => stock.code))
        return prevStocks
      })
      // 드래그를 마친 직후 발생하는 click 이벤트가 상세보기를 열지 않도록 막는다.
      suppressClickRef.current = true
      setDraggingId(null)
    }

    dragState.pointerId = null
    dragState.id = null
    dragState.longPressTriggered = false
  }

  function handleCardPointerCancel(e) {
    const dragState = dragStateRef.current
    if (dragState.pointerId !== e.pointerId) return

    clearTimeout(dragState.timer)
    if (dragState.longPressTriggered) {
      setDraggingId(null)
    }
    dragState.pointerId = null
    dragState.id = null
    dragState.longPressTriggered = false
  }

  function handleCardClick(stock) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    handleSelectStock(stock)
  }

  function handleSelectStock(stock) {
    setSelectedStock(stock)
    // 우측 패널에 새 종목을 선택할 때마다 캔들 차트 시간봉은 항상 1일부터 시작한다.
    setCandleTimeframe(DEFAULT_CHART_TIMEFRAME)
  }

  function handleCardKeyDown(e, stock) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleSelectStock(stock)
    }
  }

  async function handlePickResult(result) {
    setAddError('')

    if (stocks.some((stock) => stock.code === result.symbol)) {
      setAddError('이미 추가된 종목입니다.')
      return
    }

    setIsAdding(true)
    try {
      const newStock = await fetchStockData(result.symbol)
      setStocks((prevStocks) => {
        const updated = [...prevStocks, newStock]
        saveWatchlistCodes(updated.map((stock) => stock.code))
        return updated
      })
      setAddQuery('')
      setSearchResults([])
    } catch {
      setAddError('종목 정보를 가져오지 못했습니다.')
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>주식 시장 대시보드</h1>
      </header>

      {/* 정렬/필터 UI 골격만. 지금은 "전체"만 선택 가능하고 실제 정렬 로직은 없다. */}
      <div className="filter-bar" role="tablist" aria-label="관심종목 필터">
        {WATCHLIST_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            className={`filter-bar-button${filter.value === 'all' ? ' active' : ''}`}
            role="tab"
            aria-selected={filter.value === 'all'}
            disabled={filter.value !== 'all'}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="dashboard-layout">
      <div className="dashboard-left">
      <section className="panel search-section">
        <input
          type="text"
          className="search-input"
          placeholder="종목 이름 또는 코드 검색"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </section>

      <section className="panel add-section">
        <h2>종목 추가</h2>
        <div className="add-stock-form">
          <input
            type="text"
            className="add-stock-input"
            placeholder="추가할 종목 이름 또는 코드 검색"
            value={addQuery}
            onChange={(e) => setAddQuery(e.target.value)}
          />
        </div>
        {searchResults.length > 0 && (
          <ul className="search-results">
            {searchResults.map((result) => (
              <li key={result.symbol}>
                <button
                  type="button"
                  onClick={() => handlePickResult(result)}
                  disabled={isAdding}
                >
                  <span className="search-result-plus">+</span>
                  {result.name} ({result.symbol})
                </button>
              </li>
            ))}
          </ul>
        )}
        {addError && <p className="add-error">{addError}</p>}
      </section>

      <section className="panel watchlist-section">
        <div className="watchlist-header">
          <h2>관심종목</h2>
          <span className="watchlist-count">{stocks.length}개</span>
          <button
            type="button"
            className="manual-refresh-button"
            onClick={refreshStocks}
            disabled={isRefreshing}
          >
            {isRefreshing ? '갱신 중...' : '지금 새로고침'}
          </button>
        </div>

        {isLoadingInitial ? (
          <p className="status-message">불러오는 중...</p>
        ) : (
          <div className="stock-grid">
            {filteredStocks.map((stock, index) => {
              const cardRefCallback = (node) => {
                if (node) cardRefs.current.set(stock.id, node)
                else cardRefs.current.delete(stock.id)
              }
              const isDragging = draggingId === stock.id
              const isSelected = selectedStock?.id === stock.id
              const rowClassName = `stock-card${isDragging ? ' stock-card--dragging' : ''}${
                isSelected ? ' stock-card--selected' : ''
              }`
              const initials = getStockInitials(stock.name, stock.englishName)

              if (stock.status === 'error') {
                return (
                  <div
                    className={rowClassName}
                    key={stock.id}
                    ref={cardRefCallback}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleCardClick(stock)}
                    onKeyDown={(e) => handleCardKeyDown(e, stock)}
                    onPointerDown={(e) => handleCardPointerDown(e, stock)}
                    onPointerMove={handleCardPointerMove}
                    onPointerUp={handleCardPointerUp}
                    onPointerCancel={handleCardPointerCancel}
                  >
                    <span className="watchlist-favorite" aria-hidden="true">♡</span>
                    <span className="watchlist-rank">{index + 1}</span>
                    <span className="watchlist-logo" aria-hidden="true">{initials}</span>
                    <div className="watchlist-info">
                      <p className="stock-name">{stock.code}</p>
                    </div>
                    <p className="stock-error watchlist-error-cell">가격 정보를 불러오지 못했습니다</p>
                    <button
                      type="button"
                      className="delete-button watchlist-delete"
                      onClick={(e) => handleDelete(stock.id, e)}
                      aria-label={`${stock.name} 관심종목 삭제`}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                )
              }

              const { rate, changeClass } = getChangeDisplay(stock.changeRate)

              return (
                <div
                  className={rowClassName}
                  key={stock.id}
                  ref={cardRefCallback}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleCardClick(stock)}
                  onKeyDown={(e) => handleCardKeyDown(e, stock)}
                  onPointerDown={(e) => handleCardPointerDown(e, stock)}
                  onPointerMove={handleCardPointerMove}
                  onPointerUp={handleCardPointerUp}
                  onPointerCancel={handleCardPointerCancel}
                >
                  <span className="watchlist-favorite" aria-hidden="true">♡</span>
                  <span className="watchlist-rank">{index + 1}</span>
                  <span className="watchlist-logo" aria-hidden="true">{initials}</span>
                  <div className="watchlist-info">
                    <p className="stock-name">{stock.name}</p>
                    <span className="watchlist-code">{stock.code}</span>
                  </div>
                  <p className="stock-price watchlist-price">{stock.price}</p>
                  <p className={`stock-change watchlist-change ${changeClass}`}>
                    {rate === null ? '–' : stock.changeRate}
                  </p>
                  <button
                    type="button"
                    className="delete-button watchlist-delete"
                    onClick={(e) => handleDelete(stock.id, e)}
                    aria-label={`${stock.name} 관심종목 삭제`}
                  >
                    <TrashIcon />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>
      </div>

      <div className="dashboard-right">
        {selectedStock ? (
          <div className="stock-detail-panel" aria-label={`${selectedStock.name} 상세 정보`}>
            <div className="stock-detail-header">
              <div>
                <h2>
                  {selectedStock.name} <span className="stock-detail-code">({selectedStock.code})</span>
                </h2>
                {selectedStock.market && <p className="stock-detail-market">{selectedStock.market}</p>}
              </div>
            </div>

            {selectedStock.status === 'error' ? (
              <p className="stock-error">가격 정보를 불러오지 못했습니다</p>
            ) : (
              (() => {
                const { rate, changeClass, arrow } = getChangeDisplay(selectedStock.changeRate)
                return (
                  <>
                    <div className="stock-detail-price-row">
                      <span className="stock-detail-price">{selectedStock.price}</span>
                      <span className={`stock-change ${changeClass}`}>
                        {rate === null ? '등락률 정보 없음' : `${arrow} ${selectedStock.changeRate}`}
                      </span>
                    </div>

                    {formatTimestamp(selectedStock.timestamp) && (
                      <p className="stock-detail-timestamp">
                        기준 시각: {formatTimestamp(selectedStock.timestamp)}
                      </p>
                    )}

                    <div className="stock-chart-section stock-chart-section--compact">
                      <div className="stock-chart-header">
                        <div className="stock-chart-title-group">
                          <p className="stock-chart-title">가격 추이 (1개월)</p>
                          {chartStatus === 'success' &&
                            (() => {
                              const periodReturn = calculatePeriodReturn(chartCloses)
                              if (periodReturn === null) return null
                              const { changeClass } = getChangeDisplay(periodReturn)
                              return (
                                <span className={`stock-chart-return ${changeClass}`}>
                                  {formatChangeRate(periodReturn)}
                                </span>
                              )
                            })()}
                        </div>
                      </div>
                      {chartStatus === 'loading' && (
                        <p className="stock-chart-status">차트 불러오는 중...</p>
                      )}
                      {chartStatus === 'error' && (
                        <p className="stock-chart-status">차트를 불러오지 못했습니다</p>
                      )}
                      {chartStatus === 'success' && chartCloses && chartCloses.length >= 2 && (
                        <>
                          <StockChart closes={chartCloses} periodLabel="1개월" />
                          <div className="stock-chart-range">
                            <span>{formatPriceValue(chartCloses[0])}</span>
                            <span>{formatPriceValue(chartCloses[chartCloses.length - 1])}</span>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="candle-chart-section">
                      <div className="stock-chart-header">
                        <p className="stock-chart-title">캔들 차트</p>
                        <div
                          className="stock-chart-period-buttons"
                          role="group"
                          aria-label="차트 시간봉 선택"
                        >
                          {CHART_TIMEFRAMES.map((timeframe) => (
                            <button
                              key={timeframe.value}
                              type="button"
                              className={`stock-chart-period-button${
                                candleTimeframe === timeframe.value ? ' active' : ''
                              }${timeframe.supported ? '' : ' unsupported'}`}
                              aria-pressed={candleTimeframe === timeframe.value}
                              disabled={!timeframe.supported}
                              title={
                                timeframe.supported
                                  ? undefined
                                  : '토스증권 API 미지원 시간봉입니다 (정규장 6.5시간 특성상 데이터를 만들 수 없어요)'
                              }
                              onClick={() => setCandleTimeframe(timeframe.value)}
                            >
                              {timeframe.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="ma-legend">
                        <span className="ma-legend-label">이동평균선</span>
                        {MA_PERIODS.map((period) => (
                          <span key={period} className="ma-legend-item" style={{ color: MA_COLORS[period] }}>
                            {period}
                          </span>
                        ))}
                      </div>

                      {candleStatus === 'loading' && (
                        <p className="stock-chart-status">캔들 차트 불러오는 중...</p>
                      )}
                      {candleStatus === 'error' && (
                        <p className="stock-chart-status">캔들 차트를 불러오지 못했습니다</p>
                      )}
                      {candleStatus === 'success' && candleData && candleData.candles.length > 0 && (
                        <CandleChart
                          candles={candleData.candles}
                          ma={candleData.ma}
                          timeframe={candleData.timeframe}
                        />
                      )}
                    </div>

                    <div className="golden-cross-panel">
                      <p className="golden-cross-panel-title">골든크로스 분석 (일봉 기준)</p>
                      {goldenCrossStatus === 'loading' && (
                        <p className="stock-chart-status">골든크로스 분석 불러오는 중...</p>
                      )}
                      {goldenCrossStatus === 'error' && (
                        <p className="stock-chart-status">골든크로스 분석 정보를 가져오지 못했습니다</p>
                      )}
                      {goldenCrossStatus === 'success' && goldenCrossData && !goldenCrossData.latestGolden && (
                        <p className="stock-chart-status">분석 가능한 골든크로스가 없습니다.</p>
                      )}
                      {goldenCrossStatus === 'success' && goldenCrossData && goldenCrossData.latestGolden && (
                        <>
                          {/* 1행: 골든크로스 날짜 → 기준 저점 → 확정 고점. */}
                          <div className="golden-cross-row">
                            <div className="golden-cross-cell golden-cross-cell--highlight">
                              <span className="golden-cross-label">골든크로스</span>
                              <span className="golden-cross-value golden-cross-value--highlight">
                                {goldenCrossData.latestGolden.date}
                              </span>
                            </div>
                            <div className="golden-cross-cell">
                              <span className="golden-cross-label">기준 저점</span>
                              {goldenCrossData.referenceLow ? (
                                <>
                                  <span className="golden-cross-sub">{goldenCrossData.referenceLow.date}</span>
                                  <span className="golden-cross-value golden-cross-value--low">
                                    {formatPriceValue(goldenCrossData.referenceLow.low)}
                                  </span>
                                </>
                              ) : (
                                <span className="golden-cross-value golden-cross-value--neutral">정보 없음</span>
                              )}
                            </div>
                            <div className="golden-cross-cell">
                              <span className="golden-cross-label">확정 고점</span>
                              {goldenCrossData.confirmedHigh ? (
                                <>
                                  <span className="golden-cross-sub">{goldenCrossData.confirmedHigh.date}</span>
                                  <span className="golden-cross-value golden-cross-value--high">
                                    {formatPriceValue(goldenCrossData.confirmedHigh.high)}
                                  </span>
                                </>
                              ) : (
                                <span className="golden-cross-value golden-cross-value--neutral">정보 없음</span>
                              )}
                            </div>
                          </div>

                          {/* 2행: 두 기준점에서 계산된 피보나치 레벨과 구조 유효 여부. */}
                          <div className="golden-cross-row">
                            <div className="golden-cross-cell">
                              <span className="golden-cross-label">피보나치 0.5</span>
                              <span className="golden-cross-value golden-cross-value--fib">
                                {goldenCrossData.fibonacci
                                  ? formatPriceValue(goldenCrossData.fibonacci.fibonacciLevels['0.5'])
                                  : '정보 없음'}
                              </span>
                            </div>
                            <div className="golden-cross-cell">
                              <span className="golden-cross-label">피보나치 0.618</span>
                              <span className="golden-cross-value golden-cross-value--fib">
                                {goldenCrossData.fibonacci
                                  ? formatPriceValue(goldenCrossData.fibonacci.fibonacciLevels['0.618'])
                                  : '정보 없음'}
                              </span>
                            </div>
                            <div className="golden-cross-cell">
                              <span className="golden-cross-label">구조 유효 여부</span>
                              <span
                                className={`golden-cross-value ${
                                  goldenCrossData.fibonacci?.isValid
                                    ? 'golden-cross-value--valid'
                                    : 'golden-cross-value--invalid'
                                }`}
                              >
                                {goldenCrossData.fibonacci ? (goldenCrossData.fibonacci.isValid ? '유효' : '무효') : '정보 없음'}
                              </span>
                            </div>
                          </div>

                          {/* 3행: 0.5/0.618 각각의 도달 상태와 무효화 날짜(있으면). */}
                          <div className="golden-cross-row">
                            <div className="golden-cross-cell">
                              <span className="golden-cross-label">0.5 도달 상태</span>
                              <span
                                className={`golden-cross-value ${
                                  goldenCrossData.fibonacci?.levelStatus['0.5'].reached
                                    ? 'golden-cross-value--valid'
                                    : 'golden-cross-value--neutral'
                                }`}
                              >
                                {goldenCrossData.fibonacci
                                  ? goldenCrossData.fibonacci.levelStatus['0.5'].reached
                                    ? goldenCrossData.fibonacci.levelStatus['0.5'].firstReachedDate
                                    : '미도달'
                                  : '정보 없음'}
                              </span>
                            </div>
                            <div className="golden-cross-cell">
                              <span className="golden-cross-label">0.618 도달 상태</span>
                              <span
                                className={`golden-cross-value ${
                                  goldenCrossData.fibonacci?.levelStatus['0.618'].reached
                                    ? 'golden-cross-value--valid'
                                    : 'golden-cross-value--neutral'
                                }`}
                              >
                                {goldenCrossData.fibonacci
                                  ? goldenCrossData.fibonacci.levelStatus['0.618'].reached
                                    ? goldenCrossData.fibonacci.levelStatus['0.618'].firstReachedDate
                                    : '미도달'
                                  : '정보 없음'}
                              </span>
                            </div>
                            <div className="golden-cross-cell">
                              <span className="golden-cross-label">무효화 날짜</span>
                              <span className="golden-cross-value golden-cross-value--neutral">
                                {goldenCrossData.fibonacci?.invalidatedDate ?? '없음'}
                              </span>
                            </div>
                          </div>

                          {goldenCrossData.fibonacci && (
                            <p className="golden-cross-summary">
                              {buildGoldenCrossSummary(goldenCrossData.fibonacci)}
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )
              })()
            )}
          </div>
        ) : (
          <div className="stock-detail-empty">
            <p>왼쪽에서 종목을 선택하면 상세 정보가 여기에 표시됩니다.</p>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

export default App
