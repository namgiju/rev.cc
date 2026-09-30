package com.revcc.app;

import jakarta.servlet.ServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

class BodySizeLimitFilterTest {
    private final BodySizeLimitFilter filter = new BodySizeLimitFilter(64 * 1024, 5 * 1024 * 1024);

    private MockHttpServletRequest post(String uri, int bytes) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", uri);
        request.setContentType("application/json");
        request.setContent(new byte[bytes]);
        return request;
    }

    @Test void oversizedJsonIsRejectedBeforeReachingController() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(post("/api/auth/signup", 64 * 1024 + 1), response, chain);
        assertEquals(413, response.getStatus());
        assertNull(chain.getRequest());
    }

    @Test void normalJsonPasses() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(post("/api/auth/signup", 1024), response, chain);
        assertEquals(200, response.getStatus());
        assertNotNull(chain.getRequest());
    }

    @Test void verificationUploadUpToExistingLimitPasses() throws Exception {
        // VehicleVerificationController가 허용하는 최대 data 문자열(4,200,000자) + JSON 래퍼.
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(post("/api/garage/vehicles/7/verification", 4_200_000 + 64), response, chain);
        assertNotNull(chain.getRequest());
    }

    @Test void uploadLimitAppliesOnlyToVerificationPath() throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(post("/api/garage/vehicles/7", 1024 * 1024), response, new MockFilterChain());
        assertEquals(413, response.getStatus());
        MockHttpServletResponse upload = new MockHttpServletResponse();
        filter.doFilter(post("/api/garage/vehicles/7/verification", 5 * 1024 * 1024 + 1), upload, new MockFilterChain());
        assertEquals(413, upload.getStatus());
    }

    @Test void chunkedBodyWithoutLengthStopsReadingAtLimit() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/auth/signup") {
            @Override public long getContentLengthLong() { return -1; }
            @Override public int getContentLength() { return -1; }
        };
        request.setContent(new byte[64 * 1024 + 10]);
        AtomicReference<ServletRequest> seen = new AtomicReference<>();
        filter.doFilter(request, new MockHttpServletResponse(), (req, res) -> seen.set(req));
        assertThrows(BodySizeLimitFilter.TooLarge.class, () -> seen.get().getInputStream().readAllBytes());
    }
}
