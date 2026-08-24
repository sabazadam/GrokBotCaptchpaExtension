export { CapsolverClient, CapsolverError } from "./capsolver/client.js";
export type { CapsolverClientOptions } from "./capsolver/client.js";
export type {
  CapsolverTask,
  CapsolverCreateTaskResponse,
  CapsolverGetTaskResultResponse,
  CapsolverTaskStatus,
} from "./capsolver/types.js";
export { buildCapsolverTask, BuildTaskError } from "./solve/buildTask.js";
export { solveCaptcha, normalizeSolution } from "./solve/solveService.js";
export { loadConfig } from "./config.js";
export type { AppConfig, CapsolverConfig } from "./config.js";
