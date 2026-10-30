import React, { useRef, useState, useEffect, useCallback } from 'react';

interface CarouselRowProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

export const CarouselRow: React.FC<CarouselRowProps> = ({
  children,
  className = '',
  id,
}) => {
  const rowRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    // Allow 4px margin of error for fractional pixel rounding
    setCanScrollLeft(scrollLeft > 6);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 6);
  }, []);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    checkScroll();
    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => checkScroll());
      observer.observe(el);
    }

    // Re-check after child images/thumbnails load
    const timer = setTimeout(checkScroll, 400);

    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
      observer?.disconnect();
      clearTimeout(timer);
    };
  }, [checkScroll, children]);

  const handleScroll = (direction: 'left' | 'right') => {
    const el = rowRef.current;
    if (!el) return;
    // Scroll ~75% of the visible container width per click
    const scrollAmount = Math.max(280, el.clientWidth * 0.75);
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  return (
    <div id={id} className="relative group/carousel w-full">
      {/* ── Left scroll button ── */}
      {canScrollLeft && (
        <button
          type="button"
          onClick={() => handleScroll('left')}
          className="carousel-btn-left absolute left-0 top-1/2 -translate-y-1/2 z-20 w-9 h-16 sm:w-11 sm:h-24 md:w-12 md:h-28 bg-black/75 hover:bg-black/95 active:bg-brand-600 text-white rounded-r-2xl border-y border-r border-white/20 backdrop-blur-md flex items-center justify-center transition-all duration-200 shadow-2xl opacity-90 md:opacity-0 md:group-hover/carousel:opacity-100 hover:scale-105 active:scale-95 focus:opacity-100 outline-none"
          title="Scroll Left"
          aria-label="Scroll Carousel Left"
        >
          <svg className="w-6 h-6 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      )}

      {/* ── Scrollable row ── */}
      <div
        ref={rowRef}
        className={`scroll-row ${className}`}
        style={{ scrollBehavior: 'smooth' }}
      >
        {children}
      </div>

      {/* ── Right scroll button ── */}
      {canScrollRight && (
        <button
          type="button"
          onClick={() => handleScroll('right')}
          className="carousel-btn-right absolute right-0 top-1/2 -translate-y-1/2 z-20 w-9 h-16 sm:w-11 sm:h-24 md:w-12 md:h-28 bg-black/75 hover:bg-black/95 active:bg-brand-600 text-white rounded-l-2xl border-y border-l border-white/20 backdrop-blur-md flex items-center justify-center transition-all duration-200 shadow-2xl opacity-90 md:opacity-0 md:group-hover/carousel:opacity-100 hover:scale-105 active:scale-95 focus:opacity-100 outline-none"
          title="Scroll Right"
          aria-label="Scroll Carousel Right"
        >
          <svg className="w-6 h-6 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default CarouselRow;

