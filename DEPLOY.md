# Deploying الجامع (server)

The server image is slim (~400 MB). On first boot it downloads the two
databases (~4.5 GB) from the public Hugging Face dataset into a **persistent
volume mounted at `/data`**, then serves the app on port **80**. A friendly
progress page is shown on the port while it downloads, so health checks pass and
users see status instead of an error. Subsequent boots start instantly.

`GEMINI_API_KEY` is optional — it enables semantic search and the research chat;
everything else works without it.

## Docker Hub

Published by CI to `DOCKERHUB_USERNAME/hadith` (see below). Tags: `latest` and
each version (`v1.0.0`, …).

## Any Docker host

```sh
docker volume create jami-data
docker run -d --name jami \
  -p 8077:80 \
  -v jami-data:/data \
  -e GEMINI_API_KEY=YOUR_KEY \
  --restart unless-stopped \
  emadjumaah/hadith:latest
# open http://localhost:8077  (first boot shows a download progress page)
```

Or with Compose (repo `docker-compose.yml`):

```sh
GEMINI_API_KEY=YOUR_KEY docker compose up -d
```

## CapRover

1. **Create app** — e.g. `jami`. Enable **"Has Persistent Data"**.
2. **Persistent directory** — App → *App Configs* → add a persistent path:
   *Path in app* = `/data`, *Label* = `jami-data`. This is where the databases
   live so they survive redeploys (download happens once, ever).
3. **Env vars** — add `GEMINI_API_KEY` (optional). `PORT` defaults to 80.
4. **Container HTTP port** = `80`.
5. **Deploy the image** — App → *Deployment* → **"Deploy via ImageName"** →
   `DOCKERHUB_USERNAME/hadith:latest`. (Or use the `captain-definition` file.)
6. **First boot** — the app downloads ~4.5 GB; the progress page keeps the
   health check green. Give it a few minutes on the first deploy.
7. **Enable HTTPS** in CapRover once it's up.

**SSE note:** the research chat streams via Server-Sent Events. If streamed
answers appear only at the end, disable proxy buffering for the app — CapRover
→ app → *nginx config* — add `proxy_buffering off;` in the location block.

## Updating

Push a new version tag (`git tag v1.1.0 && git push origin v1.1.0`) — CI rebuilds
and pushes `latest` + `v1.1.0`. In CapRover, redeploy the app (or set it to
force-pull `latest`). The databases on the volume are untouched; only the app
code updates. To refresh the data itself, delete the DB files from the volume
and redeploy (they re-download), or bump `DATASET_URL`.

## CI setup (one time)

Add two repo secrets (Settings → Secrets and variables → Actions):

- `DOCKERHUB_USERNAME` — your Docker Hub username (also the image namespace).
- `DOCKERHUB_TOKEN` — a Docker Hub **access token** (Account Settings → Security).

Then push a tag or run the **Docker image** workflow manually. Without the
secrets the workflow still builds and smoke-tests the image; it just skips the
push.
