## Trading Rules

매매 규칙을 구현하거나 수정하기 전에
반드시 해당 규칙 문서를 먼저 읽고 그 내용을 기준으로 작업한다.

### Order Block

Order Block 관련 구현, 수정, 테스트를 하기 전에
반드시 아래 문서를 먼저 읽는다.

- `docs/trading-rules/order-block.md`

Order Block에 관한 판단은 위 문서를 source of truth로 사용한다.

규칙 문서에 명시되지 않은 조건을 임의로 추가하거나
기존 규칙을 임의로 변경하지 않는다.

규칙이 모호하거나 서로 충돌하는 경우
임의로 판단하지 말고 사용자에게 먼저 확인한다.
