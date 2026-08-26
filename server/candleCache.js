// 역할: 캔들 데이터를 디스크 파일로 저장/불러오기만 하는 순수 I/O 모듈.
// CLIENT_KEY/SECRET/access token 등 비밀값은 절대 다루지 않는다 - 시세(캔들) 데이터만
// 저장한다. 이 캐시 폴더는 git에 커밋되지 않는다(.gitignore에 server/.cache/ 추가함).
//
// 목적: 1분봉처럼 한 번 확정되면 절대 바뀌지 않는 과거 데이터를 디스크에 남겨서,
// 서버를 다시 켜거나 메모리 캐시(TTL)가 만료돼도 이미 받아둔 과거 데이터를
// 처음부터 다시 요청하지 않게 한다.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

const CACHE_DIR = new URL('./.cache/', import.meta.url)

function cachePath(key) {
  return new URL(`${key}.json`, CACHE_DIR)
}

// key로 저장된 캔들 배열을 읽는다. 캐시가 없거나 손상되어 읽을 수 없으면
// null을 돌려준다 - 호출부는 이를 "캐시 없음"으로 취급해 새로 받으면 된다(가짜 값 금지).
export function readCandleCache(key) {
  try {
    const path = cachePath(key)
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

export function writeCandleCache(key, candles) {
  mkdirSync(CACHE_DIR, { recursive: true })
  writeFileSync(cachePath(key), JSON.stringify(candles))
}
