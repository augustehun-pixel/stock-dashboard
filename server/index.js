import { createServer } from 'node:http'

const PORT = 3001
const TOSS_API_BASE = 'https://openapi.tossinvest.com'

async function getTossAccessToken() {
  const response = await fetch(`${TOSS_API_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.TOSS_CLIENT_KEY,
      client_secret: process.env.TOSS_CLIENT_SECRET,
    }),
  })

  if (!response.ok) {
    throw new Error(`토큰 발급 실패 (HTTP ${response.status})`)
  }

  const data = await response.json()
  return data.access_token
}

async function getStockInfo(accessToken, code) {
  const authHeader = { Authorization: `Bearer ${accessToken}` }

  const [priceRes, stockRes] = await Promise.all([
    fetch(`${TOSS_API_BASE}/api/v1/prices?symbols=${code}`, { headers: authHeader }),
    fetch(`${TOSS_API_BASE}/api/v1/stocks?symbols=${code}`, { headers: authHeader }),
  ])

  if (!priceRes.ok) {
    throw new Error(`현재가 조회 실패 (HTTP ${priceRes.status})`)
  }
  if (!stockRes.ok) {
    throw new Error(`종목 정보 조회 실패 (HTTP ${stockRes.status})`)
  }

  const priceData = await priceRes.json()
  const stockData = await stockRes.json()

  const price = priceData.result?.[0]
  const stock = stockData.result?.[0]

  if (!price || !stock) {
    throw new Error('해당 종목 정보를 찾을 수 없음')
  }

  return {
    code: stock.symbol,
    name: stock.name,
    price: price.lastPrice,
    currency: price.currency,
    timestamp: price.timestamp,
  }
}

const server = createServer(async (req, res) => {
  const match = req.url.match(/^\/api\/stock\/([A-Za-z0-9.-]+)$/)

  if (req.method !== 'GET' || !match) {
    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
    return
  }

  const code = match[1]

  try {
    const accessToken = await getTossAccessToken()
    const stockInfo = await getStockInfo(accessToken, code)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(stockInfo))
  } catch (error) {
    console.error('토스증권 API 요청 실패:', error.message)
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: '주식 정보를 가져오지 못했습니다.' }))
  }
})

server.listen(PORT, () => {
  console.log(`API 서버 실행 중: http://localhost:${PORT}`)
})
