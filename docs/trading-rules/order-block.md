# Order Block Rules

## 1. 절대 원칙

- Order Block의 생성, engulfing 판정, 영역 작도는 몸통(Open/Close) 기준이다.
- OB 영역에는 꼬리(High/Low)를 포함하지 않는다.
- 꼬리는 손절 및 무효화 판단에만 사용한다.
- engulfing은 몸통을 100% 완전히 감싸야 한다.
- 몸통 경계 가격이 같은 경우도 engulfing으로 인정한다.
- 따라서 경계 비교에는 >=, <=를 포함한다.

---

## Timeframe Rule

Order Block은 특정 timeframe에 고정하지 않는다.

사용자가 현재 차트에서 선택한 timeframe의 OHLC 캔들 데이터를 기준으로
동일한 Order Block Detection 규칙을 적용한다.

예:
- 30분 차트 → 30분 캔들 기준 Order Block
- 1시간 차트 → 1시간 캔들 기준 Order Block
- 4시간 차트 → 4시간 캔들 기준 Order Block
- 12시간 차트 → 12시간 캔들 기준 Order Block
- 1일 차트 → 일봉 캔들 기준 Order Block
- 1주 차트 → 주봉 캔들 기준 Order Block

Golden Cross처럼 특정 timeframe에 고정하지 않는다.

---

## 2. 일반 Bullish Order Block

구조:

음봉 → 양봉

조건:

- 이전 캔들 = 음봉
- 현재 캔들 = 양봉
- 현재 양봉 몸통이 이전 음봉 몸통을 100% engulfing

조건식:

previousClose < previousOpen
AND
currentClose > currentOpen

AND

currentBodyHigh >= previousBodyHigh
AND
currentBodyLow <= previousBodyLow

OB 영역:

- engulfing 당한 이전 음봉의 몸통
- OBHigh = max(previous.open, previous.close)
- OBLow = min(previous.open, previous.close)
- OBMid = (OBHigh + OBLow) / 2

---

## 3. 일반 Bearish Order Block

구조:

양봉 → 음봉

조건:

- 이전 캔들 = 양봉
- 현재 캔들 = 음봉
- 현재 음봉 몸통이 이전 양봉 몸통을 100% engulfing

조건식:

previousClose > previousOpen
AND
currentClose < currentOpen

AND

currentBodyHigh >= previousBodyHigh
AND
currentBodyLow <= previousBodyLow

OB 영역:

- engulfing 당한 이전 양봉의 몸통
- OBHigh = max(previous.open, previous.close)
- OBLow = min(previous.open, previous.close)
- OBMid = (OBHigh + OBLow) / 2

---

## 4. 몸통 계산

BodyHigh = max(Open, Close)

BodyLow = min(Open, Close)

BodySize = abs(Close - Open)

---

## 5. 작도 규칙

오더블럭은 무조건 몸통만 작도한다.

- 꼬리는 포함하지 않는다.
- Bullish OB = 이전 음봉의 몸통
- Bearish OB = 이전 양봉의 몸통

OBHigh = previousBodyHigh
OBLow = previousBodyLow
OBMid = (OBHigh + OBLow) / 2

---

## 6. 몸통 크기 2배 규칙

BodyRatio = currentBodySize / previousBodySize

BodyRatio >= 2는 Order Block Detection의 필수 조건이 아니다.

2배 이상이면 더 강한/높은 품질의 OB로 평가할 수 있다.

BodyRatio < 2라도 다른 필수 Detection 조건을 만족하면 유효한 OB가 될 수 있다.

즉 BodyRatio는 Quality 평가 요소다.

---

## 7. Detection과 Quality 분리

오더블럭 성립 여부와 품질 평가는 분리한다.

Detection 필수 조건:

- 반대 방향 캔들
- 몸통 100% engulfing
- 같은 가격 포함
- 몸통 기준 판정/작도

Quality 평가 요소:

- 몸통 크기
- 유동성 구간
- FVG
- 추세선
- 채널
- 주요 고점
- 주요 저점
- 이전 반응 구간

Quality 요소를 Detection 필수 조건으로 임의 변경하지 마.

규칙 문서에 없는 조건은 임의로 추가하지 마.

---

## 8. 분할 진입

총 진입 비중 = 100%

- 첫 경계 터치 = 25%
- OB 중앙 터치 = 추가 25%
- 반대쪽 몸통 끝 경계 터치 = 추가 50%

Bullish OB:
위쪽에서 아래쪽으로 진입.

Bearish OB:
아래쪽에서 위쪽으로 진입.

---

## 9. 손절

꼬리는 오직 손절 판단에만 사용한다.

### Bullish OB

기준 캔들의 최저 꼬리가 깨지면 손절한다.

### Bearish OB

기준 캔들의 최고 꼬리가 깨지면 손절한다.

---

## 10. 무효화

