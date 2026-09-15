package com.revcc.app;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.List;

/** 차량도 DB 볼륨에 저장하여 서버 코드나 컨테이너가 재시작되어도 유지한다.
 * 단순 조회 카탈로그에는 JdbcTemplate을 사용하며 users JPA 테이블과 공존한다. */
@Repository
public class VehicleRepository {
    private final JdbcTemplate jdbc;

    public VehicleRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @PostConstruct
    public void initialize() {
        // 최초 실행에만 테이블과 예시 차량을 생성한다. 기존 수정 데이터는 덮어쓰지 않는다.
        jdbc.execute("""
            CREATE TABLE IF NOT EXISTS vehicles (
                id BIGINT PRIMARY KEY, brand VARCHAR(100) NOT NULL,
                model VARCHAR(100) NOT NULL, year INTEGER NOT NULL, power INTEGER NOT NULL
            )
            """);
        jdbc.update("""
            INSERT INTO vehicles(id, brand, model, year, power)
            VALUES (1, 'Hyundai', 'Avante N', 2024, 280), (2, 'BMW', '320i', 2018, 184)
            ON CONFLICT (id) DO NOTHING
            """);
    }

    public List<VehicleController.VehicleResponse> findAll() {
        // 정렬을 명시해 기존 GET /api/vehicles의 응답 순서를 보존한다.
        return jdbc.query("SELECT id, brand, model, year, power FROM vehicles ORDER BY id",
            (row, index) -> new VehicleController.VehicleResponse(row.getLong("id"),
                row.getString("brand"), row.getString("model"), row.getInt("year"), row.getInt("power")));
    }
}
