# GitHub Governance Dashboard

A daily audit dashboard for reviewing repository activity, commit hygiene, branch naming compliance, pull request workflow health, and branch protection governance across your GitHub organisation.

![Dashboard](docs/dashboard-preview.png)

## What it does

- Scans all accessible repositories (public and private) for a given org or user
- Produces plain-language risk summaries understandable by non-developers
- Shows KPIs: critical/warning/healthy counts, stale repos, PR risks, naming violations
- Highlights only non-zero findings in branch and PR reporting
- Exports results as JSON or CSV
- Runs automated daily audits via GitHub Actions or server-side cron
- Supports shared team access via Docker deployment with optional basic auth

## Quick start

### Local development

```bash
cp .env.example .env
# Edit .env and set PAT

npm install
npm start
```

Open http://localhost:3000

### Docker (shared team access)

```bash
cp .env.example .env
# Set PAT, DASHBOARD_USER, DASHBOARD_PASSWORD

docker compose up -d
```

The dashboard is available at http://localhost:3000 (or your deployed host). Team members authenticate with the configured credentials; the server uses the shared PAT for scans.

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `PAT` | GitHub Personal Access Token | — |
| `AUDIT_ACCOUNT_FILTER` | Org or user to audit | `DigitalQatalyst` |
| `PORT` | Server port | `3000` |
| `DASHBOARD_USER` | Basic auth username (optional) | — |
| `DASHBOARD_PASSWORD` | Basic auth password (optional) | — |
| `AUDIT_CRON` | Cron expression for daily scan | `0 6 * * *` |
| `DATA_DIR` | Scan results storage | `./data` |
| `DEFAULT_SCAN_MODE` | `fast` or `thorough` | `fast` |

### GitHub PAT scopes

The token needs these scopes:

- `repo` — access private repositories
- `read:org` — list organisation repositories (if auditing an org)

For fine-grained tokens, grant repository access to all repos in the org with read permissions for metadata, contents, pull requests, and administration.

## Daily automation

### Option 1: Server cron

When `PAT` is set, the server runs a scheduled audit using `AUDIT_CRON` (default: 06:00 UTC daily). Results are saved to `DATA_DIR/latest.json`.

### Option 2: GitHub Actions

Add `PAT` as a repository secret, then the workflow in `.github/workflows/daily-audit.yml` runs daily and uploads results as artifacts.

Manual trigger:

```bash
gh workflow run daily-audit.yml -f account=DigitalQatalyst -f mode=fast
```

### Option 3: CLI

```bash
PAT=xxx npm run audit:cli -- --account DigitalQatalyst --mode fast
```

## Dashboard usage

1. Enter a GitHub PAT (or rely on server-configured token)
2. Set the account filter (org name, e.g. `DigitalQatalyst`)
3. Choose scope: All accessible / Public / Private
4. Click **Refresh** to start a scan
5. Review KPIs, health distribution, and per-repo findings
6. Click a repository name for detailed risks and samples
7. Use action buttons for remediation guidance
8. Export via **JSON** or **CSV**

## Audit criteria

### Health status

| Status | Meaning |
|--------|---------|
| Critical | Multiple governance gaps requiring immediate action |
| Warning | Minor issues to address soon |
| Healthy | Meets most governance standards |

### Branch naming

Approved: `feature/description-dev`, `bugfix/description-dev`, `main`, `develop`, `staging`, `release`, `prototype`

Flagged: `fix/`, `feat/`, `TBD_`, `cleanup/`, `Feat/`, `Hotfix/`, `landingpages/`, underscore-only names, `origin/` refs

### Commit hygiene

Messages like "changes", "test", "first commit", "cleanup", "final" are flagged as vague.

### PR workflow

- Stalled PRs: open >24h with no activity
- PRs without reviewers
- Direct commits with no PR workflow

### Branch protection

Checks `main`, `master`, `develop`, and `staging` for protection rules.

## Shared access deployment

For central team access:

1. Deploy with Docker Compose on a shared server or cloud VM
2. Set `PAT` in `.env` (never commit this file)
3. Enable `DASHBOARD_USER` and `DASHBOARD_PASSWORD` for basic auth
4. Optionally put nginx or a load balancer with TLS in front
5. Team members visit the URL — no individual PAT required

```bash
# Production example
PAT=ghp_xxx \
DASHBOARD_USER=audit-team \
DASHBOARD_PASSWORD=secure-password \
AUDIT_ACCOUNT_FILTER=DigitalQatalyst \
AUDIT_CRON="0 6 * * *" \
docker compose up -d
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Dashboard configuration |
| GET | `/api/status` | Scan status |
| GET | `/api/scan/latest` | Latest scan results |
| POST | `/api/scan` | Trigger new scan |
| GET | `/api/export/json` | Download JSON |
| GET | `/api/export/csv` | Download CSV |
| POST | `/api/actions/:id` | Remediation guidance |

## Development

```bash
npm run dev      # Start with file watch
npm test         # Run unit tests
```

## Security notes

- Never commit PATs or `.env` files
- Use repository secrets for GitHub Actions
- Enable basic auth for shared deployments
- Rotate tokens regularly
- The dashboard provides remediation guidance; write operations require manual action in GitHub

## License

MIT
