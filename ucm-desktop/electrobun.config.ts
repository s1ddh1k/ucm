export default {
  app: {
    name: "UCM",
    identifier: "com.ucm.desktop",
    version: "0.2.0",
  },
  build: {
    bun: { entrypoint: "src/bun/index.ts" },
    views: {
      mainview: { entrypoint: "src/mainview/index.html" },
    },
    copy: {
      "../lib": "ucm/lib",
      "../web/dist": "ucm/web/dist",
      "../templates": "ucm/templates",
      "../node_modules/better-sqlite3": "ucm/node_modules/better-sqlite3",
      "../node_modules/bindings": "ucm/node_modules/bindings",
      "../node_modules/file-uri-to-path": "ucm/node_modules/file-uri-to-path",
      "../node_modules/node-pty": "ucm/node_modules/node-pty",
      "../node_modules/prebuild-install": "ucm/node_modules/prebuild-install",
      "../node_modules/node-addon-api": "ucm/node_modules/node-addon-api",
      "../node_modules/ws": "ucm/node_modules/ws",
    },
    mac: {
      bundleCEF: false,
      defaultRenderer: "native",
      icons: "resources/icon.iconset",
    },
  },
  runtime: { exitOnLastWindowClosed: false },
};
