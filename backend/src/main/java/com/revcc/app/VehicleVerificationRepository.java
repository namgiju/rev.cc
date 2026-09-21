package com.revcc.app;

import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface VehicleVerificationRepository extends JpaRepository<VehicleVerification, Integer> {
    @EntityGraph(attributePaths = {"vehicle", "vehicle.user"})
    List<VehicleVerification> findAllByOrderByIdDesc();

    @Override
    @EntityGraph(attributePaths = {"vehicle", "vehicle.user"})
    Optional<VehicleVerification> findById(Integer id);

    Optional<VehicleVerification> findFirstByVehicleIdOrderByIdDesc(Integer vehicleId);
}
