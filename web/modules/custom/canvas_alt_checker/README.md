# Canvas Image Alt Checker

A Drupal Canvas extension that lists every image on the page you are editing,
shows whether each one has alt text, and lets you add or update the alt text
without leaving the editor.

## Requirements

- Drupal 11.3 or later
- Drupal Canvas module (`drupal/canvas`, tested with 1.12), enabled
- Images added through Media (Media type "Image") or an image field

## Install

1. Unzip so the folder sits at `web/modules/custom/canvas_alt_checker/`
   (the folder must contain `canvas_alt_checker.info.yml` directly).
2. Enable the module and clear caches:

   ```bash
   drush en canvas_alt_checker -y
   drush cr
   ```

   With Lando or DDEV, prefix the commands: `lando drush …` / `ddev drush …`.
   Without Drush: Extend (`/admin/modules`) → tick "Canvas Alt Checker" →
   Install.

## Use

1. Log in and open any page in the Canvas editor.
2. In the left side menu click **Extensions** (puzzle icon) →
   **Image Alt Checker**.
3. The dialog lists all images on the page:
   - **✓ Alt present** shows the alt text; a yellow note flags unhelpful alt
     (e.g. "image", a file name, or very long text).
   - **✗ Alt missing** means the image has no alt text.
   - Filter with **All / Alt missing / Alt present**.
4. Click **Add alt text** / **Edit alt text**, type, and press **Save**
   (or Enter). The alt is saved on the image's Media item as a new revision,
   so every page that uses the image gets it.
5. Reload the editor to see the new alt in the Canvas preview.

To test a missing alt: Structure → Media types → Image → Manage fields →
Image → untick "Alt field required", clear the alt on a Media item, then
open a page that uses it. Turn the setting back on afterwards.

## Notes

- You need permission to edit the Media item (or content) that holds the
  image. Images from the theme, code components or external URLs are listed
  but cannot be edited here.
- The included `.htaccess` stops Apache from caching the extension files for
  a year. On Nginx, add an equivalent `Cache-Control: no-cache` rule for this
  folder, or hard-reload after updating the module.

## Troubleshooting

- **No "Extensions" button in Canvas:** run `drush cr` and hard-reload
  (Cmd/Ctrl+Shift+R).
- **Old version still shows after an update:** open DevTools → Network →
  tick "Disable cache", then reload.
- **"Can't edit here: …":** the reason is shown; usually missing permission
  or the image is not a Media/image-field file.
