import { useEffect, useState } from 'react'
import './App.css'

const defaultStockCodes = ['005930', '000660', '035420']
const WATCHLIST_STORAGE_KEY = 'stock-dashboard:watchlist'

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
        </div>

        {isLoadingInitial ? (
          <p className="status-message">불러오는 중...</p>
        ) : (
          <div className="stock-grid">
            {filteredStocks.map((stock) => {
              if (stock.status === 'error') {
                return (
                  <div
                    className="stock-card"
                    key={stock.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelectStock(stock)}
                    onKeyDown={(e) => handleCardKeyDown(e, stock)}
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
                  className="stock-card"
                  key={stock.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleSelectStock(stock)}
                  onKeyDown={(e) => handleCardKeyDown(e, stock)}
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
