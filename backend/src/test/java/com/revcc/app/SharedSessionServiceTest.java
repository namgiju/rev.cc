package com.revcc.app;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.*;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class SharedSessionServiceTest {
    @Test void legacySessionsSurviveUntilPasswordOrMemberChange() {
        StringRedisTemplate redis=mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String,String> values=mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        UserRepository users=mock(UserRepository.class);
        User user=new User("legacy","hash"); when(users.findById(1L)).thenReturn(Optional.of(user));
        String token="a".repeat(43), key="revcc:session:"+token;
        when(values.get(key)).thenReturn("{\"id\":1,\"username\":\"legacy\",\"role\":\"USER\"}");
        SharedSessionService service=new SharedSessionService(redis,new ObjectMapper(),false,users);
        assertEquals(1L,service.require(token).id());
        user.invalidateSessions();
        assertThrows(ResponseStatusException.class,()->service.require(token));
        verify(redis).delete(key);
    }
    @Test void blockedAccountCannotUseSessionEvenIfVersionMatches() {
        StringRedisTemplate redis=mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked") ValueOperations<String,String> values=mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        UserRepository users=mock(UserRepository.class);
        User user=new User("member","hash");user.manage(null,null,"DISABLED","USER",null);
        when(users.findById(1L)).thenReturn(Optional.of(user));
        String token="b".repeat(43);
        when(values.get("revcc:session:"+token)).thenReturn("{\"id\":1,\"username\":\"member\",\"role\":\"USER\",\"version\":1}");
        assertThrows(ResponseStatusException.class,()->new SharedSessionService(redis,new ObjectMapper(),false,users).require(token));
    }
}
