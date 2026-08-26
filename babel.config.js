// babel.config.js
//
// Created only because react-native-reanimated needs its own Babel plugin —
// everything else about this project's transforms comes from babel-preset-expo,
// which is why this file didn't exist before ChatListScreen needed a swipeable
// row smooth enough that the timestamp doesn't lag behind the delete panel.
//
// 'react-native-reanimated/plugin' must be listed last: it rewrites worklets
// (anything reanimated runs on the UI thread) after every other transform has
// already run, so it needs to see the fully-transformed code.
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-reanimated/plugin'],
  };
};
