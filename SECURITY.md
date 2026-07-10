# Security & privacy policy

## Reporting a vulnerability

Do **not** open a public issue for security or privacy problems. Email the
maintainers (see the repo's organization profile) with:

- a description and impact,
- reproduction steps,
- affected component (extension / central service / data repo).

We aim to acknowledge within a few days and to coordinate disclosure.

## In scope

- Extension exfiltrating data, exceeding passive read, or acting on the
  user's X account without an explicit user gesture.
- Central service: report-flooding / defamation amplification, auth bypass on
  admin/review endpoints, PII leakage.
- Public data repo: integrity of the published list, unauthorized entries.

## Privacy commitments

- No PII beyond the public X numeric id is stored or published.
- Reporter identity is never stored — only a salted HMAC fingerprint for
  anti-abuse. The fingerprint salt (`REPORT_SALT`) is mandatory: write
  endpoints fail closed (503) when it is unset, and a one-shot admin
  backfill migrates any legacy raw `gh:<id>` rows to fingerprints.
- The default hide action is local and never uploads browsing data, scanned
  accounts, or action history. The extension downloads public blacklist and
  whitelist artifacts from `x.zuoluo.tv`; optional X mute/block requests go
  only to X. GitHub Device Flow and the whitelist API are contacted only when
  the user explicitly starts a self-service whitelist application.

See [GOVERNANCE.md](./GOVERNANCE.md) for the full data-handling contract.
