import Link from "next/link";
import { cookies } from "next/headers";
import { ThemeControl } from "@/components/theme-control";
import { readTheme, themeCookie } from "@/lib/theme";

export async function AuthHeader() {
  const theme = readTheme((await cookies()).get(themeCookie)?.value);
  return (
    <header className="site-header">
      <Link href="/" className="brand">Cartograph</Link>
      <ThemeControl initialTheme={theme} />
    </header>
  );
}
