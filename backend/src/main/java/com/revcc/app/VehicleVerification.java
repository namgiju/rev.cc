package com.revcc.app;

import jakarta.persistence.*;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** 자동차등록증 인증 신청 한 건. 원본 이미지는 이 테이블에만 저장하고
 * community_images(게시글 공개 사진)와는 완전히 분리한다. */
@Entity
@Table(name = "vehicle_verifications")
public class VehicleVerification {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "vehicle_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private Vehicle vehicle;

    @Column(nullable = false, length = 20)
    private String status = "PENDING";

    @Column(name = "document_mime", nullable = false, length = 30)
    private String documentMime;

    // TODO: 승인 완료 후 일정 기간이 지나면 원본을 지우는 배치/스케줄러를 추후 추가한다.
    // @Lob을 붙이면 Hibernate 6이 PostgreSQL에서 OID(대용량 객체)로 매핑해 실제 bytea
    // 컬럼과 타입이 어긋난다. 순수 byte[]로 두어야 bytea로 정확히 매핑된다.
    @Column(name = "document_data", nullable = false, columnDefinition = "bytea")
    private byte[] documentData;

    @Column(name = "requested_at", nullable = false)
    private Instant requestedAt;

    @Column(name = "reviewed_at")
    private Instant reviewedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "reviewed_by")
    private User reviewedBy;

    protected VehicleVerification() {}

    public VehicleVerification(Vehicle vehicle, String documentMime, byte[] documentData) {
        this.vehicle = vehicle;
        this.documentMime = documentMime;
        this.documentData = documentData;
    }

    @PrePersist
    void created() { requestedAt = Instant.now().truncatedTo(ChronoUnit.MICROS); }

    public void approve(User admin) {
        status = "APPROVED";
        reviewedAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
        reviewedBy = admin;
    }

    public void reject(User admin) {
        status = "REJECTED";
        reviewedAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
        reviewedBy = admin;
    }

    public Integer getId() { return id; }
    public Vehicle getVehicle() { return vehicle; }
    public String getStatus() { return status; }
    public String getDocumentMime() { return documentMime; }
    public byte[] getDocumentData() { return documentData; }
    public Instant getRequestedAt() { return requestedAt; }
    public Instant getReviewedAt() { return reviewedAt; }
    public User getReviewedBy() { return reviewedBy; }
}
