import { useEffect, useState } from 'react'
import './App.css'

const initialStockCodes = ['005930', '000660', '035420']

function formatChangeRate(rate) {
  if (rate === null || rate === undefined) return null
  const sign = rate > 0 ? '+' : ''
  return `${sign}${rate.toFixed(2)}%`
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
    price: `${Number(data.price).toLocaleString()}원`,
    changeRate: formatChangeRate(data.changeRate),
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

  useEffect(() => {
    async function loadInitialStocks() {
      const results = await Promise.allSettled(
        initialStockCodes.map((code) => fetchStockData(code)),
      )
      const loadedStocks = results.map((result, index) => {
        if (result.status === 'fulfilled') {
          return result.value
        }
        const code = initialStockCodes[index]
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

  function handleDelete(id) {
    setStocks(stocks.filter((stock) => stock.id !== id))
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
      setStocks((prevStocks) => [...prevStocks, newStock])
      setAddQuery('')
      setSearchResults([])
    } catch {
      setAddError('종목 정보를 가져오지 못했습니다.')
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <>
      <h1>Hello Stock Dashboard</h1>
      <input
        type="text"
        className="search-input"
        placeholder="종목 이름 또는 코드 검색"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
      />
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
                {result.name} ({result.symbol})
              </button>
            </li>
          ))}
        </ul>
      )}
      {addError && <p className="add-error">{addError}</p>}
      {isLoadingInitial ? (
        <p>불러오는 중...</p>
      ) : (
        filteredStocks.map((stock) => {
          if (stock.status === 'error') {
            return (
              <div className="stock-card" key={stock.id}>
                <p>{stock.name} ({stock.code})</p>
                <p>가격 정보를 불러오지 못했습니다</p>
                <button type="button" onClick={() => handleDelete(stock.id)}>
                  삭제
                </button>
              </div>
            )
          }

          const rate = stock.changeRate === null ? null : parseFloat(stock.changeRate)
          const isBigMove = rate !== null && Math.abs(rate) >= 1

          let changeClass = 'neutral'
          let arrow = '→'
          if (rate === null) {
            changeClass = 'neutral'
          } else if (rate > 0) {
            changeClass = 'positive'
            arrow = '↑'
          } else if (rate < 0) {
            changeClass = 'negative'
            arrow = '↓'
          }

          return (
            <div className="stock-card" key={stock.id}>
              <p>{stock.name} ({stock.code})</p>
              <p>{stock.price}</p>
              <p className={changeClass}>
                {rate === null ? '등락률 정보 없음' : `${arrow} ${stock.changeRate}`}
              </p>
              {isBigMove && <p className="big-move-tag">큰 변동</p>}
              <button type="button" onClick={() => handleDelete(stock.id)}>
                삭제
              </button>
            </div>
          )
        })
      )}
    </>
  )
}

export default App
