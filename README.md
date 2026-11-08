# Woodpecker Status for Orca

Shows the CI status of all your [Woodpecker](https://woodpecker-ci.org) projects in Orca's right sidebar.

- All projects at a glance, failed first, then running, then the rest
- Click a project: steps, pipeline errors, step errors and the last 30 log lines of the failed step
- Status bar item (`CI 2 failed` / `CI 1 running` / `CI ok`), click refreshes
- Desktop notification when a project turns red
- Polls every 30 s, every 10 s while a pipeline runs

## Setup

1. Open the **Woodpecker Status** panel (rocket icon in the right sidebar).
2. Enter your server URL, e.g. `https://ci.example.com`.
3. Create a token in Woodpecker: profile (top right) → User settings → Personal Access Token. Paste it into the panel.

The URL is a plugin setting. The token is stored encrypted in Orca's plugin secrets and never shown again. Leave the token field empty on later edits to keep the saved one.

## Access this plugin asks for

| Access | Why |
|---|---|
| Worker process (`trusted-worker`) | Calls the Woodpecker API (the panel itself has no network access in Orca) |
| `settings:own` | Stores the server URL |
| `secrets:own` | Stores the token |
| `notifications:show` | Desktop notification when a pipeline fails |

The plugin only reads from Woodpecker (`GET` requests to `/api/user/repos`, `/api/repos/{id}/pipelines`, `/api/repos/{id}/logs/...`). It talks to nobody except the server you configure. No tracking.

## Develop

```sh
orca plugin validate .
orca plugin test .
orca plugin dev watch .
```

## About

Built and maintained by [BroDesigns](https://brodesigns.de), a web agency that runs its own CI on Woodpecker.

## License

MIT
