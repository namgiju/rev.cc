package com.revcc.app;

import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;
import java.util.List;
import java.util.Optional;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class GarageVehicleServiceTest {
    private final GarageVehicleRepository vehicles = mock(GarageVehicleRepository.class);
    private final UserRepository users = mock(UserRepository.class);
    private final GarageVehicleService service = new GarageVehicleService(vehicles, users);
    private final GarageVehicleRequest request = new GarageVehicleRequest("Hyundai", "Avante N", 2024,
        "N", "DCT", "Performance Blue", "기주의 아반떼 N", "오너 차량", "123가4567");

    private User owner() {
        User user = mock(User.class);
        when(user.getId()).thenReturn(7L);
        when(user.getUsername()).thenReturn("owner");
        return user;
    }

    @Test void createsWithServerSelectedOwnerAndNormalizesOptionalValues() {
        User user = owner();
        when(users.findById(7L)).thenReturn(Optional.of(user));
        when(vehicles.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
        GarageVehicleResponse result = service.create(7L, request);
        assertEquals(7L, result.userId());
        assertEquals("owner", result.username());
        assertEquals("Performance Blue", result.color());
        Vehicle minimal = new Vehicle(owner(), new GarageVehicleRequest(" Hyundai ", " Avante N ", 2024,
            null, null, null, null, null, "123가4567"));
        assertEquals("Hyundai", minimal.getManufacturer());
        assertEquals("", minimal.getDescription());
    }

    @Test void listIsScopedToCurrentUser() {
        Vehicle vehicle = new Vehicle(owner(), request);
        when(vehicles.findByUserIdOrderByIdDesc(7L)).thenReturn(List.of(vehicle));
        assertEquals(1, service.mine(7L).size());
        verify(vehicles).findByUserIdOrderByIdDesc(7L);
    }

    @Test void rejectsOtherOwnersUpdateAndDelete() {
        Vehicle vehicle = new Vehicle(owner(), request);
        when(vehicles.findById(15)).thenReturn(Optional.of(vehicle));
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> service.update(15, 9L, request)).getStatusCode().value());
        assertEquals(403, assertThrows(ResponseStatusException.class, () -> service.delete(15, 9L)).getStatusCode().value());
        verify(vehicles, never()).saveAndFlush(any());
        verify(vehicles, never()).delete(any());
    }

    @Test void ownerCanUpdateAndDeleteAndMissingVehicleIs404() {
        Vehicle vehicle = new Vehicle(owner(), request);
        when(vehicles.findById(15)).thenReturn(Optional.of(vehicle));
        when(vehicles.saveAndFlush(vehicle)).thenReturn(vehicle);
        assertEquals(7L, service.update(15, 7L, request).userId());
        service.delete(15, 7L);
        verify(vehicles).delete(vehicle);
        assertEquals(404, assertThrows(ResponseStatusException.class, () -> service.profile(999)).getStatusCode().value());
    }

    @Test void timestampsUsePostgresPrecisionAndCreationTimeIsPreserved() {
        Vehicle vehicle = new Vehicle(owner(), request);
        vehicle.created();
        var createdAt = vehicle.getCreatedAt();
        assertEquals(createdAt, vehicle.getUpdatedAt());
        assertEquals(0, createdAt.getNano() % 1000);
        vehicle.updated();
        assertEquals(createdAt, vehicle.getCreatedAt());
        assertEquals(0, vehicle.getUpdatedAt().getNano() % 1000);
    }
}
