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

/** 카카오 로그인: 인가 코드를 액세스 토큰으로 교환하고 사용자 정보를 조회한다. */
@Service
public class KakaoOAuthService {
    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper mapper;
    private final String clientId;
    private final String redirectUri;

    public KakaoOAuthService(ObjectMapper mapper,
            @Value("${app.kakao.client-id:}") String clientId,
            @Value("${app.kakao.redirect-uri}") String redirectUri) {
        this.mapper = mapper;
        this.clientId = clientId;
        this.redirectUri = redirectUri;
    }

    public String authorizeUrl() {
        return "https://kauth.kakao.com/oauth/authorize?client_id=" + encode(clientId)
            + "&redirect_uri=" + encode(redirectUri) + "&response_type=code";
    }

    public record KakaoUser(long id, String nickname) {}

    public KakaoUser exchange(String code) throws Exception {
        String tokenBody = "grant_type=authorization_code"
            + "&client_id=" + encode(clientId)
            + "&redirect_uri=" + encode(redirectUri)
            + "&code=" + encode(code);
        HttpRequest tokenRequest = HttpRequest.newBuilder(URI.create("https://kauth.kakao.com/oauth/token"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .POST(HttpRequest.BodyPublishers.ofString(tokenBody)).build();
        HttpResponse<String> tokenResponse = http.send(tokenRequest, HttpResponse.BodyHandlers.ofString());
        if (tokenResponse.statusCode() != 200)
            throw new IllegalStateException("카카오 토큰 발급 실패: " + tokenResponse.body());
        String accessToken = mapper.readTree(tokenResponse.body()).get("access_token").asText();

        HttpRequest profileRequest = HttpRequest.newBuilder(URI.create("https://kapi.kakao.com/v2/user/me"))
            .header("Authorization", "Bearer " + accessToken).GET().build();
        HttpResponse<String> profileResponse = http.send(profileRequest, HttpResponse.BodyHandlers.ofString());
        if (profileResponse.statusCode() != 200)
            throw new IllegalStateException("카카오 사용자 조회 실패: " + profileResponse.body());
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
}
