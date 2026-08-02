/**
 * Pre-project the US state boundaries into plain SVG paths, once, at build time.
 *
 * The alternative is shipping d3-geo, topojson-client and a ~100 KB TopoJSON
 * file to every visitor so the browser can recompute the same fixed geometry on
 * every load. The map never changes, so it is projected here instead and the
 * component renders static `d` strings. The geo libraries stay devDependencies.
 *
 * Run: node scripts/build-map.mjs   (wired into `npm run build-map`)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";

const WIDTH = 960;
const HEIGHT = 600;

// FIPS -> USPS. The billing data keys on the two-letter code.
const FIPS = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY", "72": "PR",
};

const atlas = JSON.parse(
  await readFile(
    path.join(process.cwd(), "node_modules/us-atlas/states-10m.json"),
    "utf8",
  ),
);

const states = feature(atlas, atlas.objects.states);

// geoAlbersUsa insets Alaska and Hawaii, which is what makes a US choropleth
// readable at this size. It has no projection for Puerto Rico, so PR paths come
// back null and the territory is reported in the table rather than the map.
const projection = geoAlbersUsa().fitSize([WIDTH, HEIGHT], states);
// One decimal is sub-pixel at this size and roughly halves the file, which
// matters because these paths are inlined into the HTML.
const toPath = geoPath(projection).digits(1);

const shapes = [];
const skipped = [];
for (const f of states.features) {
  const code = FIPS[String(f.id).padStart(2, "0")];
  const d = toPath(f);
  if (!code || !d) {
    skipped.push(code ?? f.id);
    continue;
  }
  const [x, y] = toPath.centroid(f);
  shapes.push({
    code,
    name: f.properties.name,
    d,
    // Where a two-letter label sits, for the states big enough to hold one.
    cx: Math.round(x),
    cy: Math.round(y),
    area: Math.round(toPath.area(f)),
  });
}

shapes.sort((a, b) => a.code.localeCompare(b.code));

await mkdir(path.join(process.cwd(), "lib"), { recursive: true });
await writeFile(
  path.join(process.cwd(), "lib", "us-states.json"),
  JSON.stringify({ width: WIDTH, height: HEIGHT, shapes }, null, 1) + "\n",
);

console.log(`wrote lib/us-states.json - ${shapes.length} states`);
if (skipped.length) console.log(`not projected by albersUsa: ${skipped.join(", ")}`);
