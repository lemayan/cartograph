import type { NextConfig } from "next";
import { validateEnvironment } from "./lib/env";

validateEnvironment();

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
