package com.revcc.app;

import jakarta.persistence.*;
import java.util.ArrayList;
import java.util.List;

/**
 * REV.CC 회원 정보를 PostgreSQL에 저장하기 위한 Entity 클래스.
 * users 테이블과 연결된다.
 */
@Entity
@Table(name = "users")
public class User {

    // 회원의 고유 번호. PostgreSQL에서 자동으로 생성된다.
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // 로그인에 사용할 아이디.
    @Column(nullable = false, unique = true)
    private String username;

    // BCrypt 비밀번호 해시. 기존 평문 계정은 로그인 성공 시 해시로 전환한다.
    @Column(nullable = false)
    private String password;

    // 카카오로 가입한 회원의 카카오 고유 ID. 일반 회원가입 계정은 null이다.
    // 닉네임은 바뀔 수 있어 재로그인 시 이 값으로 같은 계정을 찾는다.
    @Column(unique = true)
    private Long kakaoId;

    // 권한: USER 또는 ADMIN. 기존 계정은 마이그레이션으로 전부 USER가 채워진다.
    @Column(nullable = false)
    private String role = "USER";

    // 한 회원이 여러 소유 차량을 가질 수 있다. 차량 API는 별도의 DTO로 응답한다.
    @OneToMany(mappedBy = "user", fetch = FetchType.LAZY)
    private List<Vehicle> vehicles = new ArrayList<>();

    // JPA에서 객체를 생성할 때 사용하는 기본 생성자.
    protected User() {
    }

    // 회원가입 시 사용하는 생성자.
    public User(String username, String password) {
        this.username = username;
        this.password = password;
    }

    // 카카오 로그인으로 신규 가입할 때 사용하는 생성자.
    public User(String username, String password, Long kakaoId) {
        this.username = username;
        this.password = password;
        this.kakaoId = kakaoId;
    }

    public Long getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public void upgradePassword(String hash) {
        this.password = hash;
    }

    // 카카오 닉네임이 이후에 채워지거나 바뀌면 다음 로그인 때 반영한다.
    public void updateUsername(String username) {
        this.username = username;
    }

    public String getPassword() {
        return password;
    }

    public Long getKakaoId() {
        return kakaoId;
    }

    public String getRole() {
        return role;
    }
}
