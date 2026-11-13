import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/** Web app manifest. Colours are the design tokens: Deep green (matches viewport themeColor) and canvas. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.name,
    short_name: "Verified KE",
    description: BRAND.description,
    start_url: "/",
    display: "standalone",
    theme_color: "#087443",
    background_color: "#F7F8F5",
    icons: [
      { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
