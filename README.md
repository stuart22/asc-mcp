# asc-mcp

A read-only [MCP](https://modelcontextprotocol.io) server that lets Claude look things up in App Store Connect: builds, TestFlight, store listings, in-app events, reviews and everything else in Apple's App Store Connect API.

> What builds are processing for Acme?
> Show me the German listing text for the next version.

It runs locally on your Mac with your own API key. Nothing is hosted, and the key is never logged or sent anywhere but Apple.

## Tools

One tool per App Store Connect area. Called without a look-up, each tool lists what it can look up, so Claude finds its way around on its own. Everyday look-ups (builds, listings, TestFlight feedback, reviews…) come back tidied for reading; everything else in Apple's API is reachable too, in a compact general format.

| Tool | Covers |
|---|---|
| `apps` | Apps, app info, categories, age rating, EULA, declarations, tags |
| `product_page` | App Store versions, listing text, screenshots, previews, App Review details, phased release |
| `custom_product_pages` | Custom product pages and product page experiments |
| `in_app_events` | Events, localizations, media |
| `testflight` | Groups, testers, group builds, public links, beta review, feedback and crash reports |
| `builds` | Builds, pre-release versions, uploads, metrics, diagnostics, background assets |
| `in_app_purchases` | Products, localizations, prices, availability, offer codes, promoted purchases |
| `subscriptions` | Groups, subscriptions, offers, offer codes, prices, retention messages |
| `pricing` | App price schedules, price points, availability, territories |
| `reviews` | Customer reviews and responses |
| `xcode_cloud` | Products, workflows, build runs, artifacts, issues, test results |
| `reports` | Analytics report listings, sales and finance reports |
| `users` | Users and invitations |
| `game_center` | Everything Game Center |
| `app_clips` | App Clips and experiences |
| `certificates_and_distribution` | Certificates, bundle IDs, devices, profiles, alternative distribution, webhooks |

Apps can be referred to by name, bundle ID or Apple ID. What you can see depends on your App Store Connect role.

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
| `ASC_HIDE_AREAS` | Tools to leave out, comma-separated (e.g. `game_center,xcode_cloud`) |

## Security note

The server only reads. It never shows App Review demo-account passwords, signed download or upload links, or certificate and profile contents. Text written by customers or testers is labelled so Claude treats it as quotes, not instructions.

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

The look-up catalog (`src/catalog/catalog.json`) is generated from Apple's App Store Connect OpenAPI spec. To refresh it, download the spec from [developer.apple.com](https://developer.apple.com/documentation/appstoreconnectapi) and run:

```bash
npm run catalog -- path/to/openapi.oas.json
```

Contributor rules are in [`CLAUDE.md`](CLAUDE.md).

## License

[MIT](LICENSE)
