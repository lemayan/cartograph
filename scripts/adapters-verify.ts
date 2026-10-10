import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseFrameworkRepository } from "../lib/adapters/parse-repository";
import { frameworkCategories, roleFiles } from "../lib/adapters/taxonomy";
import { parseRepository } from "../lib/parser/parse";
import { validateParserResult } from "../lib/parser/contract";
import { ownerDirectory } from "../lib/adapters/scope";

async function verify() {
  const root = await mkdtemp(path.join(tmpdir(), "cartograph-adapters-"));
  async function fixture(name: string, files: Record<string, string>) {
    const directory = path.join(root, name); await mkdir(directory);
    for (const [filename, contents] of Object.entries(files)) {
      const destination = path.join(directory, filename); await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, contents);
    }
    return directory;
  }
  async function analyse(directory: string) {
    const result = validateParserResult(await parseFrameworkRepository(directory));
    const generic = await parseRepository(directory);
    assert.deepEqual(result.edges, generic.edges); assert.deepEqual(result.coverage, generic.coverage);
    assert.deepEqual(result.files.map((file) => [file.path, file.hash, file.fanIn, file.fanOut]), generic.files.map((file) => [file.path, file.hash, file.fanIn, file.fanOut]));
    assert.equal(frameworkCategories(result.adapter).reduce((sum, category) => sum + (roleFiles(result.files, result.adapter, category.id)?.size ?? 0), 0), result.files.length);
    for (const route of result.routes ?? []) assert.ok(result.files.some((file) => file.path === route.file && route.line <= file.lines));
    return result;
  }
  try {
    assert.equal(ownerDirectory("a/src/file.ts", [".", "a"]), "a");
    const nextDirectory = await fixture("next", {
      "package.json": '{"dependencies":{"next":"16","react":"19","@nestjs/core":"11"}}',
      "next.config.ts": 'const config = { basePath: "/docs" }; export default config;',
      "app/(public)/page.tsx": 'export default function Page(){return <div/>}',
      "app/users/[id]/page.tsx": 'export const metadata = {};\nexport default function Page(){return <div/>}',
      "app/api/users/route.ts": 'export async function GET(){return null}\nexport const POST = async () => null;',
      "app/@slot/feed/page.tsx": 'export default function Page(){return <div/>}',
      "app/@modal/(.)photo/[id]/page.tsx": 'export default function Page(){return <div/>}',
      "app/_private/page.tsx": 'export default function Page(){return <div/>}',
      "app/layout.tsx": 'export default function Layout(){return <main/>}',
      "actions.ts": '"use server"; export async function save(){return 1}',
      "false-action.ts": 'const value = 1; "use server"; export { value };',
      "pages/articles/[...slug].tsx": 'export default function Article(){return <article/>}',
      "pages/api/legacy.ts": 'export default function handler(req: {method:string}) {if(req.method === "GET") return 1; switch(req.method){case "POST":return 2}}',
      "pages/api/unknown.ts": 'export default function handler(){return 1}',
      "pages/api/nested.ts": 'export default function handler(req:{method:string}) {function unused(req:{method:string}){if(req.method==="DELETE")return 1}return 2}',
      "pages/_app.tsx": 'export default function App(){return <div/>}',
      "components/Button.tsx": 'export function Button(){return <button/>}',
      "hooks/useSettings.ts": 'export function useSettings(){return 1}',
      "contexts/user.ts": 'import {createContext} from "react"; export const User = createContext(null);',
      "examples/react/package.json": '{"dependencies":{"react":"19"}}',
      "examples/react/app/page.tsx": 'export default function Page(){return <div/>}',
    });
    const next = await analyse(nextDirectory);
    assert.equal(next.adapter, "nextjs");
    assert.equal(next.routes?.find((route) => route.path === "/docs/users/[id]")?.line, 2);
    assert.deepEqual(next.routes?.map((route) => [route.method, route.path]).sort(), [
      ["GET", "/docs"], ["GET", "/docs/users/[id]"], ["GET", "/docs/api/users"], ["POST", "/docs/api/users"],
      ["GET", "/docs/feed"], ["GET", "/docs/articles/[...slug]"], ["GET", "/docs/api/legacy"], ["POST", "/docs/api/legacy"],
    ].sort());
    assert.equal(next.files.find((file) => file.path === "actions.ts")?.kind, "action");
    assert.notEqual(next.files.find((file) => file.path === "false-action.ts")?.kind, "action");
    assert.equal(next.files.find((file) => file.path === "examples/react/app/page.tsx")?.kind, null);
    assert.deepEqual(frameworkCategories(next.adapter).slice(0, 3).map((role) => role.label), ["Page routes", "API endpoints", "Server actions"]);
    await writeFile(path.join(nextDirectory, "next.config.ts"), 'export default {basePath:process.env.BASE_PATH};');
    assert.deepEqual((await analyse(nextDirectory)).routes, []);
    await writeFile(path.join(nextDirectory, "next.config.ts"), 'const config={basePath:"/original"}; config.basePath=process.env.BASE_PATH; export default config;');
    assert.deepEqual((await analyse(nextDirectory)).routes, []);
    console.log("PASS: fixed detection order, Next App/Pages patterns, explicit HTTP exports/branches, groups/slots/dynamic segments, private/intercepted/unknown routes omitted, real server directives and package boundaries.");

    const main = 'import { NestFactory } from "@nestjs/core"; import {AppModule} from "./app.module"; async function bootstrap(){const app = await NestFactory.create(AppModule); app.setGlobalPrefix("api"); await app.listen(3000)} void bootstrap();';
    const nestDirectory = await fixture("nest", {
      "package.json": '{"dependencies":{"@nestjs/core":"11","@nestjs/common":"11","react":"19"}}',
      "src/main.ts": main,
      "src/app.module.ts": 'export class AppModule {}',
      "src/users.controller.ts": 'import {Controller as C, Get as G, Post, Version} from "@nestjs/common";\n@C("users") export class Users {\n@G(":id") get(){return 1}\n@Post(["", "new"]) create(){return 1}\n@G(process.env.PATH) unknown(){return 1}\n@Version("1") @G("versioned") versioned(){return 1}\n}',
      "src/fake.controller.ts": 'function Controller(value:string){return ()=>undefined} function Get(value:string){return ()=>undefined} @Controller("fake") export class Fake { @Get("path") get(){return 1} }',
      "src/users.service.ts": 'export class UsersService {}', "src/users.entity.ts": 'export class User {}',
      "src/users.service.spec.ts": 'export const test = 1;',
    });
    const nest = await analyse(nestDirectory); assert.equal(nest.adapter, "nestjs");
    assert.deepEqual(nest.routes?.map((route) => [route.method, route.path]).sort(), [["GET", "/api/users/:id"], ["POST", "/api/users"], ["POST", "/api/users/new"]].sort());
    assert.equal(nest.files.find((file) => file.path === "src/users.service.spec.ts")?.kind, "test");
    assert.deepEqual(frameworkCategories(nest.adapter).slice(0, 4).map((role) => role.label), ["Controllers", "Services", "Modules", "Entities"]);
    for (const configure of ['app.setGlobalPrefix(process.env.PREFIX)', 'if(process.env.PREFIX) app.setGlobalPrefix("api")', 'app.enableVersioning()', 'app.setGlobalPrefix("api",{exclude:["users"]})', 'configureUnknownApplication(app)']) {
      await writeFile(path.join(nestDirectory, "src/main.ts"), main.replace('app.setGlobalPrefix("api")', configure));
      assert.deepEqual((await analyse(nestDirectory)).routes, []);
    }
    console.log("PASS: Nest named/aliased decorators, controller + method + literal global prefix, path arrays, suffix roles, test precedence; dynamic/conditional prefixes, versioning, exclusions and lookalike decorators emit no guessed routes.");

    const reactDirectory = await fixture("react", { "package.json": '{"dependencies":{"react":"19"}}', "src/Button.tsx": 'export function Button(){return <button/>}', "src/useValue.ts": 'export function useValue(){return 1}', "src/utils/math.ts": 'export const n=1;',
      "src/context.ts": 'import R from "react"; export const Context = R.createContext(null);' });
    const react = await analyse(reactDirectory); assert.equal(react.adapter, "react"); assert.deepEqual(react.routes, []);
    assert.equal(react.files.find((file) => file.path === "src/Button.tsx")?.kind, "component");
    assert.equal(react.files.find((file) => file.path === "src/context.ts")?.kind, "context");
    const expressFiles: Record<string, string> = {
      "package.json": '{"dependencies":{"express":"5"}}',
      "src/app.js": 'const router = require("./routes/users");',
      "src/routes/users.js": 'const controller = require("../controllers/users"); router.get("/users", controller.list);',
      "src/controllers/users.js": 'exports.list = () => {};',
      "src/routes/test/users.js": 'exports.test = 1;',
      "src/controllers/users.spec.js": 'exports.test = 1;',
      "packages/other/package.json": '{}',
      "packages/other/controllers/users.js": 'exports.generic = 1;',
      "packages/server/package.json": '{"devDependencies":{"express":"5"}}',
      "packages/server/model/user.js": 'module.exports = {};',
    };
    for (const [role, names] of Object.entries({ route: ["route", "routes", "router", "routers"], controller: ["controller", "controllers"],
      service: ["service", "services"], model: ["model", "models"], middleware: ["middleware", "middlewares"],
      utility: ["util", "utils", "utility", "utilities", "lib", "libs"], test: ["test", "tests"], config: ["config", "configs"] })) {
      for (const name of names) expressFiles[`src/${name}/fixture.js`] = `exports.${role} = 1;`;
    }
    const expressDirectory = await fixture("express", expressFiles);
    const express = await analyse(expressDirectory); assert.equal(express.adapter, "express"); assert.deepEqual(express.routes, []);
    for (const [filename, contents] of Object.entries(expressFiles)) if (filename.endsWith("fixture.js")) {
      assert.equal(express.files.find((file) => file.path === filename)?.kind, contents.match(/exports\.(\w+)/)?.[1]);
    }
    assert.equal(express.files.find((file) => file.path === "src/routes/test/users.js")?.kind, "test");
    assert.equal(express.files.find((file) => file.path === "src/controllers/users.spec.js")?.kind, "test");
    assert.equal(express.files.find((file) => file.path === "src/app.js")?.kind, null);
    assert.equal(express.files.find((file) => file.path === "packages/other/controllers/users.js")?.kind, null);
    assert.equal(express.files.find((file) => file.path === "packages/server/model/user.js")?.kind, "model");
    assert.deepEqual(frameworkCategories(express.adapter).slice(0, 5).map((role) => role.label), ["Routers", "Controllers", "Services", "Models", "Middleware"]);
    await writeFile(path.join(expressDirectory, "package.json"), '{"dependencies":{"express":"5","react":"19"}}');
    assert.equal((await analyse(expressDirectory)).adapter, "react");
    console.log("PASS: Express singular/plural conventions, test precedence, nearest package ownership, real require edges, fixed role counts, existing detection precedence and zero route extraction.");
    const fallback = await analyse(await fixture("generic", { "entry.ts": 'import {n} from "./other";export {n}', "other.ts": 'export const n=1;' }));
    assert.equal(fallback.adapter, "none"); assert.ok(fallback.files.every((file) => file.kind === null)); assert.deepEqual(fallback.routes, []);
    assert.throws(() => validateParserResult({ ...next, routes: [{file:"absent.ts",method:"GET",path:"/",line:1}] }), /Invalid recovered route/);
    assert.throws(() => validateParserResult({ ...next, routes: [{...next.routes?.[0],method:"UNKNOWN"}] }), /Invalid recovered route/);
    const legacy = { ...fallback }; delete legacy.routes; assert.equal(validateParserResult(legacy).routes, undefined);
    console.log("PASS: React roles, generic fallback, unchanged import graph/fan counts/coverage across adapters, exhaustive fixed-order rail counts, route provenance validation and pre-adapter readback.");
  } finally {
    if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir()) || !path.basename(root).startsWith("cartograph-adapters-")) throw new Error("Unsafe adapter fixture cleanup");
    await rm(root, { recursive: true, force: true });
  }
}
verify().catch((error: unknown) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
