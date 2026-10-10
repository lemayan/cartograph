import type { AdapterFile, FrameworkAdapter } from "../parser/types";
import { genericConvention } from "./react";
import { ownerDirectory, relativeTo } from "./scope";

const folders = new Map(Object.entries({
  route: "route", routes: "route", router: "route", routers: "route",
  controller: "controller", controllers: "controller", service: "service", services: "service",
  model: "model", models: "model", middleware: "middleware", middlewares: "middleware",
  util: "utility", utils: "utility", utility: "utility", utilities: "utility", lib: "utility", libs: "utility",
  test: "test", tests: "test", __tests__: "test", config: "config", configs: "config",
}));

export function createExpressAdapter(roots: readonly string[], directories: readonly string[]): FrameworkAdapter {
  return {
    name: "express",
    classify(file: Readonly<AdapterFile>) {
      const owner = ownerDirectory(file.path, directories);
      if (owner === null || !roots.includes(owner)) return null;
      const local = { ...file, path: relativeTo(file.path, owner) };
      const conventional = genericConvention(local);
      if (conventional === "test" || conventional === "config") return conventional;
      // The closest role folder describes the file, but a test folder always wins.
      const parts = local.path.split("/").slice(0, -1);
      if (parts.some((part) => folders.get(part) === "test")) return "test";
      for (const part of parts.reverse()) {
        const role = folders.get(part);
        if (role) return role;
      }
      return null;
    },
    // Express mounts and middleware compose at runtime; no complete paths are claimed.
    routes: () => [],
  };
}
