package com.revcc.app;

import jakarta.validation.constraints.*;

/** 소유자 필드는 받지 않는다. owner_id는 항상 Redis 세션의 회원으로 결정한다. */
public record GarageVehicleRequest(
    @NotBlank @Size(max = 100) String manufacturer,
    @NotBlank @Size(max = 100) String model,
    @NotNull @Min(1900) @Max(2100) Integer modelYear,
    @Size(max = 100) String trim,
    @Size(max = 50) String transmission,
    @Size(max = 100) String color,
    @Size(max = 100) String nickname,
    @Size(max = 1000) String description
) {}
