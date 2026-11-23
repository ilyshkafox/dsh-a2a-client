# dsh-a2a-client

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![A2A 1.0](https://img.shields.io/badge/protocol-A2A%201.0-4C6EF5.svg)](https://a2a-protocol.org)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](package.json)

**English** | [Русский](https://github.com/ilyshkafox/dsh-a2a-client/blob/main/README.ru.md) | [中文](https://github.com/ilyshkafox/dsh-a2a-client/blob/main/README.zh.md)

An [Agent2Agent (A2A) 1.0](https://a2a-protocol.org) client for DeepSeek Harness.
It connects remote agents to your model and adds an **A2A** panel where they are
added, checked and removed without editing files.

The model gets three tools — list agent cards, send a message, work with tasks.
You get a sidebar panel; no dependencies, only built-in `fetch` and `node:crypto`.

Transport is JSON-RPC 2.0 over HTTP with the `a2a-version: 1.0` header and an
optional `authorization: Bearer` — methods `SendMessage`, `SendStreamingMessage`
(SSE), `GetTask`, `CancelTask`, `ListTasks`. Agent cards are cached for 30 seconds.

## Install

The package is `dsh-a2a-client`. Installing it also enables the bundle: the
profile dependency and the `dsh.profile.bundles` entry are added together, so a
separate selection step is not needed.

### Plugins panel — web and Desktop

The shortest route, and the only one that needs no terminal: open **Plugins**,
install with the target `dsh-a2a-client` (npm) or
`github:ilyshkafox/dsh-a2a-client` (git). The panel checks the repository and the
DSH version, streams progress, and tells you whether to restart.

### Terminal — web profile

```sh
dsh plugin --profile web add dsh-a2a-client                      # from npm
dsh plugin --profile web add github:ilyshkafox/dsh-a2a-client    # from git
```

Restart DSH: the **A2A** panel appears in the sidebar and the tools in chat.

### Terminal — Desktop

Desktop has its own profile, separate from `web`: the app creates
`~/.dsh/profiles/desktop` on first launch and loads every bundle at startup. So
the command has to run with the app closed, and it has to be the `dsh` that ships
with the app.

1. Start the app once and close it, so the `desktop` profile exists.
2. Quit it completely — the window, the tray icon, and any `DeepSeek Harness`
   process left in the task manager. A running app keeps files in the profile's
   `node_modules` open.
3. Run the command:

   ```sh
   dsh plugin --profile desktop add dsh-a2a-client
   ```

4. Start the app again: the **A2A** panel appears in the sidebar.

Check which `dsh` you have with `where dsh` (Windows) or `which dsh` (macOS,
Linux). The installer puts the app's own command on your user `PATH`, and that is
the only one allowed to touch the `desktop` profile — a `dsh` installed separately
from npm refuses it with *profile "desktop" is managed exclusively by the Electron
application*.

### By hand

Add both entries to the profile `package.json` (`~/.dsh/profiles/web/package.json`)
and run `pnpm install`:

```json
{
  "dependencies": { "dsh-a2a-client": "github:ilyshkafox/dsh-a2a-client" },
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-a2a-client"] } }
}
```

A local checkout uses `"dsh-a2a-client": "link:/absolute/path/to/dsh-a2a-client"`.

### First agent

Open **A2A** → **Add agent**, and fill in a name, an Agent Card URL and a token if
the agent needs one. The card is fetched right away, so a wrong address or token
is not saved.

A git spec pinned to a full 40-character commit can be updated with the panel's
**Update** button; a branch or tag has to be reinstalled.

## Configure

Agents live in the profile registry `a2a-client.json`, filled in by the panel.
Until that file exists, agents come from the plugin `config`:

```yaml
config:
  defaultAgent: my-agent        # agent used by a2a_send and a2a_task by default
  tokenEnv: A2A_AUTH_TOKEN      # shared secret reference (optional)
  timeoutMs: 180000             # one HTTP call
  agents:
    - name: my-agent
      cardUrl: https://agent.example.com/.well-known/agent-card.json
      tokenEnv: A2A_TOKEN_MY_AGENT
      timeoutMs: 120000
```

| Field | Default | Meaning |
| --- | --- | --- |
| `name` | — | Agent name used by the tools: up to 64 characters, letters, digits, space, `_`, `.`, `-` |
| `cardUrl` | — | Absolute `http://` or `https://` Agent Card address |
| `tokenEnv` | `A2A_TOKEN_<NAME>` | Secret reference: an environment variable or a DSH credential store entry |
| `token` | empty | Token in the config itself; loses to the store and the environment |
| `timeoutMs` | `180000` | Timeout of one HTTP call to this agent |
| `enabled` | `true` | A disabled agent is listed but not polled |
| `allowCrossOriginToken` | `false` | Allow sending the token to a JSON-RPC endpoint on another origin than the card |

### Tokens

Each agent has its own secret. The reference name is derived from the agent name:
`A2A_TOKEN_<NAME>` in upper case, with everything but Latin letters and digits
replaced by `_` — `prod agent` becomes `A2A_TOKEN_PROD_AGENT`.

A token entered in the panel goes to the **DSH credential store**
(`ctx.credentials`, `~/.dsh/.credentials.yaml`), not to `a2a-client.json`.
Lookup order:

1. The DSH credential store — what the panel saved.
2. The process environment and `.env`.
3. The `token` field in the config or in `a2a-client.json` — read-only, for
   records written before the credential store.

## Tools

| Tool | Parameters | Purpose |
| --- | --- | --- |
| `a2a_agents` | `agent?`, `refresh?` | List agents: name, card, skills, interfaces |
| `a2a_send` | `text` (required), `agent?`, `contextId?`, `stream?`, `timeoutSec?` | Send a message, return the final answer |
| `a2a_task` | `action` (required: `get`, `cancel`, `list`), `taskId?`, `agent?`, `contextId?` | Read, cancel or list tasks |

`a2a_send` continues a dialogue through `contextId`: it is returned in the reply
and remembered per session and agent, so the next call needs no manual context.

## Panel

**A2A** in the sidebar lists agents as cards: name, connection state, card
description and address. The agent dialog shows metadata, the card, its skills
and a test message; add, edit and delete sit next to it.

Agents come on two levels: profile-wide, and per workspace
(`<workspace>/.dsh/a2a-client.json`). Panel changes are saved immediately and
survive a restart. The panel language follows DSH — Russian, English or Chinese,
switched in **Settings → General → Language** without a restart.

## Security

- The panel route `/a2a-client/api` is guarded by DSH's own
  `ctx.connection.requestRejection`: Host and Origin checks against DNS
  rebinding plus browser session authentication.
- A loopback name is accepted only as a literal `127/8` address, `localhost` or
  `::1`; a name like `127.evil.com` is refused.
- A token never travels to another origin than the card, and never over plain
  `http://` to a remote host; a changed `cardUrl` needs its own token.
- Card reads follow same-origin redirects only; JSON-RPC POST follows none.
- Agent Card, JSON-RPC and SSE responses are capped at 1 / 4 / 8 MB.
- Agent output is wrapped in `--- external A2A agent data ---` frames: it is
  data, not instructions. Treat it as untrusted text.

## Development

No dependencies, no build. Edits to `client.js` apply on page reload, `index.js`
on a DSH restart.

```sh
npm test        # locale + security suites
npm run check   # syntax of both halves
npm publish     # runs check and test first (prepublishOnly)
```

`files` in `package.json` is the whole npm payload: `index.js`, `client.js`,
`cordis.patch.yml`, `locale/*.json`, `icon.svg`, plus the README and license npm
adds. Add a new runtime file to `files` and `exports` together.

## License

[MIT](LICENSE)
