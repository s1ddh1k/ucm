#!/usr/bin/env node
const { applyDevEnv } = require("./dev-env.js");

applyDevEnv();
require("./ucmd.js");
