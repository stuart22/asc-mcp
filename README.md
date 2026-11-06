# asc-mcp

A read-only [MCP](https://modelcontextprotocol.io) server that lets Claude look things up in App Store Connect: builds, TestFlight, App Store versions and customer reviews.

> What builds are processing for Acme?

It runs locally on your Mac with your own API key. Nothing is hosted, and the key is never logged or sent anywhere but Apple.

## Tools

| Tool | Returns |
|---|---|
| `list_apps` | Apps your key can see |
| `get_app` | One app's details and latest App Store version per platform |
| `list_builds` | Builds with processing status |
| `list_beta_groups` | TestFlight groups |
| `list_beta_testers` | TestFlight testers for an app or group |
| `list_app_store_versions` | App Store versions and their state |
| `list_customer_reviews` | Customer reviews, filterable by stars and country |

Apps can be referred to by name, bundle ID or Apple ID.

## Setup

Requires macOS and Node.js 22.18+.

**1. Install**

```bash
git clone https://github.com/stuart22/asc-mcp.git ~/tools/asc-mcp
```

```bash
cd ~/tools/asc-mcp && npm ci && npm run build
```

**2. Create an API key.** In [App Store Connect](https://appstoreconnect.apple.com), open your profile → **Edit Profile** → **Individual API Key** → **Generate API Key**. Download the `.p8` (you only get one chance) and note the Key ID. The key has your role's access, nothing more; see Apple's [role matrix](https://developer.apple.com/support/roles/) if a tool returns 403.

**3. Store it in the Keychain**

```bash
npm run store-key -- ~/Downloads/AuthKey_XXXXXXXXXX.p8
```

Back up the `.p8` somewhere safe, then delete the downloaded copy.

**4. Add it to Claude**

Claude Code:

```bash
claude mcp add asc --scope user -e ASC_KEY_ID=XXXXXXXXXX -- node ~/tools/asc-mcp/dist/index.js
```

Claude Desktop (`claude_desktop_config.json`, full paths required):

```json
{
  "mcpServers": {
    "asc": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/YOUR_NAME/tools/asc-mcp/dist/index.js"],
      "env": { "ASC_KEY_ID": "XXXXXXXXXX" }
    }
  }
}
```

## Options

| Variable | Purpose |
|---|---|
| `ASC_KEY_ID` | Your Key ID (required) |
| `ASC_PRIVATE_KEY` | Where the key lives: `keychain` (default), a 1Password `op://` reference, or a file path outside this repo with `chmod 600` |
| `ASC_ISSUER_ID` | Only for team keys |

## Security note

Any program running as you can read the Keychain, including Claude's shell tool. Since customer reviews are untrusted text, consider denying key access in `~/.claude/settings.json`:

```json
{ "permissions": { "deny": ["Bash(security find-generic-password:*)", "Bash(security dump-keychain:*)", "Bash(op read:*)"] } }
```

## Development

```bash
npm test
npm run typecheck
ASC_KEY_ID=XXXXXXXXXX npm run smoke -- "Acme"   # calls the real API with your key
```

Contributor rules are in [`CLAUDE.md`](CLAUDE.md).

## License

[MIT](LICENSE)
