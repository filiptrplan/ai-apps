// Compiles every *-app.jsx source file in the repo root into a plain
// React.createElement-based *-app.js bundle, ready to be loaded directly
// in a static HTML page (alongside the React/ReactDOM UMD scripts).
const { build } = require("esbuild");
const { globSync } = require("fs");
const path = require("path");

const entryPoints = globSync("*-app.jsx", { cwd: __dirname });

if (entryPoints.length === 0) {
  console.log("No *-app.jsx files found.");
  process.exit(0);
}

Promise.all(
  entryPoints.map((entry) =>
    build({
      entryPoints: [entry],
      outfile: entry.replace(/\.jsx$/, ".js"),
      absWorkingDir: __dirname,
      jsx: "transform",
      format: "iife",
      target: "es2019",
      bundle: false,
    }).then(() => console.log(`built ${entry} -> ${entry.replace(/\.jsx$/, ".js")}`))
  )
).catch((err) => {
  console.error(err);
  process.exit(1);
});
