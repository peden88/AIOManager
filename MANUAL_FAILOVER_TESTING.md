# Manual failover test deployment

This stack is intentionally independent of the existing AIOManager deployment.

## Isolation

- Container: `aiomanager-manual-failover`
- Host port: `127.0.0.1:1611`
- Image: locally built as `aiomanager:manual-failover-test`
- Database: `./aio-data-manual-failover/manual-failover-test.db`
- Hostname: `aiofail.peden88.stream`

Do not mount the existing AIOManager data directory or reuse its encryption key.

## Prepare the VPS directory

```bash
git clone --branch feature/manual-failover-groups \
  https://github.com/peden88/AIOManager.git \
  /opt/aiomanager-manual-failover
cd /opt/aiomanager-manual-failover
mkdir -p aio-data-manual-failover
chown -R 65532:65532 aio-data-manual-failover
```

Create the isolated environment file:

```bash
cp .env.manual-failover.example .env.manual-failover
```

Generate the test encryption key:

```bash
openssl rand -hex 32
```

Replace `REPLACE_WITH_A_NEW_64_CHARACTER_HEX_KEY` in `.env.manual-failover` with the output.

Generate a separate external API token:

```bash
openssl rand -hex 32
```

Replace `REPLACE_WITH_A_DIFFERENT_64_CHARACTER_HEX_TOKEN` in `.env.manual-failover` with this second output. Do not reuse the encryption key.

## Start the independent stack

```bash
docker compose -f docker-compose.manual-failover.yml up -d --build
docker compose -f docker-compose.manual-failover.yml ps
docker logs --tail=100 aiomanager-manual-failover
```

To update this test instance later without changing production:

```bash
cd /opt/aiomanager-manual-failover
git pull --ff-only
docker compose -f docker-compose.manual-failover.yml up -d --build
```

## Pangolin resource

Create a new HTTP resource without changing the production resource:

- Domain: `aiofail.peden88.stream`
- Target: `http://aiomanager-manual-failover:1610`
- Network: `pangolin_frontend`
- TLS: enabled

## Manual failover API

After deployment, sign in to `https://aiofail.peden88.stream` once and leave the dashboard open until the account refresh completes. This creates the encrypted server-side execution copy. Stremio auth keys, addon collections, and group URLs are encrypted at rest using `ENCRYPTION_KEY`.

Store your API token temporarily for testing:

```bash
export AIOFAIL_TOKEN='YOUR_MANUAL_FAILOVER_API_TOKEN'
```

List externally available groups:

```bash
curl -sS \
  -H "Authorization: Bearer $AIOFAIL_TOKEN" \
  https://aiofail.peden88.stream/api/manual-failover/groups
```

Check one group:

```bash
curl -sS \
  -H "Authorization: Bearer $AIOFAIL_TOKEN" \
  https://aiofail.peden88.stream/api/manual-failover/GROUP_ID/status
```

Use the explicit actions for automations because they are idempotent: calling `failover` while Backup is already active, or `failback` while Primary is already active, makes no additional change.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $AIOFAIL_TOKEN" \
  https://aiofail.peden88.stream/api/manual-failover/GROUP_ID/failover

curl -sS -X POST \
  -H "Authorization: Bearer $AIOFAIL_TOKEN" \
  https://aiofail.peden88.stream/api/manual-failover/GROUP_ID/failback
```

A state-dependent toggle is also available:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $AIOFAIL_TOKEN" \
  https://aiofail.peden88.stream/api/manual-failover/GROUP_ID/toggle
```

Do not place the bearer token in a query string. If Pangolin SSO protects the API path, Apple Shortcuts and bots will also need a Pangolin rule or separate API resource that permits this path while leaving bearer-token authentication enabled.

## Test plan

1. Create a new AIOManager login UUID and password on the test instance.
2. Add two disposable/test Stremio accounts first.
3. Install both primary and backup addon instances on each account.
4. Open **Failover** and create a tagged group.
5. Run **Fail Over** and confirm the primary is disabled and backup enabled in Stremio.
6. Run **Fail Back** and confirm the reverse.
7. Test an account missing the backup addon and confirm it is reported as failed without affecting successful accounts.
8. Confirm a conflicting Autopilot rule is paused after a manual swap.
9. Restart the container and confirm groups and active mode persist.
10. Confirm the production AIOManager container and data are unchanged.
11. Confirm an unauthenticated API request returns HTTP 401.
12. Run API `failover`, `status`, and `failback`, then confirm the home button state follows within 30 seconds.
