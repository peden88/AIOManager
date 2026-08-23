# Manual failover test deployment

This stack is intentionally independent of the existing AIOManager deployment.

## Isolation

- Container: `aiomanager-manual-failover`
- Host port: `127.0.0.1:1611`
- Image: locally built as `aiomanager:manual-failover-test`
- Database: `./aio-data-manual-failover/manual-failover-test.db`
- Suggested hostname: `aiomanager-test.peden88.stream`

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

- Domain: `aiomanager-test.peden88.stream`
- Target: `http://aiomanager-manual-failover:1610`
- Network: `pangolin_frontend`
- TLS: enabled

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
