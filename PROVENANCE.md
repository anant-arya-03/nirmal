# Assets and dependencies

| Material | Implementation |
| --- | --- |
| Nirmal mark and favicon | SVG in `public/mark.svg`. |
| Laundry bag, washer, and folded-clothes illustrations | CSS geometry in `src/style.css`. |
| Interface, schema, and business logic | React components, CSS, HTTP handlers, database tables, and workflow validation. |
| Inter | Self-hosted through `@fontsource/inter`; SIL Open Font License retained. |
| Lucide icons | `lucide-react`; attribution and license notices retained. |
| React, Motion, Express, security and mail packages | Locked npm dependencies with upstream notices retained. |
| JPEG/PNG decoding | `jpeg-js` (BSD-3-Clause) and `pngjs` (MIT). |
| Build tooling | Vite/Rolldown and dependencies, including Lightning CSS (MPL-2.0). |

`scripts/notices.js` generates `THIRD_PARTY_NOTICES.md` from installed package license files, metadata, and bundled notices. The build makes these available at `/third-party-notices.txt`.

Run `npm run licenses` after changing dependencies or installation platforms. Keep dependency notices with redistributed packages.
