package com.revcc.app;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;

/**
 * JSON 본문 크기 상한. Spring은 JSON 요청 본문 크기를 제한하는 설정이 없어(form 전용 설정만 있음)
 * 대용량 본문이 Jackson 역직렬화로 통째로 메모리에 올라가는 것을 여기서 먼저 막는다.
 * Content-Length가 있으면 본문을 읽기 전에 413으로 거부하고, 길이를 모르는(chunked) 요청은
 * 읽는 도중 상한을 넘으면 IOException으로 중단시킨다.
 * 차량 인증서류 업로드(base64 최대 4.2MB)만 별도의 큰 상한을 쓴다.
 */
public class BodySizeLimitFilter implements Filter {
    static final Pattern UPLOAD_PATH = Pattern.compile("^/api/garage/vehicles/[^/]+/verification$");
    private final long maxBytes;
    private final long uploadMaxBytes;

    public BodySizeLimitFilter(long maxBytes, long uploadMaxBytes) {
        this.maxBytes = maxBytes;
        this.uploadMaxBytes = uploadMaxBytes;
    }

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain) throws IOException, ServletException {
        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;
        long limit = UPLOAD_PATH.matcher(request.getRequestURI()).matches() ? uploadMaxBytes : maxBytes;
        long length = request.getContentLengthLong();
        if (length > limit) {
            response.setStatus(413);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"message\":\"요청 본문이 너무 큽니다.\"}");
            return;
        }
        chain.doFilter(length < 0 ? new LimitedRequest(request, limit) : request, res);
    }

    static final class TooLarge extends IOException {
        TooLarge() { super("Request body exceeds limit"); }
    }

    private static final class LimitedRequest extends HttpServletRequestWrapper {
        private final long limit;
        private ServletInputStream stream;

        LimitedRequest(HttpServletRequest request, long limit) {
            super(request);
            this.limit = limit;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (stream == null) stream = new LimitedStream(super.getInputStream(), limit);
            return stream;
        }

        @Override
        public BufferedReader getReader() throws IOException {
            String encoding = getCharacterEncoding();
            Charset charset = encoding == null ? StandardCharsets.UTF_8 : Charset.forName(encoding);
            return new BufferedReader(new InputStreamReader(getInputStream(), charset));
        }
    }

    private static final class LimitedStream extends ServletInputStream {
        private final ServletInputStream in;
        private final long limit;
        private long read;

        LimitedStream(ServletInputStream in, long limit) {
            this.in = in;
            this.limit = limit;
        }

        @Override
        public int read() throws IOException {
            int b = in.read();
            if (b >= 0) count(1);
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int n = in.read(buffer, offset, length);
            if (n > 0) count(n);
            return n;
        }

        private void count(int n) throws TooLarge {
            read += n;
            if (read > limit) throw new TooLarge();
        }

        @Override public boolean isFinished() { return in.isFinished(); }
        @Override public boolean isReady() { return in.isReady(); }
        @Override public void setReadListener(ReadListener listener) { in.setReadListener(listener); }
    }
}
