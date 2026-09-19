# Triibholz analysis backend (Phase 1 MVP)
FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
# the pure engine is shared verbatim with the browser app
COPY js/ ./js/
COPY server/ ./server/
# the legal documents: without them /api/legal lists nothing and every acceptance is refused as
# "document-not-published" — which is how the first image shipped, unnoticed, because the tests
# run from the repository, where the folder is always there
COPY legal/ ./legal/
WORKDIR /app/server
ENV PORT=4200 DATA_DIR=/data
EXPOSE 4200
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:4200/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "index.js"]
