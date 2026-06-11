import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, sqlite } from './db.js';

console.log("Spouštím migrace...");
try {
  migrate(db, { migrationsFolder: './db/migrations' });
  console.log("Migrace úspěšně proběhly.");
} catch (error) {
  console.error("Při migraci nastala chyba:", error);
  process.exit(1);
} finally {
  sqlite.close();
  console.log("Spojení s databází bylo uzavřeno.");
}