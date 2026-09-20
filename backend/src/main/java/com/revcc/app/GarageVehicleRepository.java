package com.revcc.app;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

/** 기존 JDBC VehicleRepository는 공용 카탈로그용으로 유지한다. */
public interface GarageVehicleRepository extends JpaRepository<Vehicle, Integer> {
    @EntityGraph(attributePaths = "user")
    List<Vehicle> findByUserIdOrderByIdDesc(Long userId);

    @Override
    @EntityGraph(attributePaths = "user")
    Optional<Vehicle> findById(Integer id);
}
