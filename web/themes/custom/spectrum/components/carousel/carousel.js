/**
 * @file
 * Carousel: previous/next buttons for the scroll-snap track.
 *
 * Buttons scroll by one slide and are disabled at either end. Without JS the
 * track still scrolls and swipes; the buttons simply stay hidden.
 */
((Drupal, once) => {
  Drupal.behaviors.spCarousel = {
    attach(context) {
      once('sp-carousel', '.sp-carousel', context).forEach((carousel) => {
        const track = carousel.querySelector('.sp-carousel__track');
        const prev = carousel.querySelector('.sp-carousel__button--prev');
        const next = carousel.querySelector('.sp-carousel__button--next');
        if (!track || !prev || !next) {
          return;
        }

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

        const slideWidth = () => {
          const slide = track.firstElementChild;
          if (!slide) {
            return track.clientWidth;
          }
          const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
          return slide.getBoundingClientRect().width + gap;
        };

        const update = () => {
          const max = track.scrollWidth - track.clientWidth;
          const scrollable = max > 1;
          prev.hidden = !scrollable;
          next.hidden = !scrollable;
          prev.disabled = track.scrollLeft <= 1;
          next.disabled = track.scrollLeft >= max - 1;
        };

        const go = (direction) => {
          track.scrollBy({
            left: direction * slideWidth(),
            behavior: reduceMotion.matches ? 'auto' : 'smooth',
          });
        };

        prev.addEventListener('click', () => go(-1));
        next.addEventListener('click', () => go(1));
        track.addEventListener('scroll', update, { passive: true });
        track.addEventListener('keydown', (event) => {
          if (event.target !== track) {
            return;
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            go(-1);
          }
          else if (event.key === 'ArrowRight') {
            event.preventDefault();
            go(1);
          }
        });

        if ('ResizeObserver' in window) {
          new ResizeObserver(update).observe(track);
        }
        update();
      });
    },
  };
})(Drupal, once);
