import { validateEnvironment } from "./lib/env";

export function register() {
  validateEnvironment();
}
