package com.revcc.app;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/** 카카오 로그인: 인가 코드를 액세스 토큰으로 교환하고 사용자 정보를 조회한다. */
@Service
public class KakaoOAuthService {
    // 카카오가 응답하지 않을 때 로그인 요청 스레드가 무기한 묶이지 않도록 연결·요청 시간을 제한한다(NOW-4).
    static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(3);
    static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(5);
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(CONNECT_TIMEOUT).build();
    private final ObjectMapper mapper;
    private final String clientId;
    private final String clientSecret;
    private final String redirectUri;

    public KakaoOAuthService(ObjectMapper mapper,
            @Value("${app.kakao.client-id:}") String clientId,
            @Value("${app.kakao.client-secret:}") String clientSecret,
            @Value("${app.kakao.redirect-uri}") String redirectUri) {
        this.mapper = mapper;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.redirectUri = redirectUri;
    }

    public String authorizeUrl(String state) {
        // scope를 명시해야 카카오 동의 화면에 닉네임 제공이 뜬다. 콘솔의 동의항목에서도
        // "닉네임"이 켜져 있어야 실제 값이 내려온다(꺼져 있으면 이 값과 무관하게 비어 온다).
        // state는 로그인 CSRF/계정 혼동을 막는 1회용 토큰이다(KakaoStateService가 발급/검증).
        return "https://kauth.kakao.com/oauth/authorize?client_id=" + encode(clientId)
            + "&redirect_uri=" + encode(redirectUri) + "&response_type=code&scope=profile_nickname"
            + "&state=" + encode(state);
    }

    public record KakaoUser(long id, String nickname) {}

    public KakaoUser exchange(String code) throws Exception {
        String tokenBody = "grant_type=authorization_code"
            + "&client_id=" + encode(clientId)
            + "&redirect_uri=" + encode(redirectUri)
            + "&code=" + encode(code);
        if (!clientSecret.isBlank()) tokenBody += "&client_secret=" + encode(clientSecret);
        HttpRequest tokenRequest = HttpRequest.newBuilder(URI.create("https://kauth.kakao.com/oauth/token"))
            .timeout(REQUEST_TIMEOUT)
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(tokenBody)).build();
        HttpResponse<String> tokenResponse = http.send(tokenRequest, HttpResponse.BodyHandlers.ofString());
        if (tokenResponse.statusCode() != 200)
            throw oauthFailure("token", tokenResponse);
        String accessToken = mapper.readTree(tokenResponse.body()).get("access_token").asText();

        HttpRequest profileRequest = HttpRequest.newBuilder(URI.create("https://kapi.kakao.com/v2/user/me"))
            .timeout(REQUEST_TIMEOUT)
            .header("Authorization", "Bearer " + accessToken).GET().build();
        HttpResponse<String> profileResponse = http.send(profileRequest, HttpResponse.BodyHandlers.ofString());
        if (profileResponse.statusCode() != 200)
            throw oauthFailure("profile", profileResponse);
        JsonNode root = mapper.readTree(profileResponse.body());
        long id = root.get("id").asLong();
        String nickname = root.path("properties").path("nickname").asText(null);
        if (nickname == null || nickname.isBlank())
            nickname = root.path("kakao_account").path("profile").path("nickname").asText("카카오사용자");
        return new KakaoUser(id, nickname);
    }

    private static String encode(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8);
    }

    private OAuthFailure oauthFailure(String stage, HttpResponse<String> response) {
        String code = "unknown";
        try {
            String candidate = mapper.readTree(response.body()).path("error_code").asText("");
            if (candidate.matches("KOE[0-9]{3}")) code = candidate;
        } catch (Exception ignored) { }
        return new OAuthFailure(stage + " HTTP " + response.statusCode() + " " + code);
    }

    // 원문 응답에는 인증 정보가 포함될 수 있으므로 허용된 오류 코드만 기록한다.
    public static class OAuthFailure extends RuntimeException {
        OAuthFailure(String message) { super(message); }
    }
}
