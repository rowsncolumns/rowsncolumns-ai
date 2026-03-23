export async function register() {
  // Only run on Node.js (not Edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Register fonts for node-canvas
    const { registerFonts } = await import("./lib/register-fonts");
    registerFonts();
  }
}
