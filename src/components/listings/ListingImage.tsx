"use client";

import Image, { type ImageLoader } from "next/image";
import { House } from "lucide-react";
import { cn } from "@/lib/cn";
import { variantFor, variantSuffix } from "@/lib/storage/limits";

/** Maps the width next/image asks for to the smallest stored WebP variant that covers it. */
const variantLoader: ImageLoader = ({ src, width }) => `${src}${variantSuffix(variantFor(width))}`;

/**
 * A listing photo in a 4:3 frame (prompt S4 decision 9). `baseUrl` is the photo's public URL
 * without its variant suffix; the loader picks 480, 960 or 1600 per `sizes`, so there is no
 * runtime image optimisation. Without a photo it shows a thin house icon on the placeholder tint.
 */
export function ListingImage({
  baseUrl,
  alt,
  sizes,
  preload = false,
  fit = "cover",
  className,
}: {
  baseUrl: string | null;
  alt: string;
  sizes: string;
  preload?: boolean;
  /** `contain` shows the whole photo (full-screen gallery); `cover` fills the frame. */
  fit?: "cover" | "contain";
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-[4/3] overflow-hidden bg-mint-100", className)}>
      {baseUrl ? (
        <Image
          src={baseUrl}
          loader={variantLoader}
          alt={alt}
          fill
          sizes={sizes}
          preload={preload}
          className={fit === "contain" ? "object-contain" : "object-cover"}
        />
      ) : (
        <div role="img" aria-label={alt || undefined} aria-hidden={alt ? undefined : true} className="flex size-full items-center justify-center">
          <House aria-hidden="true" className="size-1/5 max-h-16 max-w-16 text-slate-500 [stroke-width:1]" />
        </div>
      )}
    </div>
  );
}
