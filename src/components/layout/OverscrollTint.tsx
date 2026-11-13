"use client";

import { useEffect } from "react";

const ATTRIBUTE = "data-overscroll";
const END = "end";

/**
 * iOS Safari fills the rubber-band area past either end of the page with one colour: the root
 * (`html`) background. That can't match both the white header and the Charcoal footer, so this
 * marks `<html data-overscroll="end">` while the page is scrolled past halfway (the only place a
 * bottom bounce can start) and globals.css paints `html` Charcoal then, white otherwise. Body
 * keeps its own canvas background, so the page itself never changes colour.
 */
export function OverscrollTint() {
  useEffect(() => {
    const root = document.documentElement;

    function update() {
      const maxScroll = root.scrollHeight - window.innerHeight;
      const nearEnd = maxScroll > 0 && window.scrollY > maxScroll / 2;
      if (nearEnd === root.hasAttribute(ATTRIBUTE)) return;
      if (nearEnd) root.setAttribute(ATTRIBUTE, END);
      else root.removeAttribute(ATTRIBUTE);
    }

    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      root.removeAttribute(ATTRIBUTE);
    };
  }, []);

  return null;
}
