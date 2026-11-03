# Contributing

Contributions, including from external developers or suppliers, go through pull requests to `main`. CI must be green and a maintainer must approve.

Review checklist:

- [ ] Every outbound write is idempotent (conditional create or equivalent) before it is allowed to be retried.
- [ ] No patient data in logs, errors or fixtures. New log fields are checked against `redact()`; fixtures are recorded from sandboxes or are obviously synthetic.
- [ ] New upstream behaviour has a recorded fixture and a contract test.
- [ ] Timeouts on every outbound call. No unbounded retries.
- [ ] Mapping changes keep data minimisation: do not copy fields the PROM service does not need.
- [ ] New dependencies are justified and permissively licensed.
- [ ] If AI tools generated a significant part of the change, say so in the PR; the author has read every line.

Refresh fixtures by calling the sandbox (see `test/fixtures/`), never with real patient data.
