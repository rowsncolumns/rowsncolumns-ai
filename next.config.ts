import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@rowsncolumns/spreadsheet-state",
    "@rowsncolumns/grid",
    "@rowsncolumns/ui",
    "@rowsncolumns/spreadsheet",
    "@rowsncolumns/functions",
    "@rowsncolumns/calculation-worker",
    "@rowsncolumns/toolkit",
    "@rowsncolumns/charts",
  ],
};

export default nextConfig;
