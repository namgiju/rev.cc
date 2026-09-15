package com.revcc.app;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

import java.util.List;

import org.junit.jupiter.api.Test;

class VehicleControllerTest {

  private final VehicleRepository repository = mock(VehicleRepository.class);
  private final VehicleController controller = new VehicleController(repository);

  @Test
  void vehiclesReturnsTheAvailableVehicles() {
    // DB 접근은 시스템 테스트에서 검증하고 여기서는 기존 응답 계약을 검증한다.
    when(repository.findAll()).thenReturn(List.of(
        new VehicleController.VehicleResponse(1L, "Hyundai", "Avante N", 2024, 280),
        new VehicleController.VehicleResponse(2L, "BMW", "320i", 2018, 184)));
    List<VehicleController.VehicleResponse> vehicles = controller.vehicles();
    verify(repository).findAll();

    assertEquals(2, vehicles.size());
    assertEquals(new VehicleController.VehicleResponse(1L, "Hyundai", "Avante N", 2024, 280), vehicles.get(0));
    assertEquals(new VehicleController.VehicleResponse(2L, "BMW", "320i", 2018, 184), vehicles.get(1));
  }

  @Test
  void vehicleResponseExposesVehicleDetails() {
    VehicleController.VehicleResponse response =
        new VehicleController.VehicleResponse(7L, "Toyota", "GR86", 2023, 234);

    assertEquals(7L, response.id());
    assertEquals("Toyota", response.brand());
    assertEquals("GR86", response.model());
    assertEquals(2023, response.year());
    assertEquals(234, response.power());
  }
}