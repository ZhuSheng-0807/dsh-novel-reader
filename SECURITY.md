# Security Policy

## Supported

This project has no paid support. Security reports are welcome.

## Reporting a Vulnerability

Please open a **private security advisory** on GitHub:

https://github.com/ZhuSheng-0807/dsh-novel-reader/security/advisories/new

Or email the repository owner (see the GitHub profile). Do **not** open a
public issue for a security problem.

## Security Notes for Users

- `/novel/*` proxy routes only allow `www.hongmengxsw.com` and its subdomains
  (SSRF protection). Arbitrary URL proxying is refused.
- Reading progress, bookshelf and history are stored only in the browser's
  `localStorage`; nothing is uploaded to any server.
- The plugin fetches text from a public free-fiction website for personal
  reading; respect the original authors' copyright.
