# Triibholz (THPLAY) — static water polo playbook served by nginx.
# The whole app is client-side (HTML/CSS/JS + localStorage), so a tiny
# static image is all we need.
FROM nginx:1.27-alpine

# our server config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# app files
COPY index.html /usr/share/nginx/html/index.html
COPY manifest.webmanifest /usr/share/nginx/html/manifest.webmanifest
COPY sw.js /usr/share/nginx/html/sw.js
COPY css/   /usr/share/nginx/html/css/
COPY js/    /usr/share/nginx/html/js/
COPY data/  /usr/share/nginx/html/data/
COPY icons/ /usr/share/nginx/html/icons/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1/index.html >/dev/null 2>&1 || exit 1
