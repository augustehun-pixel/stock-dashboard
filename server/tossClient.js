// 토스증권 API와 통신하는 공용 로직(기본 URL, 재시도, 토큰 발급/캐시).
// server/index.js의 기존 로직을 그대로 옮겨온 것으로 동작은 바뀌지 않는다.
// 여러 분석 모듈(예: MA200)이 같은 토큰 캐시를 공유하도록 여기 한 곳에 둔다.

export const TOSS_API_BASE = 'https://openapi.tossinvest.com'

// 토스증권 API는 짧은 시간에 요청이 몰리면 일시적으로 429(요청 과다)를 반환한다.
// 이런 경우 잠깐 기다렸다가 다시 시도하면 대부분 성공하므로 재시도 로직을 둔다.
export async function fetchWithRetry(url, options, retries = 3, delayMs = 300) {
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

export async function getTossAccessToken() {
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
