import { useState } from 'react'
import './App.css'

const initialStocks = [
  { id: '005930', name: '삼성전자', code: '005930', price: '75,000원', changeRate: '+1.25%' },
  { id: '000660', name: 'SK하이닉스', code: '000660', price: '185,000원', changeRate: '-0.80%' },
  { id: '035420', name: 'NAVER', code: '035420', price: '210,000원', changeRate: '+0.45%' },
]

function App() {
  const [stocks, setStocks] = useState(initialStocks)
  const [searchTerm, setSearchTerm] = useState('')
  const [newStockName, setNewStockName] = useState('')

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

  function handleAdd() {
    if (newStockName.trim() === '') return
    const newStock = {
      id: Date.now().toString(),
      name: newStockName,
      code: '-',
      price: '-',
      changeRate: '+0.00%',
    }
    setStocks([...stocks, newStock])
    setNewStockName('')
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
          placeholder="추가할 종목 이름"
          value={newStockName}
          onChange={(e) => setNewStockName(e.target.value)}
        />
        <button type="button" onClick={handleAdd}>
          추가
        </button>
      </div>
      {filteredStocks.map((stock) => {
        const isNegative = stock.changeRate.startsWith('-')
        const isBigMove = Math.abs(parseFloat(stock.changeRate)) >= 1
        return (
          <div className="stock-card" key={stock.id}>
            <p>{stock.name} ({stock.code})</p>
            <p>{stock.price}</p>
            <p className={isNegative ? 'negative' : 'positive'}>
              {isNegative ? '↓' : '↑'} {stock.changeRate}
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
