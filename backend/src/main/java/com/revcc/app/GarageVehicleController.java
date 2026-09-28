package com.revcc.app;

import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.net.URI;
import java.util.List;

@RestController
public class GarageVehicleController {
    private final GarageVehicleService vehicles;
    private final SharedSessionService sessions;

    public GarageVehicleController(GarageVehicleService vehicles, SharedSessionService sessions) {
        this.vehicles = vehicles;
        this.sessions = sessions;
    }

    @PostMapping("/api/garage/vehicles")
    public ResponseEntity<GarageVehicleResponse> create(
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String token,
            @Valid @RequestBody GarageVehicleRequest request) {
        GarageVehicleResponse vehicle = vehicles.create(sessions.require(token).id(), request);
        return ResponseEntity.created(URI.create("/api/vehicles/" + vehicle.id())).body(vehicle);
    }

    @GetMapping("/api/garage/vehicles")
    public List<GarageVehicleResponse> mine(
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String token) {
        return vehicles.mine(sessions.require(token).id());
    }

    @GetMapping("/api/vehicles/{vehicleId}")
    public GarageVehicleResponse profile(@PathVariable Integer vehicleId) {
        return vehicles.profile(vehicleId);
    }

    @PutMapping("/api/garage/vehicles/{vehicleId}")
    public GarageVehicleResponse update(@PathVariable Integer vehicleId,
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String token,
            @Valid @RequestBody GarageVehicleRequest request) {
        return vehicles.update(vehicleId, sessions.require(token).id(), request);
    }

    @DeleteMapping("/api/garage/vehicles/{vehicleId}")
    public ResponseEntity<Void> delete(@PathVariable Integer vehicleId,
            @CookieValue(name = SharedSessionService.COOKIE, required = false) String token) {
        vehicles.delete(vehicleId, sessions.require(token).id());
        return ResponseEntity.noContent().build();
    }
}
