package com.revcc.app;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.server.ResponseStatusException;
import java.time.Instant;
import java.util.List;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class GarageVehicleControllerTest {
    private final GarageVehicleService vehicles = mock(GarageVehicleService.class);
    private final SharedSessionService sessions = mock(SharedSessionService.class);
    private MockMvc mvc;
    private final String json = """
        {"manufacturer":"Hyundai","model":"Avante N","modelYear":2024,
         "trim":"N","transmission":"DCT","color":"Performance Blue","nickname":"my N",
         "description":"owner car","userId":999}
        """;
    private final GarageVehicleResponse response = new GarageVehicleResponse(15,7L,"Hyundai","Avante N",2024,
        "N","DCT","Performance Blue","my N","owner car",Instant.now(),Instant.now(),"owner");

    @BeforeEach void setup() {
        mvc = MockMvcBuilders.standaloneSetup(new GarageVehicleController(vehicles, sessions))
            .setControllerAdvice(new GarageExceptionHandler()).build();
        when(sessions.require(null)).thenThrow(new ResponseStatusException(HttpStatus.UNAUTHORIZED,"로그인이 필요합니다."));
        when(sessions.require("valid-token")).thenReturn(new SharedSessionService.SessionUser(7L,"owner"));
    }

    @Test void anonymousCannotCreateListUpdateOrDelete() throws Exception {
        mvc.perform(post("/api/garage/vehicles").contentType(MediaType.APPLICATION_JSON).content(json)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/garage/vehicles")).andExpect(status().isUnauthorized());
        mvc.perform(put("/api/garage/vehicles/15").contentType(MediaType.APPLICATION_JSON).content(json)).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/garage/vehicles/15")).andExpect(status().isUnauthorized());
        verifyNoInteractions(vehicles);
    }

    @Test void ignoresClientUserIdAndReturnsCreatedLocation() throws Exception {
        when(vehicles.create(eq(7L),any())).thenReturn(response);
        mvc.perform(post("/api/garage/vehicles").cookie(new Cookie(SharedSessionService.COOKIE,"valid-token"))
            .contentType(MediaType.APPLICATION_JSON).content(json))
            .andExpect(status().isCreated()).andExpect(header().string("Location","/api/vehicles/15"))
            .andExpect(jsonPath("$.userId").value(7)).andExpect(jsonPath("$.username").value("owner"))
            .andExpect(jsonPath("$.password").doesNotExist());
        verify(vehicles).create(eq(7L),any());
    }

    @Test void profileIsPublicAndListIsAuthenticated() throws Exception {
        when(vehicles.profile(15)).thenReturn(response);
        when(vehicles.mine(7L)).thenReturn(List.of(response));
        mvc.perform(get("/api/vehicles/15")).andExpect(status().isOk()).andExpect(jsonPath("$.modelYear").value(2024));
        mvc.perform(get("/api/garage/vehicles").cookie(new Cookie(SharedSessionService.COOKIE,"valid-token")))
            .andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(15));
    }

    @Test void validationRejectsMissingManufacturerAndOutOfRangeYear() throws Exception {
        mvc.perform(post("/api/garage/vehicles").cookie(new Cookie(SharedSessionService.COOKIE,"valid-token"))
            .contentType(MediaType.APPLICATION_JSON).content("{\"manufacturer\":\" \",\"model\":\"N\",\"modelYear\":1800}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.fields.manufacturer").exists())
            .andExpect(jsonPath("$.fields.modelYear").exists());
        verifyNoInteractions(vehicles);
    }
}
