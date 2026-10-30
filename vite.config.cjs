const fs = require("fs");
const path = require("path");

module.exports = {
  // Match the site's clean URLs (for example, /interval-timer).
  appType: "mpa",
  // The API, sign-in and live updates come from the dev server
  // (`npm run dev:server`, see server/README.md).
  server: {
    proxy: {
      "/api": "http://localhost:8090",
      "/auth": "http://localhost:8090",
    },
  },
  plugins: [
    {
      // The prebuilt *-app.js bundles are classic scripts. Vite would treat
      // them as modules and prepend an `import` for any dynamic import()
      // inside, which breaks them, so serve them as-is — exactly as the
      // server does.
      name: "serve-app-bundles-raw",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const match = req.url.match(/^\/([\w-]+-app\.js)(\?.*)?$/);
          const file = match && path.join(__dirname, match[1]);
          if (!file || !fs.existsSync(file)) return next();
          res.setHeader("Content-Type", "text/javascript");
          res.end(fs.readFileSync(file));
        });
      },
    },
  ],
};
