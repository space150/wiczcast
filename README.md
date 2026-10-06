# WiczCast

20-day weather forecasting PWA. A static front end (`index.html`, `css/`, `js/`, `assets/`, `sw.js`) served by a small Express server (`server.js`) that also proxies `GET /api/enso/oni/latest` and `GET /api/enso/oni/data` → `noaa-enso-scraper-api.onrender.com` (CORS workaround).

Forecast data comes straight from the browser to Open-Meteo (no key).

## Local development

```sh
npm install
npm run dev                                   # http://localhost:3000
```

## Deployment (Google Cloud Run via GitHub Actions)

**Pushing to the `deploy` branch deploys to production.** `main` is the working branch; promote with:

```sh
git push origin main:deploy
```

The workflow can also be run manually from the Actions tab (`workflow_dispatch`, select the `deploy` branch).

### Pipeline — `.github/workflows/deploy.yml`

1. Authenticates to GCP with **Workload Identity Federation** (OIDC, no JSON keys stored in GitHub).
2. Builds the `Dockerfile` and pushes `…/wiczcast/wiczcast:<git sha>` to Artifact Registry.
3. `gcloud run deploy` with the runtime service account and scaling limits.
4. Smoke-tests `GET /health` (not `/healthz` — Cloud Run reserves paths ending in `z`) on the service URL.

All GCP identifiers are plain `env:` values at the top of the workflow — none of them are secrets. There are no GitHub repository secrets.

### GCP resources (project `space150-wiczcast`, number `660393740189`)

| Resource | Name | Notes |
|---|---|---|
| Cloud Run service | `wiczcast` (`us-central1`) | Public (`allUsers` → `roles/run.invoker`), port 8080, max 3 instances |
| Artifact Registry | `us-central1-docker.pkg.dev/space150-wiczcast/wiczcast` | Docker images tagged by commit SHA |
| Runtime SA | `wiczcast-run@space150-wiczcast.iam.gserviceaccount.com` | No roles; the app needs no GCP access. Grant narrowly if that changes |
| Deployer SA | `github-deployer@space150-wiczcast.iam.gserviceaccount.com` | `roles/run.developer` (project), `artifactregistry.writer` (repo), `iam.serviceAccountUser` on runtime SA |
| WIF pool / provider | `github` / `wiczcast-repo` | Condition: `repository == 'space150/wiczcast' && ref == 'refs/heads/deploy'` |

Because of the WIF condition, **only workflows running on the `deploy` branch of `space150/wiczcast` can obtain GCP credentials** — PRs, forks, and other branches cannot.

The deployer has `run.developer`, not `run.admin`, so it cannot change IAM. Public access was granted once by hand; it persists across deploys:

```sh
gcloud run services add-iam-policy-binding wiczcast --region us-central1 \
  --member=allUsers --role=roles/run.invoker --project space150-wiczcast
```

### Common operations

```sh
# Roll back to a previous revision
gcloud run revisions list --service wiczcast --region us-central1 --project space150-wiczcast
gcloud run services update-traffic wiczcast --to-revisions=<REVISION>=100 --region us-central1 --project space150-wiczcast

# Logs
gcloud run services logs read wiczcast --region us-central1 --project space150-wiczcast --limit 100
```

Note: the local gcloud default project may be something else — always pass `--project space150-wiczcast`.

### Adding a new deploy-time setting

- Env var / scaling flag → edit the `gcloud run deploy` step in the workflow.
- Secret → store it in Secret Manager, grant `roles/secretmanager.secretAccessor` on that secret to the runtime SA, and add `--set-secrets NAME=secret-name:latest` to the deploy step. Never put secrets in the workflow or repo (it's public).
- New public static file or directory → add it to `PUBLIC_FILES` / `PUBLIC_DIRS` in `server.js` **and** a `COPY` line in the `Dockerfile`. The server deliberately serves an allowlist, not the whole directory.
- New GCP permission for the pipeline → grant it to `github-deployer@…`, scoped as narrowly as possible.

## Security notes

- The ENSO proxy forwards only the two allowlisted paths and 4-digit `start_year`/`end_year` params, rate limited to 30 req/min per IP (per instance).
- There is no backend state and no secrets; the deployed service has no credentials worth stealing.
- Third-party API data (geocoding results) and generated notification text are HTML-escaped (`escapeHtml` in `js/app.js`) before being inserted with `innerHTML`.
- Leaflet is loaded from unpkg/cdnjs without Subresource Integrity; there is no Content-Security-Policy yet (see open items below).

### Open security items

- Add SRI `integrity` hashes to the Leaflet / leaflet.heat script and stylesheet tags.
- Add a Content-Security-Policy header (needs to allow unpkg, cdnjs, Google Fonts, `*.basemaps.cartocdn.com`, and the Open-Meteo APIs).
