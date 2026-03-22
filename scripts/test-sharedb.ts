/**
 * Simple script to test ShareDB connectivity
 * Usage: npx tsx scripts/test-sharedb.ts [docId]
 */
import { WebSocket } from "ws";
import ShareDBClient from "sharedb/lib/client";

const SHAREDB_URL = process.env.SHAREDB_URL || "ws://localhost:8080";
const SHAREDB_COLLECTION = process.env.SHAREDB_COLLECTION || "spreadsheets";
const DOC_ID = process.argv[2] || "test-doc-123";

async function testShareDB() {
  console.log("=== ShareDB Connection Test ===");
  console.log(`URL: ${SHAREDB_URL}`);
  console.log(`Collection: ${SHAREDB_COLLECTION}`);
  console.log(`Document ID: ${DOC_ID}`);
  console.log("");

  return new Promise<void>((resolve, reject) => {
    console.log("1. Connecting to WebSocket...");
    const ws = new WebSocket(SHAREDB_URL);

    const timeout = setTimeout(() => {
      console.log("❌ Connection timeout after 10 seconds");
      ws.close();
      reject(new Error("Timeout"));
    }, 10000);

    ws.on("open", () => {
      console.log("✓ WebSocket connected");
      console.log("");
      console.log("2. Creating ShareDB connection...");

      const connection = new ShareDBClient.Connection(ws as never);
      console.log("✓ ShareDB connection created");
      console.log("");

      console.log("3. Getting document...");
      const doc = connection.get(SHAREDB_COLLECTION, DOC_ID);
      console.log("✓ Document reference obtained");
      console.log("");

      console.log("4. Fetching document...");
      doc.fetch((err) => {
        clearTimeout(timeout);

        if (err) {
          console.log("❌ Fetch error:", err.message);
          try {
            doc.destroy();
          } catch {}
          ws.close();
          reject(err);
          return;
        }

        console.log("✓ Fetch completed");
        console.log("");
        console.log("=== Document Info ===");
        console.log(
          `Type: ${doc.type?.name || "(no type - document may not exist)"}`,
        );
        console.log(`Version: ${doc.version}`);
        console.log(`Data exists: ${doc.data !== undefined}`);

        if (doc.data !== undefined) {
          console.log("");
          console.log("=== Document Data (preview) ===");
          const dataStr = JSON.stringify(doc.data, null, 2);
          console.log(
            dataStr.slice(0, 500) + (dataStr.length > 500 ? "..." : ""),
          );
        } else {
          console.log("");
          console.log("⚠️  Document has no data (might not exist in DB)");
        }

        console.log("");
        console.log("5. Cleaning up...");
        doc.destroy();
        ws.close();
        console.log("✓ Done!");
        resolve();
      });
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      console.log("❌ WebSocket error:", err.message);
      reject(err);
    });

    ws.on("close", () => {
      console.log("WebSocket closed");
    });
  });
}

testShareDB()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
