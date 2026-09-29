package com.revcc.app;

import jakarta.mail.AuthenticationFailedException;
import jakarta.mail.MessagingException;
import javax.net.ssl.SSLException;
import java.net.*;
import java.util.*;
import java.util.regex.Pattern;
import org.springframework.mail.*;

/** Only fixed categories, class identifiers and SMTP numeric status are safe to log.
 * Never return exception messages, addresses, failed messages, credentials or stack traces. */
final class SafeMailFailure {
    private SafeMailFailure() {}
    private static final Pattern STATUS = Pattern.compile("(?m)^([45][0-9]{2})(?:[ -]([245]\\.[0-9]{1,3}\\.[0-9]{1,3}))?(?:[ -]|$)");
    record Diagnostic(String category, String exceptionTypes, String smtpStatus) {}

    static Diagnostic inspect(Throwable failure) {
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        ArrayDeque<Throwable> pending = new ArrayDeque<>(); pending.add(failure);
        Set<String> types = new LinkedHashSet<>();
        String category = "UNEXPECTED_MAIL_FAILURE", status = "unavailable";
        int priority = 0;
        while (!pending.isEmpty() && seen.size() < 32) {
            Throwable e = pending.removeFirst();
            if (!seen.add(e)) continue;
            String type = e.getClass().getSimpleName();
            String safeType = type.replaceAll("[^A-Za-z0-9_$]", "");
            types.add(safeType.substring(0, Math.min(80, safeType.length())));
            // Read only to extract a strictly bounded protocol status; never log the source text.
            String message = e.getMessage() == null ? "" : e.getMessage();
            var match = STATUS.matcher(message);
            if (match.find()) status = match.group(1) + (match.group(2) == null ? "" : "/" + match.group(2));
            String candidate = "UNEXPECTED_MAIL_FAILURE"; int rank = 0;
            if (e instanceof MailException) { candidate="MAIL_FAILURE"; rank=1; }
            if (e instanceof MailSendException) { candidate="SMTP_SEND_FAILED"; rank=2; }
            if (e instanceof IllegalArgumentException || e instanceof MailParseException || e instanceof MailPreparationException) { candidate="MESSAGE_CONFIGURATION_INVALID"; rank=3; }
            if (e instanceof MailAuthenticationException || e instanceof AuthenticationFailedException) { candidate="SMTP_AUTHENTICATION_FAILED"; rank=4; }
            if (type.equals("SMTPAddressFailedException")) { candidate="RECIPIENT_REJECTED"; rank=5; }
            if (type.equals("SMTPSenderFailedException")) { candidate="SENDER_REJECTED"; rank=5; }
            if (e instanceof ConnectException || type.equals("MailConnectException")) { candidate="SMTP_CONNECTION_FAILED"; rank=6; }
            if (e instanceof SocketTimeoutException) { candidate="SMTP_TIMEOUT"; rank=7; }
            if (e instanceof UnknownHostException) { candidate="SMTP_DNS_FAILED"; rank=8; }
            if (e instanceof SSLException || (e instanceof MessagingException &&
                    (message.toUpperCase(Locale.ROOT).contains("STARTTLS") || message.contains("Could not convert socket to TLS")))) {
                candidate="SMTP_TLS_FAILED"; rank=9;
            }
            if (rank > priority) { category=candidate; priority=rank; }
            if (e.getCause()!=null) pending.add(e.getCause());
            if (e instanceof MessagingException mail && mail.getNextException()!=null) pending.add(mail.getNextException());
            if (e instanceof MailSendException mail) {
                for (Exception nested : mail.getMessageExceptions()) if (nested!=null) pending.add(nested);
            }
        }
        return new Diagnostic(category, String.join(",",types),status);
    }
}
