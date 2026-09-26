# auto fomo order server — multi-stage build (Reborn1987)
# Build: TypeScript → dist/. Run: production dependencies only, as the unprivileged "node" user.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
# Listens on 0.0.0.0:8787 inside the Docker network only; Cloudflare Tunnel is the only way in.
ENV GATEWAY_HOST=0.0.0.0 GATEWAY_PORT=8787 DATA_DIR=/app/data GATEWAY_TRUST_PROXY=true
CMD ["node", "dist/index.js"]
