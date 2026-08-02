# web

The public site for Medicare Provider Risk Analytics. Next.js App Router,
Tailwind 4, shadcn/ui on Base UI. Every page is statically prerendered.

See the repository root `README.md` for the analysis, and `PROJECT.md` for the
decisions behind it.

## Running

```bash
npm install
npm run sync-data     # copy ../data/site/*.json into public/data/
npm run build-map     # project US state boundaries into lib/us-states.json
npm run dev
```

`sync-data` needs rerunning whenever the pipeline regenerates `data/site/`.
`build-map` is a one-off — the geometry never changes.

## Pages

| Route | Content |
|---|---|
| `/` | The worklist: top 5,000 providers with their reasons |
| `/atlas` | Choropleth of worklist rate by state |
| `/how-it-works` | Feature importance and the bias audit |
| `/method` | Metrics, limitations, and the two findings |

## How the data gets in

The pipeline writes three files to `data/site/`; `sync-data` copies them into
`public/data/`. Server components read them from disk at build time. The
worklist additionally fetches `providers.json` in the browser, because only the
first 50 rows are server-rendered — sending all 5,000 made the document 2.35 MB.

The US boundaries are projected once by `scripts/build-map.mjs` into static SVG
paths, so `d3-geo`, `topojson-client` and `us-atlas` stay devDependencies and no
mapping library reaches the browser.

## Theming

`app/globals.css` holds one palette. shadcn's semantic tokens (`--background`,
`--card`, `--primary`, `--chart-*`) are **aliases** onto it rather than a second
greyscale system, so components inherit the site's colours and its dark mode.

Dark mode follows `prefers-color-scheme`, with `:root[data-theme="dark"]` and
`[data-theme="light"]` able to override in both directions. The `dark:` variant
is redefined to match, so shadcn's own dark utilities line up with the tokens.

Chart colour follows the sequential rules: one hue, five steps, running
light→dark on the light surface and dark→light on the dark one, because on a
dark surface it is the lightest step that stands out.

## Gotcha

This project runs shadcn on **Base UI**, not Radix (`components.json` →
`"style": "base-nova"`). Composition uses a `render` prop, not `asChild`:

```tsx
<PopoverTrigger render={<Button variant="outline" />}>…</PopoverTrigger>
```

Tutorials written for Radix will use `asChild`, which does not exist here.
