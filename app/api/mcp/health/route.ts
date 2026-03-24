export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "rowsncolumns-mcp",
    endpoint: "/api/mcp",
    timestamp: new Date().toISOString(),
  });
}
