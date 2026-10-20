/**
 * Creates or promotes an admin account for the Admin web.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm run db:seed-admin
 *
 * Re-running is safe: an existing user with the same email (case-insensitive)
 * is promoted to admin, reactivated, and gets the new password.
 */
require("dotenv").config();
const bcrypt = require("bcrypt");
const { Client } = require("pg");

const MIN_PASSWORD_LENGTH = 8;

async function main() {
  const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  const displayName = (process.env.ADMIN_DISPLAY_NAME || "Admin").trim();

  if (!email || !email.includes("@")) {
    throw new Error("ADMIN_EMAIL is required");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  // Same rounds as AuthService so admin and app logins hash alike.
  const rounds = Number(process.env.BCRYPT_ROUNDS || 10);
  const passwordHash = await bcrypt.hash(password, rounds);

  const client = new Client({
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    ssl: process.env.POSTGRES_SSL === "true" ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  try {
    const schema = process.env.POSTGRES_SCHEMA || "public";
    await client.query(`SET search_path TO "${schema.replace(/"/g, '""')}"`);

    const existing = await client.query(
      `SELECT "Id" FROM "AppUser" WHERE LOWER("Email") = $1 AND "DelFlag" = false ORDER BY "Id" LIMIT 1`,
      [email],
    );

    if (existing.rows.length > 0) {
      const id = existing.rows[0].Id;
      await client.query(
        `UPDATE "AppUser"
            SET "Role" = 'admin', "PasswordHash" = $2, "Status" = 1,
                "LoginAttemptCount" = 0, "LockoutUntil" = NULL,
                "PasswordChangedAt" = NOW(), "UpdatedAt" = NOW()
          WHERE "Id" = $1`,
        [id, passwordHash],
      );
      console.log(`Promoted existing user ${id} (${email}) to admin`);
      return;
    }

    const inserted = await client.query(
      `INSERT INTO "AppUser" ("Email", "PasswordHash", "DisplayName", "Role", "Status", "PasswordChangedAt")
       VALUES ($1, $2, $3, 'admin', 1, NOW())
       RETURNING "Id"`,
      [email, passwordHash, displayName],
    );
    console.log(`Created admin user ${inserted.rows[0].Id} (${email})`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`seed-admin failed: ${err.message}`);
  process.exit(1);
});
