# Triibholz analysis backend (Phase 1 MVP)
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
# the pure engine is shared verbatim with the browser app
COPY js/ ./js/
COPY server/ ./server/
WORKDIR /app/server
ENV PORT=4200 DATA_DIR=/data
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:4200/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "index.js"]