Bullish OB:
기준 캔들의 최저 꼬리를 하향 이탈하면 무효.

Bearish OB:
기준 캔들의 최고 꼬리를 상향 돌파하면 무효.

무효화된 오더블럭은 다시 사용하지 않는다.

---

## 11. 유지 규칙

가격이 OB에 한 번 들어왔다가 반등해도 해당 OB는 계속 유효하다.

여러 번 터치했다는 이유만으로도 폐기하지 않는다.

터치 횟수 자체는 OB 폐기 조건이 아니다.

기존 무효화 조건이 발생하지 않는 한 유지한다.

---

## 12. 새로운 OB 생성 시 교체

새로운 유효 Order Block이 생성되면 기존 Order Block은 즉시 폐기한다.

같은 방향/반대 방향과 관계없이
가장 최근에 생성된 유효 Order Block을 사용한다.

예:

Bullish OB 활성
→ 새로운 Bearish OB 생성
→ 기존 Bullish OB 폐기
→ Bearish OB 활성

---

## 13. 익절

Bullish OB:
이전 주요 고점을 돌파하면 진입 물량의 50%를 익절한다.

Bearish OB:
이전 주요 저점을 이탈하면 진입 물량의 50%를 익절한다.

남은 물량은 다음 주요 유동성 구간에서 관리한다.

---

## 14. 이중장악형 Order Block

이중장악형은 연속된 3개 캔들에서 engulfing이 두 번 연속 발생하는 구조다.

Candle 1
→ Candle 2가 Candle 1 몸통을 100% engulfing
→ Candle 3가 Candle 2 몸통을 100% engulfing

중요:

실제 이중장악형 OB 영역은 Candle 2의 몸통이다.

Candle 1이나 Candle 3의 몸통을 OB 영역으로 사용하지 않는다.

꼬리는 OB 영역에 포함하지 않는다.

---

## 15. 상승형 이중장악

방향:

음봉 → 양봉 → 음봉

조건:

- Candle 1 = 음봉
- Candle 2 = 양봉
- Candle 2 몸통이 Candle 1 몸통을 100% engulfing
- Candle 3 = 음봉
- Candle 3 몸통이 Candle 2 몸통을 100% engulfing

OB 영역:

Candle 2인 양봉의 몸통

DoubleOBHigh = max(Candle2.open, Candle2.close)
DoubleOBLow = min(Candle2.open, Candle2.close)
DoubleOBMid = (DoubleOBHigh + DoubleOBLow) / 2

---

## 16. 하락형 이중장악

방향:

양봉 → 음봉 → 양봉

조건:

- Candle 1 = 양봉
- Candle 2 = 음봉
- Candle 2 몸통이 Candle 1 몸통을 100% engulfing
- Candle 3 = 양봉
- Candle 3 몸통이 Candle 2 몸통을 100% engulfing

OB 영역:

Candle 2인 음봉의 몸통

DoubleOBHigh = max(Candle2.open, Candle2.close)
DoubleOBLow = min(Candle2.open, Candle2.close)
DoubleOBMid = (DoubleOBHigh + DoubleOBLow) / 2

---

## 17. 이중장악형 공통 규칙

- 반드시 연속된 3개 캔들을 사용한다.
- 방향은 서로 번갈아야 한다.
- Candle 2 → Candle 1 몸통 100% engulfing
- Candle 3 → Candle 2 몸통 100% engulfing
- 같은 가격 포함
- Open/Close만 engulfing 판정에 사용
- High/Low는 engulfing 판정에 사용하지 않음
- 실제 OB 영역 = Candle 2 몸통
- 기존 분할 진입 규칙 적용
- 기존 유지/교체 규칙 적용
- 기존 손절/무효화 규칙 적용

---

## 18. 일반 OB와 이중장악형 OB 우선순위

일반 Order Block과 이중장악형 Order Block이
같은 구간에서 동시에 성립하면
이중장악형 Order Block을 우선한다.

같은 구조를 일반 OB와 이중장악형 OB로
중복 표시하지 않는다.

---

## 19. 이중장악형 손절/무효화 기준

이중장악형 OB 영역은 계속 Candle 2의 몸통만 사용한다.

꼬리는 OB 영역에 포함하지 않는다.

꼬리는 손절/무효화 기준으로만 사용한다.

몸통 engulfing 규칙은 기존 문서 그대로 유지한다.

### 상승형 이중장악

Candle 1, Candle 2, Candle 3의
Low 중 가장 낮은 값을 손절/무효화 기준으로 사용한다.

StopLoss = min(Candle1.low, Candle2.low, Candle3.low)

### 하락형 이중장악

Candle 1, Candle 2, Candle 3의
High 중 가장 높은 값을 손절/무효화 기준으로 사용한다.

StopLoss = max(Candle1.high, Candle2.high, Candle3.high)
