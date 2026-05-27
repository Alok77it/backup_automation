FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG DISABLE_WELCOME=false
ARG NEXT_PUBLIC_DISABLE_WELCOME=false
ENV DISABLE_WELCOME=$DISABLE_WELCOME
ENV NEXT_PUBLIC_DISABLE_WELCOME=$NEXT_PUBLIC_DISABLE_WELCOME
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ARG DISABLE_WELCOME=false
ARG NEXT_PUBLIC_DISABLE_WELCOME=false
ENV DISABLE_WELCOME=$DISABLE_WELCOME
ENV NEXT_PUBLIC_DISABLE_WELCOME=$NEXT_PUBLIC_DISABLE_WELCOME
RUN apk add --no-cache wget
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/login || exit 1
CMD ["node", "server.js"]
