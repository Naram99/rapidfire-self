# Local fonts

Bebas Neue, DM Sans and DM Mono are distributed under the included SIL Open
Font License files. Sources are the Google Fonts repository:

- [Bebas Neue](https://github.com/google/fonts/tree/main/ofl/bebasneue)
- [DM Sans](https://github.com/google/fonts/tree/main/ofl/dmsans)
- [DM Mono](https://github.com/google/fonts/tree/main/ofl/dmmono)

The regular faces and the DM Sans weight variable font were converted from the
official TTF assets to WOFF2 using FontTools and Node's built-in Brotli. The
conversion was checked by reopening each WOFF2 and comparing character maps,
glyph order and variable axes. They retain the original names and glyphs.
No font conversion package is needed to build or run the app. Fonts are served
locally; there is no runtime request to Google Fonts.
