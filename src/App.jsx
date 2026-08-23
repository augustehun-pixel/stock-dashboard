import { useEffect, useState } from 'react'
import './App.css'

const initialStocks = [
  { id: '005930', name: '삼성전자', code: '005930', price: '75,000원', changeRate: '+1.25%' },
  { id: '000660', name: 'SK하이닉스', code: '000660', price: '185,000원', changeRate: '-0.80%' },
  { id: '035420', name: 'NAVER', code: '035420', price: '210,000원', changeRate: '+0.45%' },
]

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
  }
}

function App() {
  const [stocks, setStocks] = useState(initialStocks)
  const [searchTerm, setSearchTerm] = useState('')
  const [newStockName, setNewStockName] = useState('')
  const [samsungStatus, setSamsungStatus] = useState('loading')
  const [isAdding, setIsAdding] = useState(false)
  const [addError, setAddError] = useState('')

  useEffect(() => {
    async function loadSamsungPrice() {
      try {
        const response = await fetch('/api/stock/005930')
        if (!response.ok) throw new Error('요청 실패')
        const data = await response.json()
        setStocks((prevStocks) =>
          prevStocks.map((stock) =>
            stock.id === '005930'
              ? {
                  ...stock,
                  name: data.name,
                  code: data.code,
                  price: `${Number(data.price).toLocaleString()}원`,
                  changeRate: formatChangeRate(data.changeRate),
                }
              : stock,
          ),
        )
        setSamsungStatus('success')
      } catch {
        setSamsungStatus('error')
      }
    }
    loadSamsungPrice()
  }, [])

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

  async function handleAdd() {
    const code = newStockName.trim()
    setAddError('')

    if (!/^\d{6}$/.test(code)) {
      setAddError('6자리 종목코드를 입력해주세요.')
      return
    }

    if (stocks.some((stock) => stock.code === code)) {
      setAddError('이미 추가된 종목입니다.')
      return
    }

    setIsAdding(true)
    try {
      const newStock = await fetchStockData(code)
      setStocks((prevStocks) => [...prevStocks, newStock])
      setNewStockName('')
    } catch {
      setAddError('종목 정보를 가져오지 못했습니다. 종목코드를 확인해주세요.')
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
          placeholder="추가할 종목코드 (6자리)"
          value={newStockName}
          onChange={(e) => setNewStockName(e.target.value)}
        />
        <button type="button" onClick={handleAdd} disabled={isAdding}>
          {isAdding ? '추가 중...' : '추가'}
        </button>
      </div>
      {addError && <p className="add-error">{addError}</p>}
      {filteredStocks.map((stock) => {
        const isSamsung = stock.id === '005930'

        if (isSamsung && samsungStatus === 'loading') {
          return (
            <div className="stock-card" key={stock.id}>
              <p>{stock.name} ({stock.code})</p>
              <p>불러오는 중...</p>
              <button type="button" onClick={() => handleDelete(stock.id)}>
                삭제
              </button>
            </div>
          )
        }

        if (isSamsung && samsungStatus === 'error') {
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
      })}
    </>
  )
}

export default App
