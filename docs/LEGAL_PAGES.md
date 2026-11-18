# Mystash legal and support page shells

These are editable static HTML placeholders, not final legal documents.

- `/privacy` → `privacy.html`
- `/terms` → `terms.html`
- `/cookies` → `cookies.html`
- `/account-deletion` → `account-deletion.html`
- `/contact` → `contact.html`
- `/content-policy` → `content-policy.html`

Replace each “Content to be added” paragraph with your approved content. The section headings are suggested outlines and can be changed, removed or extended. Keep the “On this page” anchor links synchronized with section IDs. Contact and deletion pages intentionally include no invented addresses, forms or request procedures.

Before publishing final content:

1. Replace the pending notice and placeholder paragraphs; add the actual publication/effective date where applicable.
2. Review the title, description and canonical URL. The current canonical domain is `https://mystash.in`.
3. Remove the `noindex,follow` meta tag only once the page is ready to be indexed.
4. Add approved, indexable pages to the sitemap in `backend/src/public-stash/web.ts` if desired. Draft pages are deliberately omitted.

All pages share `legal.css` and the existing homepage stylesheet. They contain no JavaScript or forms. The footer links are present on the homepage and all six pages.

Production clean routes are registered in `backend/src/public-stash/web.ts`; local preview equivalents are in `scripts/preview-homepage.cjs`. Standard Expo export copies these files via `public/`; the existing Docker web export includes them. Restart `npm run homepage:preview` after changing server routes; HTML and CSS edits need only a browser refresh.

The homepage’s top-right “Get App” link currently targets `#discover`, as requested. Replace its destination with the verified release link when the app becomes available.
