import { createServer } from 'node:http'

const PORT = 3001
const TOSS_API_BASE = 'https://openapi.tossinvest.com'

// 토스증권 API는 짧은 시간에 요청이 몰리면 일시적으로 429(요청 과다)를 반환한다.
// 이런 경우 잠깐 기다렸다가 다시 시도하면 대부분 성공하므로 재시도 로직을 둔다.
async function fetchWithRetry(url, options, retries = 3, delayMs = 300) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response
    try {
      response = await fetch(url, options)
    } catch (error) {
      if (attempt === retries) throw error
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** attempt))
      continue
    }

    if (response.status !== 429 || attempt === retries) {
      return response
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** attempt))
  }
}

// 토스증권은 새 토큰을 발급하면 이전 토큰을 즉시 무효화하므로,
// 요청마다 새로 발급받지 않고 만료 전까지 하나의 토큰을 재사용한다.
// 동시에 여러 요청이 들어와도 토큰 발급은 한 번만 하도록 진행 중인 요청을 공유한다.
let cachedToken = null
let cachedTokenExpiresAt = 0
let tokenRequestPromise = null

async function getTossAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt) {
    return cachedToken
  }

  if (!tokenRequestPromise) {
    tokenRequestPromise = (async () => {
      const response = await fetchWithRetry(`${TOSS_API_BASE}/oauth2/token`, {
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
      cachedToken = data.access_token
      // 만료 60초 전에 미리 새로 받도록 여유를 둔다.
      cachedTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000
      return cachedToken
    })()
  }

  try {
    return await tokenRequestPromise
  } finally {
    tokenRequestPromise = null
  }
}

async function getStockInfo(accessToken, code) {
  const authHeader = { Authorization: `Bearer ${accessToken}` }

  const [priceRes, stockRes, candleRes] = await Promise.all([
    fetchWithRetry(`${TOSS_API_BASE}/api/v1/prices?symbols=${code}`, { headers: authHeader }),
    fetchWithRetry(`${TOSS_API_BASE}/api/v1/stocks?symbols=${code}`, { headers: authHeader }),
    fetchWithRetry(`${TOSS_API_BASE}/api/v1/candles?symbol=${code}&interval=1d&count=2`, {
      headers: authHeader,
    }),
  ])

  if (!priceRes.ok) {
    throw new Error(`현재가 조회 실패 (HTTP ${priceRes.status})`)
  }
  if (!stockRes.ok) {
    throw new Error(`종목 정보 조회 실패 (HTTP ${stockRes.status})`)
  }
  if (!candleRes.ok) {
    throw new Error(`시세 이력 조회 실패 (HTTP ${candleRes.status})`)
  }

  const priceData = await priceRes.json()
  const stockData = await stockRes.json()
  const candleData = await candleRes.json()

  const price = priceData.result?.[0]
  const stock = stockData.result?.[0]
  const candles = candleData.result?.candles ?? []

  if (!price || !stock) {
    throw new Error('해당 종목 정보를 찾을 수 없음')
  }

  // candles[0] = 오늘, candles[1] = 어제(전일 종가) - 최신순 정렬
  const previousClose = candles[1] ? Number(candles[1].closePrice) : null
  const lastPrice = Number(price.lastPrice)
  const changeRate =
    previousClose && previousClose !== 0
      ? Math.round(((lastPrice - previousClose) / previousClose) * 10000) / 100
      : null

  return {
    code: stock.symbol,
    name: stock.name,
    price: price.lastPrice,
    currency: price.currency,
    timestamp: price.timestamp,
    changeRate,
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
