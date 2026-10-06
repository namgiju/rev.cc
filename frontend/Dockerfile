FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm ci
COPY . .
ARG REVCC_API_ORIGIN=http://proxy
ENV REVCC_API_ORIGIN=$REVCC_API_ORIGIN
RUN npm run build

FROM node:22-alpine
WORKDIR /app
# Server Components (lib/server-api.ts) read this at runtime, not build time.
ARG REVCC_API_ORIGIN=http://proxy
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 REVCC_API_ORIGIN=$REVCC_API_ORIGIN
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
