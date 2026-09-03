#!/bin/sh
# Blocks until Odoo answers and its database is initialised.
#
# Seeding that races application startup produces an environment that is *usually*
# right, which is the worst possible property for a benchmark: it makes the starting
# state nondeterministic without ever failing loudly.
set -eu

DEADLINE=$(($(date +%s) + 900))

until curl -fsS http://localhost:8069/web/health >/dev/null 2>&1; do
  [ "$(date +%s)" -lt "$DEADLINE" ] || { echo "odoo did not become healthy in 15 minutes" >&2; exit 1; }
  sleep 3
done

until docker compose exec -T db psql -U odoo -d odoo -tAc \
      "select 1 from information_schema.tables where table_name = 'purchase_order'" \
      2>/dev/null | grep -q 1; do
  [ "$(date +%s)" -lt "$DEADLINE" ] || { echo "odoo schema was not initialised in time" >&2; exit 1; }
  sleep 3
done

echo "odoo is ready"
