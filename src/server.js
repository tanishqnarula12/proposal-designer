"use strict";

/**
 * Render (and other hosts) often use `node src/server.js` from the repo root.
 * The Proposal Designer app lives in `proposal designer/server.js`.
 */
const path = require("path");
require(path.join(__dirname, "..", "proposal designer", "server.js"));
