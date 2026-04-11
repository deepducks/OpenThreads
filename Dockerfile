# ─── Build stage ─────────────────────────────────────────────────────────────
FROM oven/bun:1.2 AS builder

WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json bun.lockb* ./
COPY packages/core/package.json ./packages/core/
COPY packages/server/package.json ./packages/server/
COPY packages/storage/mongodb/package.json ./packages/storage/mongodb/
COPY packages/trust/package.json ./packages/trust/
COPY packages/channels/package.json ./packages/channels/
COPY packages/channels/discord/package.json ./packages/channels/discord/
COPY packages/channels/slack/package.json ./packages/channels/slack/
COPY packages/channels/telegram/package.json ./packages/channels/telegram/
COPY packages/channels/whatsapp/package.json ./packages/channels/whatsapp/

RUN bun install --frozen-lockfile

# Copy source
COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages

# Build the Next.js server
WORKDIR /app/packages/server
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# ─── Production stage ─────────────────────────────────────────────────────────
FROM oven/bun:1.2-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built artifacts
COPY --from=builder /app/packages/server/.next/standalone ./
COPY --from=builder /app/packages/server/.next/static ./packages/server/.next/static
COPY --from=builder /app/packages/server/public ./packages/server/public 2>/dev/null || true

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:3000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["bun", "packages/server/server.js"]
