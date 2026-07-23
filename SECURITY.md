# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's **Security** tab rather
than a public issue. Include a minimal reproduction and the affected version.

## Scope

This package performs arithmetic preflight checks. It does not allocate a canvas,
decode media, inspect file headers, or guarantee that a browser will remain within
a particular memory budget. Applications remain responsible for choosing and
testing limits appropriate to their supported devices.
