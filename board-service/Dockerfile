# 잠금 파일로 의존성을 재현하고 기본 제공 비루트 node 사용자로 실행한다.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY test ./test
RUN npm test
USER node
EXPOSE 3001
CMD ["npm", "start"]
