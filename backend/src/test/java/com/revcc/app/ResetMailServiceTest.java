package com.revcc.app;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import static org.junit.jupiter.api.Assertions.*;

class ResetMailServiceTest {
    @Test void sendsThroughSmtpWithoutLoggingMessageContents() throws Exception {
        try (ServerSocket listener=new ServerSocket(0,1,InetAddress.getLoopbackAddress()); var executor=Executors.newSingleThreadExecutor()) {
            Future<String> received=executor.submit(() -> {
                try (Socket socket=listener.accept()) {
                    socket.setSoTimeout(5000);
                    var in=new BufferedReader(new InputStreamReader(socket.getInputStream(),StandardCharsets.UTF_8));
                    var out=new PrintWriter(new OutputStreamWriter(socket.getOutputStream(),StandardCharsets.UTF_8),true);
                    out.print("220 test SMTP\r\n");out.flush(); StringBuilder message=new StringBuilder(); boolean data=false;
                    for(String line;(line=in.readLine())!=null;) {
                        if(data && !line.equals(".")) {message.append(line).append("\r\n");continue;}
                        if(data) {data=false;out.print("250 accepted\r\n");}
                        else if(line.startsWith("DATA")) {data=true;out.print("354 send message\r\n");}
                        else if(line.startsWith("QUIT")) {out.print("221 bye\r\n");out.flush();break;}
                        else out.print("250 OK\r\n");
                        out.flush();
                    }
                    return message.toString();
                }
            });
            JavaMailSenderImpl sender=new JavaMailSenderImpl(); sender.setHost("127.0.0.1");sender.setPort(listener.getLocalPort());
            new ResetMailService(sender,"no-reply@example.test","https://example.test/password-reset").send("member@example.test","123456");
            String raw=received.get(10,TimeUnit.SECONDS);
            var mail=new jakarta.mail.internet.MimeMessage(jakarta.mail.Session.getInstance(new java.util.Properties()),new ByteArrayInputStream(raw.getBytes(StandardCharsets.UTF_8)));
            assertTrue(mail.getContent().toString().contains("123456"));
            assertTrue(mail.getContent().toString().contains("https://example.test/password-reset"));
            assertEquals("REV.CC 비밀번호 재설정 인증번호",mail.getSubject());
        }
    }
}
