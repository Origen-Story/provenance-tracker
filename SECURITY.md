# Security policy

Provenance Tracker signs files on behalf of the person running it, so a weakness here can become a false statement about someone's work. Reports are welcome and taken seriously.

## Reporting a vulnerability

Please report privately, not in a public issue.

Use GitHub's private reporting: on the [Security tab](https://github.com/Origen-Story/provenance-tracker/security) of this repository, choose **Report a vulnerability**. Only the maintainers see the report.

It helps to include:

- what you found and what it lets someone do,
- the steps or a small proof of concept,
- the version (`package.json`) or commit, and your operating system.

Please do not include real private keys, credentials or other people's media in a report.

## What to expect

This project has one maintainer. You should hear back within seven days. A confirmed problem is fixed on `main` first, and the fix and the reporter (if you want the credit) are named in the release notes. Please allow reasonable time for a fix before publishing details.

## Supported versions

Fixes land on `main` and in the next tagged release. Older tags are not patched.

## Scope

The tracker is a local, single-user tool with no login. What it is built to defend against, and what it deliberately leaves to the person running it, is set out in [docs/threat-model.md](docs/threat-model.md). What it sends over the network is listed in [docs/network.md](docs/network.md).

In scope, for example:

- a web page or another device reaching the local API,
- reading a file the preview should refuse, or learning where the signing key is,
- an import or a signing step that changes, moves or deletes a file it should not,
- a signed file or public export that says something the record does not, or leaks local paths,
- a problem in how credentials are read, validated or reported.

Out of scope, because the threat model already says so: someone who already controls the computer or the account the tracker runs under, and running the server on a network with `HOST` set and no login in front of it.

Vulnerabilities in dependencies are tracked by `npm run audit` in CI. If you find one that is exploitable through the tracker, that is in scope.
