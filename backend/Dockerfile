# Java 23으로 빌드하고 단위 테스트 성공 시에만 실행 이미지를 만든다.
FROM maven:3.9.9-eclipse-temurin-23 AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -B verify

FROM eclipse-temurin:23-jdk
WORKDIR /app
# 헬스체크용 curl을 명시 설치한다(기본 JDK 이미지에는 없다).
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 revcc
COPY --from=build /app/target/backend-0.0.1-SNAPSHOT.jar app.jar
USER revcc
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
