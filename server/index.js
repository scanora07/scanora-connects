"use strict";

const config = require("./config");
const { openDb } = require("./db");
const { createApp } = require("./app");

async function main() {
  const db = await openDb(config);
  const app = createApp({ db, config });

  const server = app.listen(config.port, () => {
    console.log("Scanora is running at http://localhost:" + config.port);
    console.log("Admin page:        http://localhost:" + config.port + "/admin/");
    console.log("Gift pages:        http://localhost:" + config.port + "/g/<slug>");
    console.log("Database:          " + db.kind);
    console.log("QR links point to: " + config.baseUrl + "/g/<slug>");
    if (!config.isProd && /localhost/.test(config.baseUrl)) {
      console.log("                   (set PUBLIC_BASE_URL before printing real cards)");
    }
    console.log("Gifts last:        " + config.giftDays + " days after the sender fills the form, then the row is deleted");
    console.log("Cleanup link:      " + (config.cronSecret ? config.baseUrl + "/api/cron/cleanup?key=<CRON_SECRET>  (also shown on the admin page)" : "off (set CRON_SECRET to turn it on)"));
  });

  const stop = () => {
    server.close(() => db.close().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err) => {
  console.error("\nCould not start: " + err.message + "\n");
  process.exit(1);
});
