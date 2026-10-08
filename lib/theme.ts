export type Theme = "system" | "light" | "dark";

export const themeCookie = "cartograph-theme";

export function readTheme(value: string | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
