import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const defaultStockCodes = ['005930', '000660', '035420']
const WATCHLIST_STORAGE_KEY = 'stock-dashboard:watchlist'
const AUTO_REFRESH_INTERVAL_MS = 30000
// 이 시간(ms) 이상 카드를 누르고 있으면 "탭"이 아니라 "드래그 시작"으로 본다.
const LONG_PRESS_MS = 400
// 길게 누르기가 확정되기 전에 손가락이 이만큼(px) 넘게 움직이면 스크롤/짧은 탭으로 보고 드래그를 취소한다.
const DRAG_MOVE_CANCEL_PX = 10

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

function formatPriceValue(value) {
  if (value === null || value === undefined) return '정보 없음'
  return `${Number(value).toLocaleString()}원`
}

function formatVolumeValue(value) {
  if (value === null || value === undefined) return '정보 없음'
  return `${Number(value).toLocaleString()}주`
}

function formatTimestamp(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('ko-KR')
}

// 자동 갱신 상태 표시줄은 화면이 좁아도 한 줄에 들어가야 하므로 "HH:MM:SS"만 보여준다.
function formatTimeOnly(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString('ko-KR', { hour12: false })
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
    code: data.code,
    market: data.market ?? null,
    price: `${Number(data.price).toLocaleString()}원`,
    changeRate: formatChangeRate(data.changeRate),
    openPrice: data.openPrice,
    highPrice: data.highPrice,
    lowPrice: data.lowPrice,
    volume: data.volume,
    timestamp: data.timestamp,
    status: 'success',
  }
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
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const stocksRef = useRef(stocks)
  useEffect(() => {
    stocksRef.current = stocks
  }, [stocks])

  // isRefreshingRef가 실제 "잠금"이다(자동 갱신과 수동 버튼이 함께 확인해서 중복 요청을 막는다).
  // isRefreshing state는 버튼 표시("갱신 중...")를 화면에 그려주기 위한 용도로만 쓴다.
  const isRefreshingRef = useRef(false)

  // 관심종목 가격을 다시 받아온다. 자동 갱신(30초 주기)과 "지금 새로고침" 버튼이
  // 이 함수 하나를 공유해서 쓴다. 토스 API 429(요청 과다)를 피하기 위해
  // (1) 이미 갱신 중이면 새 요청을 건너뛰고, (2) 여러 종목을 한번에 몰아서 요청하지 않고
  // 하나씩 순서대로 요청한다.
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
    setLastUpdatedAt(new Date())
    isRefreshingRef.current = false
    setIsRefreshing(false)
  }, [])

  useEffect(() => {
    if (!selectedStock) return
    function handleKeyDown(e) {
      if (e.key === 'Escape') setSelectedStock(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
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

  // 30초마다 refreshStocks를 호출한다. 화면이 보이지 않을 때는 건너뛴다
  // (어차피 refreshStocks 안에서도 이미 갱신 중이면 건너뛰므로, 버튼과 겹쳐도 중복 요청은 안 생긴다).
  useEffect(() => {
    const intervalId = setInterval(() => {
      if (document.hidden) return
      refreshStocks()
    }, AUTO_REFRESH_INTERVAL_MS)

    return () => clearInterval(intervalId)
  }, [refreshStocks])

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
          <span className="auto-refresh-status">
            <span>30초마다 자동 갱신</span>
            <span className="auto-refresh-time">
              마지막 갱신 {formatTimeOnly(lastUpdatedAt) ?? '대기 중'}
            </span>
          </span>
        </div>

        {isLoadingInitial ? (
          <p className="status-message">불러오는 중...</p>
        ) : (
          <div className="stock-grid">
            {filteredStocks.map((stock) => {
              const cardRefCallback = (node) => {
                if (node) cardRefs.current.set(stock.id, node)
                else cardRefs.current.delete(stock.id)
              }
              const isDragging = draggingId === stock.id

              if (stock.status === 'error') {
                return (
                  <div
                    className={`stock-card${isDragging ? ' stock-card--dragging' : ''}`}
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
                    <p className="stock-name">{stock.name} ({stock.code})</p>
                    <p className="stock-error">가격 정보를 불러오지 못했습니다</p>
                    <button
                      type="button"
                      className="delete-button"
                      onClick={(e) => handleDelete(stock.id, e)}
                    >
                      삭제
                    </button>
                  </div>
                )
              }

              const { rate, changeClass, arrow } = getChangeDisplay(stock.changeRate)
              const isBigMove = rate !== null && Math.abs(rate) >= 1

              return (
                <div
                  className={`stock-card${isDragging ? ' stock-card--dragging' : ''}`}
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
                  <p className="stock-name">{stock.name} ({stock.code})</p>
                  <p className="stock-price">{stock.price}</p>
                  <p className={`stock-change ${changeClass}`}>
                    {rate === null ? '등락률 정보 없음' : `${arrow} ${stock.changeRate}`}
                  </p>
                  {isBigMove && <p className="big-move-tag">큰 변동</p>}
                  <button
                    type="button"
                    className="delete-button"
                    onClick={(e) => handleDelete(stock.id, e)}
                  >
                    삭제
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {selectedStock && (
        <div className="stock-detail-backdrop" onClick={() => setSelectedStock(null)}>
          <div
            className="stock-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedStock.name} 상세 정보`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="stock-detail-header">
              <div>
                <h2>
                  {selectedStock.name} <span className="stock-detail-code">({selectedStock.code})</span>
                </h2>
                {selectedStock.market && <p className="stock-detail-market">{selectedStock.market}</p>}
              </div>
              <button
                type="button"
                className="stock-detail-close"
                onClick={() => setSelectedStock(null)}
                aria-label="닫기"
              >
                ✕
              </button>
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

                    <dl className="stock-detail-grid">
                      <div>
                        <dt>시가</dt>
                        <dd>{formatPriceValue(selectedStock.openPrice)}</dd>
                      </div>
                      <div>
                        <dt>고가</dt>
                        <dd>{formatPriceValue(selectedStock.highPrice)}</dd>
                      </div>
                      <div>
                        <dt>저가</dt>
                        <dd>{formatPriceValue(selectedStock.lowPrice)}</dd>
                      </div>
                      <div>
                        <dt>거래량</dt>
                        <dd>{formatVolumeValue(selectedStock.volume)}</dd>
                      </div>
                    </dl>

                    {formatTimestamp(selectedStock.timestamp) && (
                      <p className="stock-detail-timestamp">
                        기준 시각: {formatTimestamp(selectedStock.timestamp)}
                      </p>
                    )}
                  </>
                )
              })()
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
