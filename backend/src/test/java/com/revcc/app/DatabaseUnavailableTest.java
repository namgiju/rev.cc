package com.revcc.app;

import com.zaxxer.hikari.HikariDataSource;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** DB가 응답하지 않을 때 요청이 무한 대기하지 않고 Hikari connection-timeout 뒤 503으로 끝나는지 확인한다. */
class DatabaseUnavailableTest {
    ServerSocket blackhole;
    final List<Socket> held = new CopyOnWriteArrayList<>();
    HikariDataSource pool;

    @BeforeEach void start() throws Exception {
        // 연결은 받아 주지만 PostgreSQL 프로토콜로 한 바이트도 응답하지 않는 서버(멈춘 DB·막힌 네트워크 흉내).
        blackhole = new ServerSocket(0);
        Thread acceptor = new Thread(() -> {
            try { while (!blackhole.isClosed()) held.add(blackhole.accept()); } catch (Exception ignored) {}
        });
        acceptor.setDaemon(true);
        acceptor.start();
        pool = new HikariDataSource();
        pool.setJdbcUrl("jdbc:postgresql://127.0.0.1:" + blackhole.getLocalPort() + "/revcc");
        pool.setUsername("revcc");
        pool.setPassword("unused");
        pool.setConnectionTimeout(1000);
        pool.setInitializationFailTimeout(-1);
    }

    @AfterEach void stop() throws Exception {
        pool.close();
        blackhole.close();
        for (Socket s : held) s.close();
    }

    @Test void unresponsiveDatabaseEndsIn503WithinTheConnectionTimeout() throws Exception {
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new VehicleController(new VehicleRepository(new JdbcTemplate(pool))))
            .setControllerAdvice(new DatabaseUnavailableHandler()).build();
        long started = System.nanoTime();
        mvc.perform(get("/api/vehicles"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(header().string("Retry-After", "5"))
            .andExpect(jsonPath("$.message").value("일시적으로 서비스를 이용할 수 없습니다. 잠시 후 다시 시도해주세요."));
        long elapsedMs = (System.nanoTime() - started) / 1_000_000;
        assertTrue(elapsedMs >= 900 && elapsedMs < 5000, "elapsed=" + elapsedMs + "ms");
    }

    @RestController static class TransactionalFailure {
        @GetMapping("/tx") String fail() { throw new CannotCreateTransactionException("Could not open JPA EntityManager"); }
    }

    @Test void transactionStartFailureIsAlso503WithoutInternalDetails() throws Exception {
        // @Transactional(JPA) 경로에서 풀 대기 시간이 끝나면 CannotCreateTransactionException이 난다.
        MockMvc mvc = MockMvcBuilders.standaloneSetup(new TransactionalFailure())
            .setControllerAdvice(new DatabaseUnavailableHandler()).build();
        String body = mvc.perform(get("/tx")).andExpect(status().isServiceUnavailable())
            .andReturn().getResponse().getContentAsString();
        assertFalse(body.contains("EntityManager"));
    }
}
