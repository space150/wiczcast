# WiczCast

20-day weather forecasting PWA with a Claude-powered chat. A static front end (`index.html`, `css/`, `js/`, `assets/`, `sw.js`) served by a small Express server (`server.js`) that also proxies:

- `POST /api/chat` → Anthropic Messages API (streams SSE back; needs `ANTHROPIC_API_KEY`)
- `GET /api/enso/oni/latest`, `GET /api/enso/oni/data` → `noaa-enso-scraper-api.onrender.com` (CORS workaround)

Forecast data comes straight from the browser to Open-Meteo (no key).

## Local development

```sh
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env   # gitignored
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
3. `gcloud run deploy` with the runtime service account, secret, and scaling limits.
4. Smoke-tests `GET /healthz` on the service URL.

All GCP identifiers are plain `env:` values at the top of the workflow — none of them are secrets. There are no GitHub repository secrets.

### GCP resources (project `space150-wiczcast`, number `660393740189`)

| Resource | Name | Notes |
|---|---|---|
| Cloud Run service | `wiczcast` (`us-central1`) | Public (`allUsers` → `roles/run.invoker`), port 8080, max 3 instances |
| Artifact Registry | `us-central1-docker.pkg.dev/space150-wiczcast/wiczcast` | Docker images tagged by commit SHA |
| Secret Manager | `anthropic-api-key` | Mounted as env var `ANTHROPIC_API_KEY` (`:latest`) |
| Runtime SA | `wiczcast-run@space150-wiczcast.iam.gserviceaccount.com` | Only `secretAccessor` on `anthropic-api-key` |
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
# Rotate the Anthropic key (next deploy or a new revision picks it up)
printf '%s' "$NEW_KEY" | gcloud secrets versions add anthropic-api-key --data-file=- --project space150-wiczcast
gcloud run services update wiczcast --region us-central1 --project space150-wiczcast   # force new revision

# Roll back to a previous revision
gcloud run revisions list --service wiczcast --region us-central1 --project space150-wiczcast
gcloud run services update-traffic wiczcast --to-revisions=<REVISION>=100 --region us-central1 --project space150-wiczcast

# Logs
gcloud run services logs read wiczcast --region us-central1 --project space150-wiczcast --limit 100
```

Note: the local gcloud default project may be something else — always pass `--project space150-wiczcast`.

### Adding a new deploy-time setting

- Env var / secret / scaling flag → edit the `gcloud run deploy` step in the workflow.
- New public static file or directory → add it to `PUBLIC_FILES` / `PUBLIC_DIRS` in `server.js` **and** a `COPY` line in the `Dockerfile`. The server deliberately serves an allowlist, not the whole directory.
- New GCP permission for the pipeline → grant it to `github-deployer@…`, scoped as narrowly as possible.

## Security notes

- `/api/chat` spends our Anthropic credits and is publicly reachable. It is protected by: same-origin check on the `Origin` header, a per-IP rate limit (10 req/min, per instance), input validation (≤20 messages, ≤4k chars each, ≤20k-char system prompt, roles restricted to `user`/`assistant`), fixed model and `max_tokens`, and `--max-instances 3`. These limit abuse but do not prevent a determined scripted client from using the proxy; set a spend limit on the Anthropic key and consider Cloud Armor or auth if abuse appears.
- The ENSO proxy forwards only the two allowlisted paths and 4-digit `start_year`/`end_year` params.
- All model output, API data, and user input is HTML-escaped (`escapeHtml` in `js/app.js`) before being inserted with `innerHTML`.
- Leaflet is loaded from unpkg/cdnjs without Subresource Integrity; there is no Content-Security-Policy yet (see open items below).

### Open security items

- Add SRI `integrity` hashes to the Leaflet / leaflet.heat script and stylesheet tags.
- Add a Content-Security-Policy header (needs to allow unpkg, cdnjs, Google Fonts, `*.basemaps.cartocdn.com`, and the Open-Meteo APIs).
- Move the Claude system prompt server-side so clients can't supply arbitrary instructions to the proxy.
