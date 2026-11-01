"use client";

import Image, { type ImageLoader } from "next/image";
import { cn } from "@/lib/cn";
import { avatarVariantFor, variantSuffix } from "@/lib/storage/limits";

/** Maps the width next/image asks for to the stored 128 or 384 square. */
const avatarLoader: ImageLoader = ({ src, width }) => `${src}${variantSuffix(avatarVariantFor(width))}`;

const SIZES = {
  xs: { px: 20, text: "text-micro" },
  sm: { px: 32, text: "text-micro" },
  md: { px: 40, text: "text-small" },
  xl: { px: 80, text: "text-title" },
} as const;

export type AvatarSize = keyof typeof SIZES;

/** Up to two initials from a name, e.g. "Greenstone Realty" → "GR". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]![0], words[words.length - 1]![0]] : [words[0]?.[0]];
  return letters.filter(Boolean).join("").toUpperCase();
}

/**
 * A lister's profile photo (prompt lister-avatars), or their initials in a mint circle. Always
 * decorative: the name is rendered next to it, so the image has empty alt text.
 */
export function Avatar({
  name,
  baseUrl,
  size = "sm",
  className,
}: {
  name: string;
  /** Public avatar URL without the variant suffix, or null for initials. */
  baseUrl: string | null;
  size?: AvatarSize;
  className?: string;
}) {
  const { px, text } = SIZES[size];
  const frame = cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full", className);
  if (baseUrl) {
    return (
      <span className={cn(frame, "bg-mint-50")} style={{ width: px, height: px }}>
        <Image src={baseUrl} loader={avatarLoader} alt="" width={px} height={px} className="size-full object-cover" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn(frame, "bg-mint-50 font-semibold leading-none text-emerald-700", text)}
      style={{ width: px, height: px }}
    >
      {initialsOf(name)}
    </span>
  );
}
