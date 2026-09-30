# DB 마이그레이션 (Flyway)

PostgreSQL 스키마는 core(Spring)의 Flyway만 변경한다.

- 마이그레이션 파일: `backend/src/main/resources/db/migration/V<번호>__<설명>.sql`
- core가 기동할 때 적용되지 않은 버전을 순서대로 실행하고 `flyway_schema_history` 테이블에 기록한다.
- Hibernate는 `ddl-auto: validate`로 엔티티와 스키마가 맞는지 검사만 한다. 맞지 않으면 core가 기동하지 않는다.
- board-service는 스키마를 만들지 않는다. Compose에서 board는 core가 healthy가 된 뒤, 즉 마이그레이션이 끝난 뒤에 시작한다.

## 스키마를 바꿀 때

1. 다음 번호로 새 파일을 추가한다(예: `V3__add_listing_index.sql`). **이미 커밋된 파일은 수정하지 않는다.** Flyway가 체크섬 불일치로 기동을 거부한다.
2. JPA 엔티티가 쓰는 테이블을 바꿨다면 엔티티도 같이 맞춘다.
3. `mvn test`를 `REVCC_TEST_DB_PORT`/`REVCC_TEST_REDIS_PORT`와 함께 실행하면 빈 DB에 전체 마이그레이션을 적용한 뒤 validate와 통합테스트를 실행한다. CI도 같은 방식으로 실행한다.

## 기존 DB(baseline)

`V1__baseline.sql`은 Flyway 도입 직전(2026-09-30) 운영 DB(Neon)의 스키마를 그대로 옮긴 것이다.

- **빈 DB**: V1부터 전부 실행한다.
- **테이블이 이미 있고 `flyway_schema_history`가 없는 DB**: `baseline-on-migrate`로 V1을 실행하지 않고 "적용됨"으로만 기록한 뒤 V2부터 실행한다. 기존 테이블과 데이터는 건드리지 않는다.

주의: 이전 코드로 만든 로컬 DB는 운영 DB와 세부 형태가 조금 다를 수 있다(예: `owner_vehicles.id`가 SERIAL이 아니라 identity). 앱 동작과 validate에는 영향이 없다. 운영과 똑같이 맞추려면 로컬 볼륨을 새로 만들면 된다.
