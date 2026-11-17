/**
 * @file
 * Site header: mobile menu toggle and accessible dropdown submenus.
 *
 * - Every menu item with a child list gets a <button> that opens it
 *   (aria-expanded / aria-controls), so dropdowns work by keyboard and touch.
 * - On desktop, dropdowns also open on hover/focus via CSS.
 * - Escape closes open submenus and the mobile menu; clicking outside closes
 *   open submenus.
 */
((Drupal, once) => {
  const desktop = window.matchMedia('(min-width: 1024px)');
  let submenuCount = 0;

  Drupal.behaviors.spSiteHeader = {
    attach(context) {
      once('sp-site-header', '.sp-header', context).forEach((header) => {
        const toggle = header.querySelector('.sp-header__toggle');
        const nav = header.querySelector('.sp-header__nav');
        header.classList.add('js-sp-header');

        const setMenuOpen = (open) => {
          header.classList.toggle('is-open', open);
          if (toggle) {
            toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
          }
        };

        const setSubmenuOpen = (item, open) => {
          item.classList.toggle('is-open', open);
          const button = item.querySelector(':scope > .sp-header__sub-toggle');
          if (button) {
            button.setAttribute('aria-expanded', open ? 'true' : 'false');
          }
        };

        const closeSubmenus = (except = null) => {
          header.querySelectorAll('.sp-has-submenu.is-open').forEach((item) => {
            if (item !== except && !item.contains(except)) {
              setSubmenuOpen(item, false);
            }
          });
        };

        if (toggle) {
          toggle.addEventListener('click', () => {
            setMenuOpen(!header.classList.contains('is-open'));
          });
        }

        if (nav) {
          nav.querySelectorAll('li').forEach((item) => {
            const submenu = item.querySelector(':scope > ul');
            const label = item.querySelector(':scope > a, :scope > span');
            if (!submenu || !label) {
              return;
            }
            submenuCount += 1;
            submenu.id = submenu.id || `sp-submenu-${submenuCount}`;
            item.classList.add('sp-has-submenu');

            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'sp-header__sub-toggle';
            button.setAttribute('aria-expanded', 'false');
            button.setAttribute('aria-controls', submenu.id);
            const text = document.createElement('span');
            text.className = 'visually-hidden';
            text.textContent = Drupal.t('Show submenu for @title', {
              '@title': label.textContent.trim(),
            });
            button.appendChild(text);
            label.after(button);

            button.addEventListener('click', () => {
              const open = !item.classList.contains('is-open');
              closeSubmenus(item);
              setSubmenuOpen(item, open);
            });
          });
        }

        header.addEventListener('keydown', (event) => {
          if (event.key !== 'Escape') {
            return;
          }
          const openItem = event.target.closest('.sp-has-submenu.is-open');
          if (openItem) {
            setSubmenuOpen(openItem, false);
            const button = openItem.querySelector(':scope > .sp-header__sub-toggle');
            if (button) {
              button.focus();
            }
          }
          else if (header.classList.contains('is-open')) {
            setMenuOpen(false);
            toggle.focus();
          }
        });

        document.addEventListener('click', (event) => {
          if (!header.contains(event.target)) {
            closeSubmenus();
          }
        });

        desktop.addEventListener('change', () => {
          setMenuOpen(false);
          closeSubmenus();
        });
      });
    },
  };
})(Drupal, once);
