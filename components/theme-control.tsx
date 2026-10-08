"use client";

import { useState } from "react";
import { readTheme, themeCookie, type Theme } from "@/lib/theme";

export function ThemeControl({ initialTheme }: { initialTheme: Theme }) {
  const [theme, setTheme] = useState(initialTheme);

  function changeTheme(value: string) {
    const nextTheme = readTheme(value);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${themeCookie}=${nextTheme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    document.documentElement.dataset.theme = nextTheme;
    setTheme(nextTheme);
  }

  return (
    <label className="theme-control">
      <span>Theme</span>
      <select value={theme} onChange={(event) => changeTheme(event.target.value)}>
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
