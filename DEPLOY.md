# Deploying Triibholz (THPLAY)

The app is 100% static (HTML/CSS/JS + browser `localStorage`), so it can run
anywhere that serves files. Two supported paths:

## 1) Docker (recommended)

Build & run with Compose:
```bash
docker compose up -d --build      # builds the image and starts the container
# open http://localhost:8088
docker compose logs -f            # follow logs
docker compose down               # stop & remove
```

Or with plain Docker:
```bash
docker build -t triibholz-thplay:latest .
docker run -d --name triibholz -p 8088:80 triibholz-thplay:latest
```

The image is `nginx:1.27-alpine` serving the static files (gzip + sensible
cache headers, see `nginx.conf`). Change the published port by editing the
`ports:` line in `docker-compose.yml` (host:container, default `8088:80`).

### Deploy the image to a host
```bash
# tag for your registry (GHCR shown)
docker tag triibholz-thplay:latest ghcr.io/<you>/triibholz-thplay:latest
docker push ghcr.io/<you>/triibholz-thplay:latest
```
Then `docker run -p 80:80 ghcr.io/<you>/triibholz-thplay:latest` on the server
(put it behind a TLS proxy such as Caddy/Traefik/Cloudflare for HTTPS).

## 2) GitHub

This folder is already a git repo with an initial commit. To publish:

**With the GitHub CLI** (`brew install gh`, then `gh auth login`):
```bash
gh repo create triibholz-thplay --private --source . --remote origin --push
```

**Or with an existing empty GitHub repo:**
```bash
git remote add origin git@github.com:<you>/triibholz-thplay.git
git branch -M main
git push -u origin main
```

### Free static hosting (no server)
Because it's static, you can also host it at no cost:
- **GitHub Pages** — Settings → Pages → deploy from `main` / root.
- **Netlify / Cloudflare Pages / Vercel** — point at the repo, no build step,
  publish directory = repo root.

## Note on accounts & approvals
In this prototype, users / approvals / plays live in the browser's
`localStorage` (per-device). To make the **login-approval gate** and rosters
real and cross-device, add real Apple/Google OAuth + a small backend/DB. The
static hosting above is still the front-end; the backend is the next milestone.
