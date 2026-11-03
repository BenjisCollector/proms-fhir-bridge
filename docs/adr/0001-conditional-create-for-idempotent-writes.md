# 1. Conditional creates for idempotent writes to the FHIR server

Date: 2026-11-03. Status: Accepted.

## Context
Pushing results over a network will sometimes time out after the server has already committed. Retrying a plain FHIR `POST` would then create duplicate QuestionnaireResponses and Observations in someone else's clinical record.

## Decision
Send one `transaction` Bundle in which every entry is `POST` with `ifNoneExist` on a stable business identifier (the source system's resource id under a system URI we own; the patient's own identifier for Patient). Retry only requests built this way.

## Consequences
- Retries and replays are safe end to end; verified against HAPI (9 x 201, then 9 x 200).
- Updates to an existing result are not sent (a conditional create never overwrites). Corrections would need conditional update, which is out of scope.
- Relies on the server supporting conditional create in transactions (required by many NHS FHIR servers, but must be checked per target).
