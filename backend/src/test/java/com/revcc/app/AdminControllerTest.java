package com.revcc.app;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;
import java.util.Optional;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** role 검증이 프론트엔드가 아니라 서버에서 이뤄지는지 확인한다. */
class AdminControllerTest {
    private final SharedSessionService sessions = mock(SharedSessionService.class);
    private final UserRepository users = mock(UserRepository.class);
    private final GarageVehicleRepository vehicles = mock(GarageVehicleRepository.class);
    private final VehicleVerificationRepository verifications = mock(VehicleVerificationRepository.class);
    private MockMvc mvc;
    private final User admin = new User("owner", "hash", 14L);

    @BeforeEach void setup() {
        mvc = MockMvcBuilders.standaloneSetup(new AdminController(sessions, users, vehicles, verifications)).build();
        when(sessions.require(null)).thenThrow(new ResponseStatusException(HttpStatus.UNAUTHORIZED, "로그인이 필요합니다."));
        when(sessions.require("user-token")).thenReturn(new SharedSessionService.SessionUser(1L, "member", "USER"));
        when(sessions.require("admin-token")).thenReturn(new SharedSessionService.SessionUser(14L, "owner", "ADMIN"));
        when(users.findById(14L)).thenReturn(Optional.of(admin));
        when(verifications.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
        when(vehicles.saveAndFlush(any())).thenAnswer(call -> call.getArgument(0));
    }

    private static User owner() {
        User user = mock(User.class);
        when(user.getId()).thenReturn(2L);
        when(user.getUsername()).thenReturn("driver");
        return user;
    }

    @Test void anonymousIsUnauthorized() throws Exception {
        mvc.perform(get("/api/admin/overview")).andExpect(status().isUnauthorized());
        verifyNoInteractions(users, vehicles);
    }

    @Test void regularUserIsForbidden() throws Exception {
        mvc.perform(get("/api/admin/overview").cookie(new Cookie(SharedSessionService.COOKIE, "user-token")))
            .andExpect(status().isForbidden());
        verifyNoInteractions(users, vehicles);
    }

    @Test void adminSeesRealCounts() throws Exception {
        when(users.count()).thenReturn(11L);
        when(vehicles.count()).thenReturn(3L);
        mvc.perform(get("/api/admin/overview").cookie(new Cookie(SharedSessionService.COOKIE, "admin-token")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.totalUsers").value(11))
            .andExpect(jsonPath("$.totalVehicles").value(3));
    }

    @Test void regularUserCannotListVehicleVerifications() throws Exception {
        mvc.perform(get("/api/admin/vehicle-verifications").cookie(new Cookie(SharedSessionService.COOKIE, "user-token")))
            .andExpect(status().isForbidden());
        verifyNoInteractions(verifications);
    }

    @Test void adminApprovesVerificationAndVehicle() throws Exception {
        User owner = owner();
        GarageVehicleRequest request = new GarageVehicleRequest("Hyundai", "Avante N", 2024, "N", "DCT", "Blue", "my N", "desc", "123가4567");
        Vehicle vehicle = new Vehicle(owner, request);
        VehicleVerification verification = new VehicleVerification(vehicle, "image/png", new byte[]{1, 2, 3});
        when(verifications.findById(5)).thenReturn(Optional.of(verification));

        mvc.perform(post("/api/admin/vehicle-verifications/5/approve").cookie(new Cookie(SharedSessionService.COOKIE, "admin-token")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("APPROVED"));
        verify(vehicles).saveAndFlush(vehicle);
        org.junit.jupiter.api.Assertions.assertTrue(vehicle.isVerified());
    }

    @Test void adminRejectsVerificationAndVehicle() throws Exception {
        User owner = owner();
        GarageVehicleRequest request = new GarageVehicleRequest("Hyundai", "Avante N", 2024, "N", "DCT", "Blue", "my N", "desc", "123가4567");
        Vehicle vehicle = new Vehicle(owner, request);
        vehicle.markVerificationPending();
        VehicleVerification verification = new VehicleVerification(vehicle, "image/png", new byte[]{1, 2, 3});
        when(verifications.findById(6)).thenReturn(Optional.of(verification));

        mvc.perform(post("/api/admin/vehicle-verifications/6/reject").cookie(new Cookie(SharedSessionService.COOKIE, "admin-token")))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.status").value("REJECTED"));
        org.junit.jupiter.api.Assertions.assertFalse(vehicle.isVerified());
        org.junit.jupiter.api.Assertions.assertEquals("REJECTED", vehicle.getVerificationStatus());
    }
}
