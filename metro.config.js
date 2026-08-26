// metro.config.js
//
// Exists for one reason: to pin the export conditions Metro resolves
// package.json "exports" with, per platform.
//
// firebase/auth is a single specifier that resolves to a different build per
// platform. The 'react-native' condition selects the build carrying
// getReactNativePersistence, which is what lets a signed-in session survive an
// app restart. Lose that condition and the resolver quietly falls through to
// the web build, auth degrades to in-memory only, and every cold start looks
// like the user was signed out.
//
// This has to be set per-platform rather than in unstable_conditionNames:
// @firebase/auth lists "react-native" ahead of "browser" in its exports map,
// and conditions are matched in the map's own order, so a global
// 'react-native' would hand the web bundle the native build as well.
//
// Expo's default config already does this. Stating it here means the app's
// login persistence no longer depends on that default staying put across SDK
// upgrades.

const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const byPlatform = config.resolver.unstable_conditionsByPlatform ?? {};
for (const platform of ['ios', 'android', 'native']) {
  const current = byPlatform[platform] ?? [];
  if (!current.includes('react-native')) {
    byPlatform[platform] = [...current, 'react-native'];
  }
}
config.resolver.unstable_conditionsByPlatform = byPlatform;

module.exports = config;
