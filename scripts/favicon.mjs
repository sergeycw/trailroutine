// Site icons from web/public/favicon.svg (change site-favicon): favicon.ico with images of 16, 32 and 48 px for
// browsers without SVG icons, and apple-touch-icon.png of 180 px for the iPhone screen. apple-touch-icon is a full-size
// square with a blue background, without its own rounding and without transparency (rx="0" in place of rx="174",
// render without omitBackground). favicon.svg itself is a vector copy of the owner image of 2026-10-30: the center
// line of the white stripe is traced from a 1024 px raster and smoothed with a Bézier curve (design site-favicon).
//
// Run from the root: PATH=/usr/local/bin:$PATH node scripts/favicon.mjs. It needs the Playwright Chromium from
// web/node_modules (npm ci in web/); it does not need the network.
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'web/public');
const require = createRequire(join(ROOT, 'web/package.json'));
const {chromium} = require('playwright');

const svg = await readFile(join(PUBLIC, 'favicon.svg'), 'utf8');
const square = svg.replaceAll('rx="174"', 'rx="0"');
if (square === svg) {
    console.error('favicon.svg has no rx="174": update the apple-touch-icon replacement in scripts/favicon.mjs');
    process.exit(1);
}

const browser = await chromium.launch();
// transparent: a transparent background outside the rounding (the ICO images); without it the corners are the white
// background of the page, so for apple-touch-icon the square is drawn without the rounding
async function render(source, size, transparent) {
    const page = await browser.newPage({viewport: {width: size, height: size}});
    const url = `data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}`;
    await page.setContent(
        `<body style="margin:0"><img src="${url}" width="${size}" height="${size}" style="display:block"></body>`,
    );
    await page.locator('img').evaluate((img) => img.decode());
    const png = await page.screenshot({omitBackground: transparent});
    await page.close();
    return png;
}

// ICO with PNG images inside: a header of 6 bytes, 16 bytes per image (size, 32 bits per pixel, length, offset)
function ico(images) {
    const header = Buffer.alloc(6 + 16 * images.length);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(images.length, 4);
    let offset = header.length;
    images.forEach(({size, png}, i) => {
        const entry = 6 + 16 * i;
        header.writeUInt8(size, entry);
        header.writeUInt8(size, entry + 1);
        header.writeUInt16LE(1, entry + 4);
        header.writeUInt16LE(32, entry + 6);
        header.writeUInt32LE(png.length, entry + 8);
        header.writeUInt32LE(offset, entry + 12);
        offset += png.length;
    });
    return Buffer.concat([header, ...images.map(({png}) => png)]);
}

try {
    const images = [];
    for (const size of [16, 32, 48]) {
        images.push({size, png: await render(svg, size, true)});
    }
    await writeFile(join(PUBLIC, 'favicon.ico'), ico(images));
    await writeFile(join(PUBLIC, 'apple-touch-icon.png'), await render(square, 180, false));
    console.log('favicon.ico (16, 32, 48) and apple-touch-icon.png (180) written to web/public');
} finally {
    await browser.close();
}
