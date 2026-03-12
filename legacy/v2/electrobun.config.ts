export default {
  app: {
    name: "UCM",
    identifier: "com.ucm.v2",
    version: "0.1.0",
  },
  build: {
    bun: { entrypoint: "src/app/index.ts" },
    views: {
      ui: { entrypoint: "src/app/ui/index.ts" },
    },
    copy: {
      "src/app/ui/index.html": "views/ui/index.html",
    },
    mac: {
      bundleCEF: false,
      defaultRenderer: "native",
    },
  },
  runtime: { exitOnLastWindowClosed: false },
};
