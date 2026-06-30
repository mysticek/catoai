#!/usr/bin/env node
/**
 * `cato pair` — show the pairing QR + token to add another phone, without re-running the
 * full onboarding. Requires the machine to already be set up (`cato setup`).
 */
import { showPairing } from "./lib-pairing.mjs";

console.log("\n  \x1b[1mCato pair\x1b[0m — add a device");
process.exit(showPairing() ? 0 : 1);
