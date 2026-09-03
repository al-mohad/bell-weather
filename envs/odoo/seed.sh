#!/bin/sh
# Puts Odoo into the exact state every trial of odoo-po-01 starts from.
set -eu
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U odoo -d odoo < seed.sql
echo "odoo seeded"
