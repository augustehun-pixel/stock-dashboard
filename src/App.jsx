import { useState } from 'react'
import './App.css'

const stocks = [
  { name: '삼성전자', code: '005930', price: '75,000원', changeRate: '+1.25%' },
  { name: 'SK하이닉스', code: '000660', price: '185,000원', changeRate: '-0.80%' },
  { name: 'NAVER', code: '035420', price: '210,000원', changeRate: '+0.45%' },
]

function App() {
  const [searchTerm, setSearchTerm] = useState('')

  const filteredStocks = stocks.filter((stock) => {
    const keyword = searchTerm.toLowerCase()
    return (
      stock.name.toLowerCase().includes(keyword) ||
      stock.code.toLowerCase().includes(keyword)
    )
  })

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
      {filteredStocks.map((stock) => {
        const isNegative = stock.changeRate.startsWith('-')
        const isBigMove = Math.abs(parseFloat(stock.changeRate)) >= 1
        return (
          <div className="stock-card" key={stock.code}>
            <p>{stock.name} ({stock.code})</p>
            <p>{stock.price}</p>
            <p className={isNegative ? 'negative' : 'positive'}>
              {isNegative ? '↓' : '↑'} {stock.changeRate}
            </p>
            {isBigMove && <p className="big-move-tag">큰 변동</p>}
          </div>
        )
      })}
    </>
  )
}

export default App
