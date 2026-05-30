import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  apiPort: Number(process.env.PORT || 4100),
  appName: process.env.APP_NAME || "VoxLume",
  databaseUrl: process.env.DATABASE_URL || "",
  rootDir,
  clientDistDir: path.join(rootDir, "dist"),
};
