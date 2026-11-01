"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type TouchEvent } from "react";
import { ChevronLeft, ChevronRight, Maximize2, X } from "lucide-react";
import { ListingImage } from "@/components/listings/ListingImage";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface GalleryPhoto {
  /** Public base URL without the variant suffix, or null when photos can't be served. */
  baseUrl: string | null;
  alt: string;
}

const SWIPE_PX = 50;

/** Spans for photos 2–5 in the mosaic's right-hand 2×2 area, by how many there are. */
const TILE_SPANS: Record<number, string[]> = {
  1: ["col-span-2 row-span-2"],
  2: ["col-span-2", "col-span-2"],
  3: ["", "", "col-span-2"],
  4: ["", "", "", ""],
};

const FOCUS_RING =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600";

/**
 * Listing photos (design "03 — Property Detail"; prompt ui-design-cards-detail decision 7).
 * - From `lg`: a mosaic of one large photo and up to four tiles, with "View all N photos" on the
 *   last tile. Every tile opens the full-screen viewer at its photo.
 * - Below `lg`: a large photo with previous/next buttons, swipe and a "2 / 5" counter, and a
 *   scrollable row of thumbnails; the current one is outlined and kept in view, and arrow keys
 *   move along the row.
 * - The full-screen viewer is a modal <dialog>. Escape closes it and focus returns to the opener
 *   (native <dialog> behaviour).
 */
