# Hosted deploy (Cloudflare Pages + Render)

The public site. The only mode where the frontend and backend live on
different origins.

- Frontend: Cloudflare Pages, project `cpp-tutor` → <https://cpp-tutor.pages.dev>
- Backend: Render web service `cpp-tutor-api` (`srv-d9j3efv1dkcs73bl4pg0`),
  free plan, running the published image → <https://cpp-tutor-api.onrender.com>

## How a deploy happens

Push to `main`. That is the whole trigger.

1. `.github/workflows/image.yml` builds, smoke-tests, and publishes
   `ghcr.io/jmanoj0905/cpp-tutor:latest` (see [image.md](image.md)).
2. `.github/workflows/deploy-hosted.yml` waits for that run to succeed, then:
   - `curl`s `RENDER_DEPLOY_HOOK_URL`, which makes Render re-pull `:latest`
     (an image service does not notice a new tag on its own);
   - builds `frontend/` with `VITE_API=https://cpp-tutor-api.onrender.com` and
     `wrangler pages deploy`s the result.

Tag builds (`v*`) publish an image but do not deploy: the `:latest` manifest is
gated on `is_default_branch`, so deploying a tag would ship whatever `:latest`
happened to be.

To redeploy the backend without a code change, hit the deploy hook again, or
`render deploys create srv-d9j3efv1dkcs73bl4pg0`.

## The cross-origin contract

Two settings have to agree, in opposite directions:

| Where | Setting | Value |
|---|---|---|
| Pages bundle (build time) | `VITE_API` in `deploy-hosted.yml` | `https://cpp-tutor-api.onrender.com` |
| Render service (runtime) | `CPP_TUTOR_CORS_ORIGINS` | `https://cpp-tutor.pages.dev` |

Change either host and you must change both, or the site loads and every trace
fails with a CORS error. `deploy/render.yaml` records the Render side; note the
caveat at the top of that file — it documents the service, it does not drive it.

## Secrets the workflow needs

| Secret | Used for |
|---|---|
| `RENDER_DEPLOY_HOOK_URL` | triggering the backend redeploy |
| `CLOUDFLARE_API_TOKEN` | `wrangler pages deploy` |
| `CLOUDFLARE_ACCOUNT_ID` | same |

## Free-plan behaviour to expect

Render's free instance sleeps when idle: the first request after a quiet period
can take **30–60 seconds** before `/api/health` answers, and a trace request
landing during that window will look like a hang. Not a bug in the app.
`RLIMIT_NPROC` had to be dropped from the tracer for this host — Render's
shared machines already sit near the per-user process limit, so the rlimit was
killing forks.
