package com.revcc.app;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * users 테이블에 접근하기 위한 JPA Repository.
 * 기본적인 저장, 조회, 삭제 기능은 JpaRepository가 자동으로 제공한다.
 */
public interface UserRepository extends JpaRepository<User, Long> {

    /**
     * 로그인 아이디(username)를 이용하여 회원을 조회한다.
     * 회원이 존재하지 않을 수도 있으므로 Optional로 반환한다.
     */
    Optional<User> findByUsername(String username);

    /**
     * 회원가입 시 동일한 username이 이미 존재하는지 검사한다.
     */
    boolean existsByUsername(String username);

    /**
     * 카카오 로그인 시 같은 카카오 계정으로 이미 가입했는지 조회한다.
     */
    Optional<User> findByKakaoId(Long kakaoId);
}
