package com.revcc.app;

import jakarta.mail.MessagingException;
import java.net.ConnectException;
import java.util.Map;
import javax.net.ssl.SSLHandshakeException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.mail.*;
import org.springframework.mail.javamail.JavaMailSender;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

@ExtendWith(OutputCaptureExtension.class)
class SafeMailFailureTest {
    @Test void logContainsOnlyClassificationAndProtocolCodes(CapturedOutput output) {
        JavaMailSender sender=mock(JavaMailSender.class);
        doThrow(new MailAuthenticationException("535-5.7.8 private@example.test APP_PASSWORD PRIVATE_SECRET 123456 RESET_TOKEN\r\nINJECTED_LOG"))
            .when(sender).send(any(SimpleMailMessage.class));
        new ResetMailService(sender,"private@example.test","http://localhost/password-reset").send("recipient@example.test","123456");
        String log=output.getOut();
        assertTrue(log.contains("category=SMTP_AUTHENTICATION_FAILED"));
        assertTrue(log.contains("exceptions=MailAuthenticationException"));
        assertTrue(log.contains("smtpStatus=535/5.7.8"));
        for(String secret:new String[]{"private@example.test","recipient@example.test","APP_PASSWORD","PRIVATE_SECRET","123456","RESET_TOKEN","INJECTED_LOG"}) assertFalse(log.contains(secret));
    }
    @Test void inspectsPerMessageFailuresWithoutPrintingFailedMessages() {
        var e=new MailSendException("unsafe",null,Map.of("private message",new MessagingException("unsafe",new ConnectException("private endpoint"))));
        assertEquals("SMTP_CONNECTION_FAILED",SafeMailFailure.inspect(e).category());
    }
    @Test void tlsNestedUnderAuthenticationIsIdentifiedAsTlsFailure() {
        var e=new MailAuthenticationException("unsafe",new MessagingException("unsafe",new SSLHandshakeException("private certificate data")));
        assertEquals("SMTP_TLS_FAILED",SafeMailFailure.inspect(e).category());
    }
    @Test void starttlsNegotiationFailureIsIdentifiedWithoutSslException() {
        assertEquals("SMTP_TLS_FAILED",SafeMailFailure.inspect(new MessagingException("STARTTLS is required but host does not support STARTTLS")).category());
    }
    @Test void unknownMessagesAndStackTracesAreNotReturned() {
        var d=SafeMailFailure.inspect(new MailSendException("private message and password"));
        assertEquals("SMTP_SEND_FAILED",d.category()); assertEquals("unavailable",d.smtpStatus());
        assertFalse(d.toString().contains("private"));
    }
}
