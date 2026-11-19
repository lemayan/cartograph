import path from "node:path";
import { loadEnvConfig } from "@next/env";

// The compiled script stays under .cartograph/<target>/scripts. Resolve the app,
// not the caller's working directory or a neighbouring project's .env.local.
export function loadEnvironment() {
  const root = path.resolve(__dirname, "../../..");
  loadEnvConfig(root, process.env.NODE_ENV !== "production");
  return root;
}
