import './App.css'

const stocks = [
  { name: '삼성전자', code: '005930', price: '75,000원', changeRate: '+1.25%' },
  { name: 'SK하이닉스', code: '000660', price: '185,000원', changeRate: '-0.80%' },
  { name: 'NAVER', code: '035420', price: '210,000원', changeRate: '+0.45%' },
]

function App() {
  return (
    <>
      <h1>Hello Stock Dashboard</h1>
      {stocks.map((stock) => {
        const isNegative = stock.changeRate.startsWith('-')
        return (
          <div className="stock-card" key={stock.code}>
            <p>{stock.name} ({stock.code})</p>
            <p>{stock.price}</p>
            <p className={isNegative ? 'negative' : 'positive'}>
              {isNegative ? '↓' : '↑'} {stock.changeRate}
            </p>
          </div>
        )
      })}
    </>
  )
}

export default App
