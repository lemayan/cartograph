import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { readTheme, themeCookie } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cartograph",
  description: "Understand a codebase through its real dependencies.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = readTheme((await cookies()).get(themeCookie)?.value);
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body>
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          signInForceRedirectUrl="/start"
          signUpForceRedirectUrl="/start"
          afterSignOutUrl="/sign-in"
          appearance={{
            cssLayerName: "clerk",
            variables: {
              colorPrimary: "var(--accent)",
              colorBackground: "var(--surface)",
              colorForeground: "var(--foreground)",
              colorMutedForeground: "var(--muted)",
              colorInput: "var(--background)",
              colorInputForeground: "var(--foreground)",
              colorBorder: "var(--border)",
              fontFamily: "var(--font-geist-sans)",
              fontSize: "0.8125rem",
              borderRadius: "0.25rem",
            },
          }}
        >
          <a className="skip-link" href="#main-content">Skip to content</a>
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
