FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
COPY packages/contract/package*.json ./packages/contract/
COPY backend/agent/package*.json ./backend/agent/
RUN npm ci --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/contract ./packages/contract
COPY backend/agent ./backend/agent
RUN npm run build -w @lumina/contract && npm run build -w @lumina/agent

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 8000
CMD ["npm", "start", "-w", "@lumina/agent"]
