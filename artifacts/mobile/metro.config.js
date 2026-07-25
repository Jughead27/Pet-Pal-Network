const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Exclude pnpm post-install tmp directories from Metro's file watcher.
// @clerk/shared and other packages create _tmp_NNNN directories during their
// postinstall scripts and delete them immediately — Metro's FallbackWatcher
// crashes with ENOENT if it tries to watch those directories.
config.resolver.blockList = [/_tmp_\d+/];

module.exports = config;
