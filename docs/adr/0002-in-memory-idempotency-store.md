# 2. In-memory Idempotency-Key store

Date: 2026-11-03. Status: Accepted for a single instance.

## Context
Callers need a way to retry `POST /prom-results` without double-processing, independent of the downstream server.

## Decision
Keep keys, a SHA-256 of the body and the in-flight promise in memory for 24 hours. Same key and body replays; different body is 409. Server errors are not cached so the client can retry.

## Consequences
- Simple and fully tested.
- Lost on restart and not shared between replicas. Server-side conditional creates (ADR 0001) still prevent duplicates in that case, so the failure mode is extra work, not bad data. Move to Redis or a database table before running more than one instance.