export function Gallery({ photos, title }: { photos: GalleryPhoto[]; title: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const thumbsRef = useRef<HTMLUListElement>(null);
  const touchX = useRef<number | null>(null);
  const [index, setIndex] = useState(0);
  const count = photos.length;

  // Keep the current thumbnail in view without scrolling the page.
  useEffect(() => {
    const list = thumbsRef.current;
    const thumb = list?.children[index] as HTMLElement | undefined;
    if (!list || !thumb) return;
    const left = thumb.offsetLeft - list.offsetLeft;
    if (left < list.scrollLeft || left + thumb.offsetWidth > list.scrollLeft + list.clientWidth) {
      list.scrollTo({ left: left - (list.clientWidth - thumb.offsetWidth) / 2 });
    }
  }, [index]);

  if (count === 0) {
    return <ListingImage baseUrl={null} alt={`No photos yet for ${title}`} sizes="100vw" className="rounded-xl border border-line lg:aspect-[16/7]" />;
  }

  const go = (next: number) => setIndex(((next % count) + count) % count);
  const openViewer = () => dialogRef.current?.showModal();
  const openViewerAt = (i: number) => {
    setIndex(i);
    openViewer();
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
  const onArrowKeys = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") go(index - 1);
    if (event.key === "ArrowRight") go(index + 1);
  };
  /** Arrow keys on the thumbnail row move the selection and the focus together. */
  const onThumbKeys = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = (((event.key === "ArrowRight" ? index + 1 : index - 1) % count) + count) % count;
    setIndex(next);
    thumbsRef.current?.querySelectorAll("button")[next]?.focus();
  };

  const current = photos[index]!;
  const position = `${index + 1} / ${count}`;
  const arrows = (tone: "light" | "dark") =>
    count > 1 && (
      <>
        <IconButton
          label="Previous photo"
          icon={<ChevronLeft />}
          onClick={() => go(index - 1)}
          variant="secondary"
          className={cn("absolute left-3 top-1/2 -translate-y-1/2", tone === "light" && "bg-white/90")}
        />
        <IconButton
          label="Next photo"
          icon={<ChevronRight />}
          onClick={() => go(index + 1)}
          variant="secondary"
          className={cn("absolute right-3 top-1/2 -translate-y-1/2", tone === "light" && "bg-white/90")}
        />
      </>
    );

  return (
    <section aria-label="Photos" className="flex flex-col gap-3 lg:gap-0">
      <p aria-live="polite" className="sr-only">
        Photo {index + 1} of {count}: {current.alt}
      </p>

      <Mosaic photos={photos} onOpen={openViewerAt} />

      <div className="relative lg:hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button
          type="button"
          onClick={openViewer}
          aria-label={`Open photo ${index + 1} of ${count} full screen: ${current.alt}`}
          className={cn("block w-full overflow-hidden rounded-xl border border-line", FOCUS_RING)}
        >
          <ListingImage
            key={index}
            baseUrl={current.baseUrl}
            alt={current.alt}
            sizes="(min-width: 1280px) 1152px, 100vw"
            preload={index === 0}
            className="lg:aspect-auto lg:h-[32rem]"
          />
        </button>
        {arrows("light")}
        <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-ink/75 px-3 py-1 text-micro font-medium text-white">
          {position}
        </span>
        <IconButton
          label="View photos full screen"
          icon={<Maximize2 />}
          onClick={openViewer}
          variant="secondary"
          className="absolute right-3 top-3 bg-white/90"
        />
      </div>

      {count > 1 && (
        <ul
          ref={thumbsRef}
          aria-label={`All ${count} photos`}
          onKeyDown={onThumbKeys}
          className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 py-1 motion-safe:scroll-smooth lg:hidden"
        >
          {photos.map((photo, i) => (
            <li key={i} className="shrink-0 snap-start">
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show photo ${i + 1} of ${count}: ${photo.alt}`}
                aria-current={i === index ? "true" : undefined}
                tabIndex={i === index ? 0 : -1}
                className={cn(
                  "block w-20 overflow-hidden rounded-md ring-2 ring-offset-2 transition md:w-28",
                  i === index ? "ring-emerald-600" : "opacity-75 ring-transparent hover:opacity-100",
                  FOCUS_RING,
                )}
              >
                <ListingImage baseUrl={photo.baseUrl} alt="" sizes="112px" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <dialog
        ref={dialogRef}
        aria-label={`Photos of ${title}`}
        onKeyDown={onArrowKeys}
        className="m-0 h-dvh max-h-none w-full max-w-none bg-ink p-0 text-white backdrop:bg-ink/80"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-[66px] shrink-0 items-center justify-between px-4">
            <p className="text-small font-medium">{position}</p>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="inline-flex size-control items-center justify-center rounded-md text-white hover:bg-white/10"
            >
              <X aria-hidden="true" className="size-5" />
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
            {arrows("dark")}
          </div>
          <p className="shrink-0 px-4 py-3 text-center text-small text-white/80">{current.alt}</p>
        </div>
      </dialog>
    </section>
  );
}

/** Desktop mosaic: photo 1 large on the left, photos 2–5 in a 2×2 area on the right. */
function Mosaic({ photos, onOpen }: { photos: GalleryPhoto[]; onOpen: (index: number) => void }) {
  const count = photos.length;
  const tiles = photos.slice(1, 5);
  const spans = TILE_SPANS[tiles.length] ?? [];
  const tileClasses = cn("relative block overflow-hidden rounded-xl", FOCUS_RING);
  const tileLabel = (i: number) => `Open photo ${i + 1} of ${count} full screen: ${photos[i]!.alt}`;

  return (
    <div className="hidden h-[27rem] grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)] grid-rows-2 gap-4 lg:grid">
      <button
        type="button"
        onClick={() => onOpen(0)}
        aria-label={tileLabel(0)}
        className={cn(tileClasses, "row-span-2", tiles.length === 0 && "col-span-3")}
      >
        <ListingImage
          baseUrl={photos[0]!.baseUrl}
          alt={photos[0]!.alt}
          sizes="(min-width: 1024px) 60vw, 100vw"
          preload
          className="aspect-auto h-full"
        />
      </button>
      {tiles.map((photo, t) => {
        const i = t + 1;
        const last = t === tiles.length - 1;
        return (
          <div key={i} className={cn("relative min-h-0", spans[t])}>
            <button type="button" onClick={() => onOpen(i)} aria-label={tileLabel(i)} className={cn(tileClasses, "size-full")}>
              <ListingImage baseUrl={photo.baseUrl} alt={photo.alt} sizes="(min-width: 1024px) 20vw, 50vw" className="aspect-auto h-full" />
            </button>
            {last && (
              <button
                type="button"
                onClick={() => onOpen(0)}
                className={cn(
                  "absolute bottom-4 right-4 inline-flex min-h-8 items-center rounded-lg bg-white px-4 text-small font-medium text-ink hover:bg-mint-50",
                  FOCUS_RING,
                )}
              >
                View all {count} photos
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
