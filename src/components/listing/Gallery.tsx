"use client";

import { useRef, useState, type TouchEvent } from "react";
import { ChevronLeft, ChevronRight, Images, X } from "lucide-react";
import { ListingImage } from "@/components/listings/ListingImage";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface GalleryPhoto {
  /** Public base URL without the variant suffix, or null when photos can't be served. */
  baseUrl: string | null;
  alt: string;
}

const MOSAIC_TILES = 4;
const SWIPE_PX = 50;

/**
 * Listing photos (prompt S8 decision 8).
 * - Desktop: the design's mosaic, a large cover and up to four tiles, with "View all N photos".
 * - Mobile: a scroll-snap strip; swiping is native and needs no JavaScript.
 * - Full-screen viewer: a modal <dialog> with previous/next buttons, arrow keys, swipe and a live
 *   counter. Escape closes it and focus returns to the opener (native <dialog> behaviour).
 */
export function Gallery({ photos, title }: { photos: GalleryPhoto[]; title: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const touchX = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const count = photos.length;

  if (count === 0) {
    return <ListingImage baseUrl={null} alt={`No photos yet for ${title}`} sizes="100vw" className="rounded-xl lg:aspect-[16/7]" />;
  }

  const go = (next: number) => setIndex(((next % count) + count) % count);
  const open = (at: number) => {
    setIndex(at);
    dialogRef.current?.showModal();
  };
  const onTouchStart = (event: TouchEvent) => {
    touchX.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = touchX.current;
    const end = event.changedTouches[0]?.clientX;
    touchX.current = null;
    if (start == null || end == null || Math.abs(end - start) < SWIPE_PX) return;
    go(end < start ? index + 1 : index - 1);
  };

  const tiles = photos.slice(1, 1 + MOSAIC_TILES);
  const current = photos[index]!;

  return (
    <section aria-label="Photos">
      {/* Mobile: native swipe strip. */}
      <ul className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 motion-safe:scroll-smooth md:-mx-6 md:px-6 lg:hidden">
        {photos.map((photo, i) => (
          <li key={i} className="w-[88%] shrink-0 snap-center sm:w-[70%]">
            <button
              type="button"
              onClick={() => open(i)}
              aria-label={`Open photo ${i + 1} of ${count}: ${photo.alt}`}
              className="block w-full overflow-hidden rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              <ListingImage baseUrl={photo.baseUrl} alt={photo.alt} sizes="90vw" preload={i === 0} />
            </button>
          </li>
        ))}
      </ul>
      {count > 1 && (
        <p className="mt-2 text-caption text-slate-600 lg:hidden">
          {count} photos · swipe to see more
        </p>
      )}

      {/* Desktop: mosaic. */}
      <div className={cn("hidden h-[28rem] gap-4 lg:grid", tiles.length > 0 ? "grid-cols-4 grid-rows-2" : "grid-cols-1")}>
        <button
          type="button"
          onClick={() => open(0)}
          aria-label={`Open photo 1 of ${count}: ${photos[0]!.alt}`}
          className={cn(
            "relative overflow-hidden rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600",
            tiles.length > 0 && "col-span-2 row-span-2",
          )}
        >
          <ListingImage baseUrl={photos[0]!.baseUrl} alt={photos[0]!.alt} sizes="(min-width: 1280px) 640px, 50vw" preload className="aspect-auto h-full" />
        </button>
        {tiles.map((photo, i) => (
          <button
            key={i}
            type="button"
            onClick={() => open(i + 1)}
            aria-label={`Open photo ${i + 2} of ${count}: ${photo.alt}`}
            className="relative overflow-hidden rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            <ListingImage baseUrl={photo.baseUrl} alt={photo.alt} sizes="320px" className="aspect-auto h-full" />
          </button>
        ))}
      </div>
      {count > 1 && (
        <div className="mt-3 hidden justify-end lg:flex">
          <button
            type="button"
            onClick={() => open(0)}
            className="inline-flex min-h-control items-center gap-2 rounded-md border border-line-strong bg-white px-4 text-button text-ink hover:border-ink"
          >
            <Images aria-hidden="true" className="size-4" />
            View all {count} photos
          </button>
        </div>
      )}

      <dialog
        ref={dialogRef}
        aria-label={`Photos of ${title}`}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") go(index - 1);
          if (event.key === "ArrowRight") go(index + 1);
        }}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-ink p-0 text-white backdrop:bg-ink/80"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-header shrink-0 items-center justify-between px-4">
            <p aria-live="polite" className="text-body-sm font-medium">
              {index + 1} / {count}
            </p>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="inline-flex size-control items-center justify-center rounded-md text-white hover:bg-white/10"
            >
              <X aria-hidden="true" className="size-6" />
              <span className="sr-only">Close photos</span>
            </button>
          </div>
          <div className="relative min-h-0 flex-1" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <ListingImage
              key={index}
              baseUrl={current.baseUrl}
              alt={current.alt}
              sizes="100vw"
              fit="contain"
              className="aspect-auto h-full bg-transparent"
            />
            {count > 1 && (
              <>
                <IconButton
                  label="Previous photo"
                  icon={<ChevronLeft />}
                  onClick={() => go(index - 1)}
                  variant="secondary"
                  className="absolute left-3 top-1/2 -translate-y-1/2"
                />
                <IconButton
                  label="Next photo"
                  icon={<ChevronRight />}
                  onClick={() => go(index + 1)}
                  variant="secondary"
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                />
              </>
            )}
          </div>
          <p className="shrink-0 px-4 py-3 text-center text-body-sm text-white/80">{current.alt}</p>
        </div>
      </dialog>
    </section>
  );
}
