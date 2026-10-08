import type { ComponentProps } from "react";
import type { SignIn } from "@clerk/nextjs";

export const authAppearance = {
  theme: "simple",
  options: {
    animations: false,
    elevation: "flush",
    socialButtonsVariant: "blockButton",
    socialButtonsPlacement: "top",
  },
  elements: {
    rootBox: "auth-clerk-root",
    cardBox: "auth-clerk-box",
    card: "auth-clerk-card",
    headerTitle: "auth-clerk-title",
    headerSubtitle: "auth-clerk-subtitle",
    socialButtonsBlockButton: "auth-clerk-social",
    formFieldInput: "auth-clerk-input",
    formButtonPrimary: "auth-clerk-primary",
    footer: "auth-clerk-footer",
  },
} satisfies NonNullable<ComponentProps<typeof SignIn>["appearance"]>;
