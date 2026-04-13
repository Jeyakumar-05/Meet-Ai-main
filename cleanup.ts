import "dotenv/config";
import { db } from "./src/db";
import { meetings } from "./src/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  console.log("Deleting stuck meetings...");
  
  const result = await db.delete(meetings).where(eq(meetings.status, 'processing')).returning();
  
  console.log(`Deleted ${result.length} meetings:`);
  for (const m of result) {
    console.log(` - ${m.name} (Status: ${m.status})`);
  }
  
  process.exit(0);
}

main().catch(console.error);
