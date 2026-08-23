import './App.css'

const stock = {
  name: '삼성전자',
  code: '005930',
  price: '75,000원',
  changeRate: '+1.25%',
}

function App() {
  return (
    <>
      <h1>Hello Stock Dashboard</h1>
      <div className="stock-card">
        <p>{stock.name} ({stock.code})</p>
        <p>{stock.price}</p>
        <p className={stock.changeRate.startsWith('-') ? 'negative' : 'positive'}>
          {stock.changeRate}
        </p>
      </div>
    </>
  )
}

export default App
