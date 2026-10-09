import type { FrameworkAdapter } from "./types";

export const fallbackAdapter: FrameworkAdapter = {
  name: "none",
  classify: () => null,
};
