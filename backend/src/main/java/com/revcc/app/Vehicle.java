package com.revcc.app;

import jakarta.persistence.*;
import org.hibernate.annotations.OnDelete;
import org.hibernate.annotations.OnDeleteAction;
import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** 소유 차량. 기존 HTML 차고의 owner_vehicles를 그대로 사용한다.
 * 공용 카탈로그 vehicles 및 그 조회 API와는 별개다. */
@Entity
@Table(name = "owner_vehicles")
public class Vehicle {
    // 기존 SERIAL 및 차량 기록 FK와 호환되는 INTEGER 식별자.
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Integer id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "owner_id", nullable = false)
    @OnDelete(action = OnDeleteAction.CASCADE)
    private User user;

    @Column(nullable = false, length = 100, columnDefinition = "varchar(100) default ''")
    private String manufacturer = "";
    @Column(nullable = false, length = 100)
    private String model;
    @Column(name = "year", nullable = false)
    private Integer modelYear;
    @Column(nullable = false, length = 100, columnDefinition = "varchar(100) default ''")
    private String trim = "";
    @Column(nullable = false, length = 50, columnDefinition = "varchar(50) default ''")
    private String transmission = "";
    @Column(nullable = false, length = 100, columnDefinition = "varchar(100) default ''")
    private String color = "";
    @Column(nullable = false, length = 100, columnDefinition = "varchar(100) default ''")
    private String nickname = "";
    @Column(name = "bio", nullable = false, length = 1000, columnDefinition = "varchar(1000) default ''")
    private String description = "";

    // 이미 HTML 차고에서 사용하는 컬럼만 보존한다. 이번 API에는 사진 기능을 추가하지 않는다.
    @Column(name = "image_id")
    private Integer legacyImageId;
    @Column(name = "created_at", nullable = false, updatable = false,
        columnDefinition = "timestamp with time zone default CURRENT_TIMESTAMP")
    private Instant createdAt;
    @Column(name = "updated_at", nullable = false,
        columnDefinition = "timestamp with time zone default CURRENT_TIMESTAMP")
    private Instant updatedAt;

    protected Vehicle() {}

    public Vehicle(User user, GarageVehicleRequest request) {
        this.user = user;
        update(request);
    }

    public void update(GarageVehicleRequest request) {
        manufacturer = request.manufacturer().trim();
        model = request.model().trim();
        modelYear = request.modelYear();
        trim = clean(request.trim());
        transmission = clean(request.transmission());
        color = clean(request.color());
        nickname = clean(request.nickname());
        description = clean(request.description());
    }

    private static String clean(String value) { return value == null ? "" : value.trim(); }
    @PrePersist
    void created() { createdAt = Instant.now().truncatedTo(ChronoUnit.MICROS); updatedAt = createdAt; }
    @PreUpdate
    void updated() { updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS); }

    public Integer getId() { return id; }
    public User getUser() { return user; }
    public String getManufacturer() { return manufacturer; }
    public String getModel() { return model; }
    public Integer getModelYear() { return modelYear; }
    public String getTrim() { return trim; }
    public String getTransmission() { return transmission; }
    public String getColor() { return color; }
    public String getNickname() { return nickname; }
    public String getDescription() { return description; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
}
