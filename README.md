# Spectrum Canvas

A clone of the layout and page structure of [spectrumtech.com](https://www.spectrumtech.com/), built for JSIN-435 on Drupal 11 with Drupal Canvas and Single Directory Components (SDC).

The reference site was used for layout and structure only. All text and images are placeholders.

## Stack

| | Version |
|---|---|
| Drupal core | 11.4 |
| Drupal Canvas | 1.12 |
| PHP | 8.3 |
| Database | MySQL 8.0 |
| Local environment | Lando (`drupal11` recipe, Apache) |
| Contrib modules | Canvas, Pathauto, Token, Webform |

## Run the site

You need [Lando](https://lando.dev/) and Docker.

```bash
git clone <repository-url> spectrum-canvas
cd spectrum-canvas
lando start
lando composer install
```

Then load the database and files from the dump shared with the ticket:

```bash
lando db-import <path-to-database-dump>.sql.gz
# Unzip the files archive into web/sites/default/files
lando drush cr
lando drush uli
```

The site runs at http://spectrum-canvas.lndo.site. `lando drush uli` prints a one-time admin login link.

## Theme

The custom theme is `web/themes/custom/spectrum`. It has no base theme and is the default theme.

```
spectrum/
├── spectrum.info.yml
├── spectrum.libraries.yml     # global library: design tokens, base and layout CSS
├── spectrum.theme             # maps News fields to the Card component
├── css/                       # base.css (tokens, typography, buttons), layout.css
├── components/                # one folder per SDC
└── templates/
    ├── content/node--news--teaser.html.twig   # News teaser rendered with the Card SDC
    └── navigation/breadcrumb.html.twig        # Breadcrumbs rendered with the Breadcrumb SDC
```

Design tokens (colours, spacing, typography, container width) are CSS custom properties in `css/base.css`. Each component loads its own CSS, and JS only where it needs it.

## Components

There are 16 SDC components. All of them except Breadcrumb are available in the Canvas component library, under the groups below.

### Spectrum: Global

| Component | What it does |
|---|---|
| Site header | Logo, main menu with dropdowns (slot), optional utility area and a CTA button. Sticky, with a mobile menu toggle below 1200px. |
| Site footer | Logo and short text, footer menu columns (slot), contact details, legal links (slot) and a copyright line with the current year. |
| Main content | The `<main>` landmark and the target of the skip link. Used only in the page template. |
| Breadcrumb | Breadcrumb trail. Rendered by the core Breadcrumbs block through the theme template, so it is not in the Canvas library. |

### Spectrum: Sections

| Component | What it does |
|---|---|
| Hero | Page banner with a background image, the H1, text and up to two buttons. Large and compact sizes. |
| Intro text | Eyebrow, heading, formatted text and an optional link. |
| Section | Optional heading and intro, a responsive grid (1 to 4 columns) of items (slot) and an optional button. |
| Image and content | Image on one side and heading, text and button on the other. Image left or right. |
| Carousel | Horizontal slider with previous/next buttons and swipe. Slides go in a slot. |
| Accordion | FAQ section. Accordion items go in a slot. |
| Contact block | Contact details on one side and a form block (slot) on the other. |
| Rich text | A readable column of formatted text. Used for the News body. |
| CTA banner | Full-width call to action with a heading, text and up to two buttons. |

### Spectrum: Items

| Component | What it does |
|---|---|
| Card | Image, title, text and link. Styles: default, news and industry. |
| Stat card | One key figure with a label. |
| Accordion item | One question and answer, using the native `<details>` element. |

## Page template

The Canvas page template **Default** holds the parts shared by every page:

```
Site header
  └── navigation slot: Main navigation menu block
Breadcrumbs
Main content
  ├── Status messages
  └── Page content   ← each page's own content
Site footer
  └── navigation slot: Footer menu block
```

Edit it in Canvas under **Templates → Page templates → Default**. Menu links are edited in Drupal at `/admin/structure/menu/manage/main` and `/admin/structure/menu/manage/footer`.

## Pages

All pages are Canvas pages built from the components above.

| Page | URL | Components |
|---|---|---|
| Home (front page) | `/` | Hero, Section (stats), Intro text, Section, Image and content ×2, Section (latest news), CTA banner |
| About us | `/about-us` | Hero, Intro text, Image and content ×3, Section, CTA banner |
| Leadership | `/leadership` | Hero, Intro text, Section (cards), CTA banner |
| Products | `/products` | Hero, Intro text, Section (cards), Image and content, CTA banner |
| Laser wire markers (product detail) | `/products/laser-wire-markers` | Hero, Intro text, Section (stat cards), Section (feature cards), Image and content, Section (industry cards), Accordion, CTA banner |
| Industries | `/industries` | Hero, Section (industry cards), Carousel, CTA banner |
| Defence (industry detail) | `/industries/defence` | Hero, Intro text, Section (stat cards), Section (cards), Image and content, Section (product cards), Accordion, CTA banner |
| Sample processing | `/sample-processing` | Hero, Section, Image and content, Accordion, CTA banner |
| Technical support | `/technical-support` | Hero, Section, Image and content ×2, CTA banner |
| FAQs | `/resources/faqs` | Hero, Accordion ×3, CTA banner |
| Contact us | `/contact` | Hero, Contact block (with the Contact webform), Section |
| News (listing) | `/news` | Hero, Section with the News listing view, CTA banner |
| News article (detail) | `/news/<title>` | Canvas content template, see below |

## Content-driven pages: News

- **Content type:** News, with Title, Body (with summary), Image and Category.
- **Vocabulary:** News category.
- **URL pattern:** `/news/[title]` (Pathauto).
- **View `news`**, with three block displays:

  | Display | Used on |
  |---|---|
  | All news (paged), 9 per page | `/news` |
  | Latest news (3) | Home page |
  | More news (3, excludes current) | News article page |

- **Teaser:** News teasers render with the Card component (`templates/content/node--news--teaser.html.twig` and `spectrum_preprocess_node()`), so they match the cards built by hand in Canvas.
- **Detail page:** the Canvas content template `node.news.full` maps the fields into Hero, Rich text, a "More news" Section and a CTA banner.

## Contact form

- The form is the Webform **Contact** (`contact`), with Name, Email, Subject and Message, all required.
- On `/contact` it sits in the **Form** slot of the Contact block component, placed in Canvas as a Webform block.
- It submits with AJAX and shows an inline confirmation message on the same page. The separate `/form/contact` page is turned off.
- Submissions are saved in the database: **Structure → Webforms → Contact → Results** (`/admin/structure/webform/manage/contact/results/submissions`).
- The two email handlers (confirmation to the visitor, notification to the site) are turned off, because the local environment has no mail server. Turn them on under **Webforms → Contact → Settings → Emails / Handlers** once mail is set up.
- Form styles (fields, required marker, focus, errors, confirmation) are in `components/contact-block/contact-block.css`.

## Navigation

- **Main menu:** About (About us, Leadership, News and events), Products (Laser wire markers), Industries (Defence), Contract (Sample processing), Support (Technical support, FAQs). Contact is the "Contact us" button in the header.
- **Footer menu:** three columns, Company, What we do and Support. Top-level links are the column headings and their children are listed under them.
- **Breadcrumbs:** on every inner page, with the current page title as the last item.

## Images and performance

- Images use the Canvas image component, which outputs `srcset` and `sizes` and lazy loads images below the fold.
- CSS and JS load per component, so a page only loads the code for the components it uses.
