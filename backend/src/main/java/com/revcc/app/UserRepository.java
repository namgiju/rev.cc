package com.revcc.app;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

/**
 * users 테이블에 접근하기 위한 JPA Repository.
 * 기본적인 저장, 조회, 삭제 기능은 JpaRepository가 자동으로 제공한다.
 */
public interface UserRepository extends JpaRepository<User, Long>, org.springframework.data.jpa.repository.JpaSpecificationExecutor<User> {

    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select u from User u where u.username = :username")
    Optional<User> lockByUsername(@org.springframework.data.repository.query.Param("username") String username);
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select u from User u where u.kakaoId = :kakaoId")
    Optional<User> lockByKakaoId(@org.springframework.data.repository.query.Param("kakaoId") Long kakaoId);
    Optional<User> findByEmail(String email);
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select u from User u where u.id = :id")
    Optional<User> lockById(@org.springframework.data.repository.query.Param("id") Long id);

    /**
     * 관리자 행 전체를 id 순서로 잠근다(SELECT ... FOR UPDATE). 관리자 권한·상태 변경은 모두 이 잠금을 먼저 잡아
     * 두 관리자가 동시에 서로를(또는 자신을) 강등해 관리자가 0명이 되는 경쟁을 직렬화한다.
     * 항상 같은 순서로 잠그므로 교착 상태가 생기지 않는다.
     */
    @org.springframework.data.jpa.repository.Lock(jakarta.persistence.LockModeType.PESSIMISTIC_WRITE)
    @org.springframework.data.jpa.repository.Query("select u from User u where u.role = 'ADMIN' order by u.id")
    java.util.List<User> lockAdmins();

    /** 잠금을 잡은 뒤 DB의 최신 상태로 센다. 조건은 User.isEffectiveAdmin()과 같다(ADMIN이고 정지·비활성화·탈퇴가 아님). */
    @org.springframework.data.jpa.repository.Query("""
        select count(u) from User u where u.role = 'ADMIN' and u.id <> :excluded
        and (u.accountStatus is null or u.accountStatus = 'ACTIVE'
             or (u.accountStatus = 'SUSPENDED' and u.suspendedUntil is not null and u.suspendedUntil <= :now))""")
    long countEffectiveAdminsExcept(@org.springframework.data.repository.query.Param("excluded") Long excluded,
        @org.springframework.data.repository.query.Param("now") java.time.Instant now);

    @org.springframework.data.jpa.repository.Query("""
        select case when count(u) > 0 then true else false end from User u where u.role = 'ADMIN' and u.id = :id
        and (u.accountStatus is null or u.accountStatus = 'ACTIVE'
             or (u.accountStatus = 'SUSPENDED' and u.suspendedUntil is not null and u.suspendedUntil <= :now))""")
    boolean isEffectiveAdmin(@org.springframework.data.repository.query.Param("id") Long id,
        @org.springframework.data.repository.query.Param("now") java.time.Instant now);

    /** 통계용 회원 수. 탈퇴 계정(행은 남는다)은 세지 않는다. */
    long countByAccountStatusIsNullOrAccountStatusNot(String status);

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
