package com.revcc.app;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.List;

import org.junit.jupiter.api.Test;

class VehicleControllerTest {

  private final VehicleController controller = new VehicleController();

  @Test
  void vehiclesReturnsTheAvailableVehicles() {
    List<VehicleController.VehicleResponse> vehicles = controller.vehicles();

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