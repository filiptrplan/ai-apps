import postgres from "postgres";

// One pool for the whole server. Sessions run in UTC, so timestamps read
// back as text (see appData.js) and "today" for backups are both in UTC.
export function createDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    max: 10,
    connection: { TimeZone: "UTC", application_name: "ai-apps" },
    onnotice: () => {},
  });
}
