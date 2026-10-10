import type { ParsedFile } from "../parser/types";

export interface RoleCategory { readonly id: string; readonly label: string }
const shared: RoleCategory[] = [
  { id: "utility", label: "Utilities" }, { id: "type", label: "Types" },
  { id: "test", label: "Tests" }, { id: "config", label: "Configuration" }, { id: "generic", label: "Generic files" },
];
const react: RoleCategory[] = [
  { id: "component", label: "Components" }, { id: "hook", label: "Hooks" }, { id: "context", label: "Contexts" }, ...shared,
];
const next: RoleCategory[] = [
  { id: "page", label: "Page routes" }, { id: "route", label: "API endpoints" },
  { id: "action", label: "Server actions" }, { id: "layout", label: "Layouts" }, ...react,
];
const nest: RoleCategory[] = [
  { id: "controller", label: "Controllers" }, { id: "service", label: "Services" },
  { id: "module", label: "Modules" }, { id: "entity", label: "Entities" }, { id: "dto", label: "DTOs" },
  { id: "guard", label: "Guards" }, { id: "interceptor", label: "Interceptors" },
  { id: "middleware", label: "Middleware" }, { id: "pipe", label: "Pipes" }, { id: "filter", label: "Filters" }, ...shared,
];
const express: RoleCategory[] = [
  { id: "route", label: "Routers" }, { id: "controller", label: "Controllers" },
  { id: "service", label: "Services" }, { id: "model", label: "Models" },
  { id: "middleware", label: "Middleware" }, ...shared.filter((role) => role.id !== "type"),
];
export function frameworkCategories(framework: string): readonly RoleCategory[] {
  return framework === "nextjs" ? next : framework === "nestjs" ? nest : framework === "react" ? react : framework === "express" ? express : [shared[shared.length - 1]];
}
export function frameworkLabel(framework: string) {
  return framework === "nextjs" ? "Next.js" : framework === "nestjs" ? "NestJS" : framework === "react" ? "React" : framework === "express" ? "Express" : "Generic";
}
export function roleFiles(files: readonly ParsedFile[], framework: string, category: string | null): Set<string> | null {
  if (category === null) return null;
  const known = new Set(frameworkCategories(framework).map((role) => role.id));
  return new Set(files.filter((file) => category === "generic" ? file.kind === null || !known.has(file.kind) : file.kind === category).map((file) => file.path));
}
