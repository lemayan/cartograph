import { loadEnvironment } from "./load-environment";

const root = loadEnvironment();
process.chdir(root);
import("../evals/run").then(({ main }) => main(process.argv.slice(2)))
  .catch((error: unknown) => { console.error(error); process.exitCode = 1; });
