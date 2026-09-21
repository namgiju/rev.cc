package com.revcc.app;

import java.time.Instant;

/** Entity를 직접 직렬화하지 않아 비밀번호와 지연 로딩 관계가 노출되지 않는다. */
public record GarageVehicleResponse(
    Integer id, Long userId, String manufacturer, String model, Integer modelYear,
    String trim, String transmission, String color, String nickname, String description,
    Instant createdAt, Instant updatedAt, String username,
    String licensePlate, boolean verified, String verificationStatus, Instant verifiedAt
) {
    public static GarageVehicleResponse from(Vehicle vehicle) {
        return new GarageVehicleResponse(vehicle.getId(), vehicle.getUser().getId(),
            vehicle.getManufacturer(), vehicle.getModel(), vehicle.getModelYear(),
            vehicle.getTrim(), vehicle.getTransmission(), vehicle.getColor(), vehicle.getNickname(),
            vehicle.getDescription(), vehicle.getCreatedAt(), vehicle.getUpdatedAt(), vehicle.getUser().getUsername(),
            vehicle.getLicensePlate(), vehicle.isVerified(), vehicle.getVerificationStatus(), vehicle.getVerifiedAt());
    }
}
