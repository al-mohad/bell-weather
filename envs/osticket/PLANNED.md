# osTicket — planned

Target tasks: `tkt-01` (triage six tickets to the right queue from a policy document)
and `tkt-02` (answer a customer email in Roundcube, open a linked ticket, cite the order
id) — the cross-application case the current suite does not cover.

Needed before a task can land here:

- `compose.yaml` for osTicket + MariaDB + Roundcube against a local MTA.
- A seed that creates six tickets with deterministic ids and subjects, and asserts that
  no ticket has been assigned yet.
- A `bw-fault` hook: osTicket's session timeout for `session-expiry`, and a staff
  announcement banner for `modal`.
- Verifiers reading `ost_ticket.topic_id` / `staff_id` — MySQL, so `ctx.sql()` needs a
  MySQL path alongside the current `psql` one.

Not started. This file exists so the gap is visible rather than implied.
