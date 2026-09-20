FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/contract/package*.json ./packages/contract/
COPY backend/gateway/package*.json ./backend/gateway/
COPY web/package*.json ./web/
RUN npm ci --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/contract ./packages/contract
COPY backend/gateway ./backend/gateway
COPY web ./web
# Graphify wiki is in web/public/knowledge and lands in web/dist/knowledge at /knowledge
RUN npm run build -w @lumina/contract && npm run build -w @lumina/web && npm run build -w @lumina/gateway

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
COPY backend/gateway/evals-report.json /app/backend/gateway/evals-report.json
COPY backend/gateway/evals-report.json /app/evals-report.json
EXPOSE 8787
CMD ["npm", "start", "-w", "@lumina/gateway"]
