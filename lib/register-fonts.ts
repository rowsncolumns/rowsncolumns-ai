import path from "path";

let fontsRegistered = false;

/**
 * Register Liberation fonts with node-canvas.
 * Liberation Sans is metrically compatible with Arial.
 * Call this once before using canvas for text rendering.
 */
export function registerFonts() {
  if (fontsRegistered) return;

  // Only register in Node.js environment
  if (typeof window !== "undefined") return;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { registerFont } = require("canvas");
    const fontsDir = path.join(process.cwd(), "fonts");

    // Register Liberation Sans as "Arial" (metrically compatible)
    registerFont(path.join(fontsDir, "LiberationSans-Regular.ttf"), {
      family: "Arial",
      weight: "normal",
      style: "normal",
    });
    registerFont(path.join(fontsDir, "LiberationSans-Bold.ttf"), {
      family: "Arial",
      weight: "bold",
      style: "normal",
    });
    registerFont(path.join(fontsDir, "LiberationSans-Italic.ttf"), {
      family: "Arial",
      weight: "normal",
      style: "italic",
    });
    registerFont(path.join(fontsDir, "LiberationSans-BoldItalic.ttf"), {
      family: "Arial",
      weight: "bold",
      style: "italic",
    });

    // Also register as Liberation Sans for explicit usage
    registerFont(path.join(fontsDir, "LiberationSans-Regular.ttf"), {
      family: "Liberation Sans",
      weight: "normal",
      style: "normal",
    });
    registerFont(path.join(fontsDir, "LiberationSans-Bold.ttf"), {
      family: "Liberation Sans",
      weight: "bold",
      style: "normal",
    });

    // Register Liberation Mono (Courier New compatible)
    registerFont(path.join(fontsDir, "LiberationMono-Regular.ttf"), {
      family: "Courier New",
      weight: "normal",
      style: "normal",
    });
    registerFont(path.join(fontsDir, "LiberationMono-Bold.ttf"), {
      family: "Courier New",
      weight: "bold",
      style: "normal",
    });

    fontsRegistered = true;
    console.log("[fonts] Registered Liberation fonts as Arial/Courier New");
  } catch (error) {
    // Canvas not available or fonts not found - graceful degradation
    console.warn("[fonts] Could not register fonts:", error);
  }
}
