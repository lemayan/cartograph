import type { Metadata } from "next";
import { AuthHeader } from "@/components/auth-header";
import { MapShell } from "@/components/map-shell";
import { validateParserResult } from "@/lib/parser/contract";
import previewData from "@/data/preview/excalidraw.json";
import "./preview.css";

export const metadata: Metadata = {
  title: "Map preview | Cartograph",
};

export default function PreviewPage() {
  const result = validateParserResult(previewData);
  return (
    <div className="map-preview">
      <AuthHeader />
      <main id="main-content" className="map-preview-viewport" aria-label="Repository map preview" tabIndex={0}>
        <MapShell result={result} />
      </main>
    </div>
  );
}
