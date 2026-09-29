package com.revcc.app;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class UserSerializationTest {
    @Test void passwordNeverAppearsInUserOrMemberJsonButAuthenticationCanReadIt() throws Exception {
        ObjectMapper mapper=new ObjectMapper().findAndRegisterModules();
        String stored="sensitive-test-password-value";
        User user=new User("member",stored);
        String entity=mapper.writeValueAsString(user);
        String dto=mapper.writeValueAsString(AdminMemberController.Member.from(user));
        assertFalse(entity.contains(stored));assertFalse(entity.toLowerCase().contains("password"));
        assertFalse(dto.contains(stored));assertFalse(dto.toLowerCase().contains("password"));
        assertEquals(stored,user.getPassword());
    }
}
