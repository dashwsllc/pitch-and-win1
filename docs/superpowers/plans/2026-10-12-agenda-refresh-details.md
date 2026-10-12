# Agenda refresh and call details

> For agentic workers: use superpowers:executing-plans inline, with one independent final review.

**Goal:** Atualizar must request real Google delivery and refresh the visible CRM/status data; CRM cancellation/deletion/rescheduling must propagate; Google events include lead context, a unique Meet and the duration entered in CRM.

**Architecture:** Extend the existing durable queue, leases, ownership checks and event identities. Add call duration and compatibility RPC wrappers while retaining old scheduling/edit signatures. Extend the server snapshot and triggers for context; keep credentials private. No role, account, destination or sharing changes.

**Tech:** React/Query, Supabase/PostgreSQL, Deno Edge Functions, Google Calendar v3.

**Spec:** User's explicit request and clarification on 12 October: duration proportional to CRM, context of each lead, Meet link. Existing schema has only scheduled_at; old calls retain their 30 minute duration, new calls expose duration in minutes (1..480).

## Global constraints

- Commercial ref mbzwchnxtskysqplqiyy, existing Agenda - Closers and admvoxenai@gmail.com.
- New SQL must be additive, trialed on isolated QA; preserve old RPCs, data and RLS. Never db push/reset.
- One event identity and conference per call; preserve conference during edits, no attendee invites.
- Manual synchronization allowed only to approved existing Closer capability, rate limited on server.
- Explicit errors/pending states; refreshing data must not falsely claim Google success.
- Plain lead context escaped for Google HTML, bounded excerpt with CRM full-context link.

## Review focus

- Unauthorized manual sync, concurrency and repeated requests.
- Duration-only edit of an overdue call and old/new clients during rollout.
- Pending/failed Meet creation, timeout after insert and preservation during remarcation.
- Context update/deletion and CRM call deletion while a worker owns a lease.
- Complete data refresh even when provider fails; no stale query success message.

## Tasks

1. [ ] RED tests for duration projection, escaped context, conference payload/preservation, refresh request and duration-only edits.
2. [ ] Add migration for duration, snapshot/context triggers, rate-limited manual refresh and guarded Meet ACK; old scheduling/edit wrappers preserved. Add SQL fixture for lifecycle and authorization; execute with rollback on QA.
3. [ ] Implement Google conference creation and projection details without changing event identity. Run worker/client regression suites.
4. [ ] Implement CRM duration input and Agenda refresh loading/error/status behavior; display context/interval/Meet. Run CRM, Agenda and Calendar tests, types/lint/build.
5. [ ] Independent review, correct important findings; trial/deploy only feature migration and affected functions; publish frontend, request authorized commercial reconciliation and verify real event/Meet/duration. Keep synthetic tests in QA.

## Rollback

Retain added columns/data and old RPC signatures. Restore prior Edge/frontend versions if needed; pause worker only for a concrete failure. No schema contraction or event purge. Reconciliation uses existing bindings to restore desired CRM state.
