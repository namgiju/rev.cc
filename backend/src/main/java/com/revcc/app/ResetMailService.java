package com.revcc.app;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class ResetMailService {
    private final JavaMailSender sender;
    private final String from;
    private final String url;
    public ResetMailService(JavaMailSender sender, @Value("${app.mail.from:}") String from,
            @Value("${app.mail.reset-url:http://localhost:8090/password-reset}") String url) {
        this.sender = sender; this.from = from; this.url = url;
    }
    @org.springframework.scheduling.annotation.Async("resetMailExecutor")
    public void send(String email, String code) {
        try {
            SimpleMailMessage mail = new SimpleMailMessage();
            mail.setFrom(from); mail.setTo(email); mail.setSubject("REV.CC 비밀번호 재설정 인증번호");
            mail.setText("인증번호: " + code + "\n5분 안에 입력해주세요.\n" + url +
                "\n직접 요청하지 않았다면 이 메일을 무시하세요.");
            sender.send(mail);
        } catch (RuntimeException failure) {
            SafeMailFailure.Diagnostic diagnostic = SafeMailFailure.inspect(failure);
            org.slf4j.LoggerFactory.getLogger(ResetMailService.class).warn(
                "Password reset email delivery failed: category={}, exceptions={}, smtpStatus={}",
                diagnostic.category(), diagnostic.exceptionTypes(), diagnostic.smtpStatus());
        }
    }
}
