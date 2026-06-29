// This Expo app is standalone (NOT part of the repo's npm workspaces). Pin Metro to
// resolve modules ONLY from this package's node_modules, so it never picks up the
// repo root's stale/hoisted deps (e.g. an old expo) via monorepo auto-detection.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
