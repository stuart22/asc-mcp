// Stores an App Store Connect .p8 key in the macOS Keychain for asc-mcp.
// Usage: npm run store-key -- /path/to/AuthKey_XXXXXXXXXX.p8 [--key-id XXXXXXXXXX]
//
// The key is passed to `security` over stdin (interactive mode), never as a
// command-line argument, so it doesn't show up in the process list.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { KEYCHAIN_SERVICE } from "../src/config.ts";
import { parsePrivateKey, loadPrivateKey, nodeKeySourceDeps } from "../src/auth/keySource.ts";

function fail(msg: string): never {
  console.error(`store-key: ${msg}`);
  process.exit(1);
}

if (process.platform !== "darwin") {
  fail("the Keychain is macOS-only. On other systems, point ASC_PRIVATE_KEY at a file (chmod 600) or an op:// reference instead.");
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { "key-id": { type: "string" } },
});
const file = positionals[0];
if (!file) fail("usage: npm run store-key -- /path/to/AuthKey_XXXXXXXXXX.p8 [--key-id XXXXXXXXXX]");

const keyId = values["key-id"] ?? /AuthKey_([A-Z0-9]{10})\.p8$/.exec(path.basename(file))?.[1];
if (!keyId || !/^[A-Z0-9]{10}$/.test(keyId)) {
  fail("couldn't work out the key ID from the filename. Pass it with --key-id XXXXXXXXXX.");
}

let text: string;
try {
  text = await readFile(file, "utf8");
} catch {
  fail(`can't read ${file}`);
}
const key = parsePrivateKey(text);
const derB64 = key.export({ format: "der", type: "pkcs8" }).toString("base64");

const code = await new Promise<number | null>((resolve) => {
  const child = spawn("security", ["-i"], { stdio: ["pipe", "ignore", "ignore"] });
  child.on("error", () => resolve(-1));
  child.on("close", resolve);
  // -U updates an existing item for this key ID instead of failing.
  child.stdin.end(`add-generic-password -U -s ${KEYCHAIN_SERVICE} -a ${keyId} -l "asc-mcp ${keyId}" -w ${derB64}\n`);
});
if (code !== 0) fail("the Keychain refused to store the key (is your login keychain unlocked?).");

// Read it back the same way the server will.
const stored = await loadPrivateKey({ kind: "keychain", service: KEYCHAIN_SERVICE, account: keyId }, nodeKeySourceDeps(process.cwd()));
if (stored.export({ format: "der", type: "pkcs8" }).toString("base64") !== derB64) {
  fail("stored the key but couldn't read the same key back. Try again.");
}

console.log(`Stored key ${keyId} in your macOS Keychain (service "${KEYCHAIN_SERVICE}").

Next:
  1. Back up ${path.basename(file)} in your password manager (Apple only lets you download it once),
     then delete the downloaded copy.
  2. Add asc-mcp to Claude with ASC_KEY_ID=${keyId} (see README).`);
