package com.revcc.app;
import org.junit.jupiter.api.*;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.dao.DataIntegrityViolationException;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class UsernameAvailabilityTest {
    UserRepository users=mock(UserRepository.class);
    MockMvc mvc=MockMvcBuilders.standaloneSetup(new AuthController(users,mock(SharedSessionService.class),mock(KakaoOAuthService.class))).build();
    @Test void checksExactUsernameAndDoesNotCache() throws Exception {
        when(users.existsByUsername("Taken")).thenReturn(true);
        mvc.perform(get("/api/auth/check-username").param("username","Taken")).andExpect(status().isOk()).andExpect(jsonPath("$.available").value(false));
        mvc.perform(get("/api/auth/check-username").param("username","taken")).andExpect(status().isOk()).andExpect(jsonPath("$.available").value(true)).andExpect(header().string("Cache-Control","no-store"));
        verify(users).existsByUsername("Taken"); verify(users).existsByUsername("taken");
    }
    @Test void rejectsMissingBlankAndTooLongUsernameBeforeDbAccess() throws Exception {
        mvc.perform(get("/api/auth/check-username")).andExpect(status().isBadRequest());
        for(String value:new String[]{"","   ","a".repeat(101)})
            mvc.perform(get("/api/auth/check-username").param("username",value)).andExpect(status().isBadRequest());
        verifyNoInteractions(users);
    }
    @Test void preservesExistingUnicodeAndPunctuationPolicy() throws Exception {
        mvc.perform(get("/api/auth/check-username").param("username","한글_name-1")).andExpect(status().isOk());
        verify(users).existsByUsername("한글_name-1");
    }
    @Test void signupStillRejectsExistingUsername() throws Exception {
        when(users.existsByUsername("taken")).thenReturn(true);
        mvc.perform(post("/api/auth/signup").contentType("application/json").content("{\"username\":\"taken\",\"password\":\"test\"}")).andExpect(status().isConflict());
        verify(users,never()).saveAndFlush(any());
    }
    @Test void uniqueConstraintRaceRemainsConflict() throws Exception {
        when(users.saveAndFlush(any())).thenThrow(new DataIntegrityViolationException("unique constraint"));
        mvc.perform(post("/api/auth/signup").contentType("application/json").content("{\"username\":\"race\",\"password\":\"test\"}")).andExpect(status().isConflict());
    }
}
