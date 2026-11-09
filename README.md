# Woodpecker Status for Orca

Shows the CI status of all your [Woodpecker](https://woodpecker-ci.org) projects in Orca's right sidebar.

- All projects at a glance, failed first, then running, then the rest
- Click a project: steps, pipeline errors, step errors and the last 30 log lines of the failed step
- Status bar item (`CI 2 failed` / `CI 1 running` / `CI ok`), click refreshes
- Desktop notification when a project turns red
- Polls every 30 s, every 10 s while a pipeline runs

## Install

Requires Orca 1.4.248 or newer.

### From the Orca community catalog

1. In Orca, open **Settings → Plugins**.
2. Add the marketplace `https://github.com/stablyai/orca-community-plugins.git` (ref `main`).
3. Search for **Woodpecker Status** and install it.
4. Review the access it asks for and approve it.

The plugin appears in the catalog once its first release tag is listed there.

### From source

Use this to try the plugin before it is listed, or to hack on it.

```sh
git clone https://github.com/brodesigns/orca-woodpecker-status
cd orca-woodpecker-status
orca plugin dev load .
```

The command prints the access the plugin asks for and a fingerprint. Approve it with:

```sh
orca plugin dev load . --approve <fingerprint>
```

You can also add the cloned folder in the Orca UI under **Settings → Plugins → Development folders**.

## Configure

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

### Why does Orca show "Full access"?

Orca labels every plugin that runs a worker process as **Full access**, because a worker is a Node.js process that runs with your user account's rights. Orca has no narrower level for "network only". Panels are sandboxed and cannot reach the network, so this plugin needs a worker to call the Woodpecker API.

What this plugin does with that access:

- It sends `GET` requests to the one Woodpecker server you configure, and to nothing else.
- It never reads or writes files, starts programs or uses terminals.
- It never changes anything in Woodpecker. Read-only API calls, no writes.
- Your token stays in Orca's encrypted plugin secrets and is only sent to your own Woodpecker server.
- No analytics, no tracking, no third-party services.

The code is small (about 550 lines in `src/`, tests and demo data aside), so you can read all of it before you approve. Orca pins the approval to the exact files, and an update that asks for more access has to be approved again.

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
