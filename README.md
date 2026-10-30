# @pitchmentor/cli

[![npm](https://img.shields.io/npm/v/@pitchmentor/cli?logo=npm&color=cb3837)](https://www.npmjs.com/package/@pitchmentor/cli) [![CI](https://github.com/pitchmentor/pitchmentor-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/pitchmentor/pitchmentor-cli/actions/workflows/ci.yml) [![MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Official command-line interface for the [Pitch Mentor](https://pitchmentor.net) API, built on
[`@pitchmentor/sdk`](https://www.npmjs.com/package/@pitchmentor/sdk). Node 20+.

API reference: https://pitchmentor.net/docs

## Install

```bash
npm install -g @pitchmentor/cli    # installs the `pitchmentor` command
# or one-off: npx @pitchmentor/cli me
```

## Authentication

Create a team API key (`pm_live_…`) in the Pitch Mentor dashboard; it is sent as `Authorization: Bearer pm_live_…`.
The key is taken from, in order: `--api-key`, `PITCHMENTOR_API_KEY`, or the config file written by `pitchmentor login`.

```bash
export PITCHMENTOR_API_KEY=pm_live_…
# or
pitchmentor login            # paste a key; stored in ~/.config/pitchmentor/cli.json (0600)
pitchmentor logout
```

Config file: `$PITCHMENTOR_CONFIG`, else `$XDG_CONFIG_HOME/pitchmentor/cli.json`, else `~/.config/pitchmentor/cli.json`.
`--base-url` / `PITCHMENTOR_BASE_URL` point at another API host.

## Quick start

```bash
pitchmentor me
pitchmentor calls list --period 7d --limit 50
pitchmentor calls get <id>
pitchmentor calls export --format csv > calls.csv
pitchmentor calls archive <id>
pitchmentor analytics overview --period 30d
pitchmentor analytics users --period 30d
pitchmentor leads upsert --name "Ada" --email ada@example.com --external-id crm-42
pitchmentor leads batch --data @leads.json
pitchmentor team get
pitchmentor team update --tone-guidelines "Friendly, concise."
pitchmentor members list
pitchmentor invites create
pitchmentor coaching styles
pitchmentor billing subscription
pitchmentor billing usage
pitchmentor billing member-usage
pitchmentor referrals
pitchmentor webhooks create --url https://example.com/hooks --events call.completed,lead.created
pitchmentor webhooks deliveries <id> --status failed
pitchmentor api-keys create --name ci --scopes calls:read,leads:read
pitchmentor api-keys revoke <id> --yes
pitchmentor help                     # every command
pitchmentor calls list --help        # flags of one command
```

Commands are `pitchmentor <group> <command>`; the first command of a group is its default (`pitchmentor referrals` =
`pitchmentor referrals get`). Query and body fields are flags (`--member-id`, `--scopes a,b`); `--data '{…}'`,
`--data @file.json` or `--data -` (stdin) sets a full request body.

Output is a table by default and raw JSON with `--json`.

## Pagination

List commands print one page and, when there is more, the `--cursor` to pass for the next one. `--all` fetches every page:

```bash
pitchmentor calls list --all --json | jq '.[].id'
```

## Retries and idempotency

429, 5xx and network errors are retried (2 times) with backoff, honoring `retry-after`. Every POST carries a generated
`Idempotency-Key` that is reused across those retries, so a retried command never runs twice.

## Errors and exit codes

API errors print `Error (<status> <code>): <message>` (e.g. `Error (403 insufficient_scope): …`) to stderr.
Exit codes: `0` success, `1` API or network error, `2` usage error (unknown command or flag, missing key).
Destructive commands (revoke/rotate API keys, delete webhooks, rotate webhook secrets, remove members, cancel invites)
refuse to run without `--yes`.

## Webhooks

Manage endpoints with `pitchmentor webhooks …` (`create`, `update`, `rotate-secret`, `test`, `deliveries`, `replay`).
To verify incoming webhook signatures in your server, use `verifyWebhook` from
[`@pitchmentor/sdk`](https://www.npmjs.com/package/@pitchmentor/sdk) (or the Python / Go SDK).

## Development

```bash
npm install
npm test          # build + node:test
```

Commands come from the operations of the published [`@pitchmentor/sdk`](https://github.com/pitchmentor/pitchmentor-node);
their names live in [`src/commands.ts`](src/commands.ts). After bumping the SDK dependency, the tests fail until every new
operation has a command name.

## Releasing

1. Bump `version` in `package.json` (`scripts/check-version.sh X.Y.Z`), merge to `main`.
2. `git tag vX.Y.Z && git push origin vX.Y.Z`. The [Release workflow](.github/workflows/release.yml) tests, publishes to npm
   with provenance and creates the GitHub Release.

## Support

[Docs](https://pitchmentor.net/docs) · [Status](https://pitchmentor.net/status) · [Discord](https://discord.gg/SkcxVEJ6wQ). Security issues: see the [security policy](https://github.com/pitchmentor/.github/blob/main/SECURITY.md).

## License

[MIT](LICENSE)
