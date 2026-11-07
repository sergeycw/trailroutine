import type { ExpressionSpecification } from 'maplibre-gl';

// POI icons of the basemap OpenFreeMap Outdoor (backlog «Новые возможности», the item of Of; change outdoor-poi-icons):
// the places a hiker looks for on a topo map. The style has no sprite (src/layers/outdoor.ts), so the app draws each
// icon on a canvas when MapLibre asks for it (event styleimagemissing, src/map/maplibre.ts). The classes and subclasses
// are of the OpenMapTiles poi layer (https://openmaptiles.org/schema/#poi); the tiles have them from zoom 14.

export const POI_ICON_PREFIX = 'poi-';

interface PoiKind {
    id: string;
    color: string;
    // the white sign in a 24×24 box, as a list of canvas path commands
    draw: (context: CanvasRenderingContext2D) => void;
    // OpenMapTiles class and, if needed, subclasses
    class: string;
    subclasses?: readonly string[];
}

const hut = (context: CanvasRenderingContext2D) => {
    context.beginPath();
    context.moveTo(6, 12);
    context.lineTo(12, 6.5);
    context.lineTo(18, 12);
    context.moveTo(8, 11);
    context.lineTo(8, 17.5);
    context.lineTo(16, 17.5);
    context.lineTo(16, 11);
    context.stroke();
};
const tent = (context: CanvasRenderingContext2D) => {
    context.beginPath();
    context.moveTo(5.5, 17.5);
    context.lineTo(12, 6.5);
    context.lineTo(18.5, 17.5);
    context.closePath();
    context.moveTo(12, 17.5);
    context.lineTo(12, 12);
    context.stroke();
};
const drop = (context: CanvasRenderingContext2D) => {
    context.beginPath();
    context.moveTo(12, 6);
    context.bezierCurveTo(12, 6, 7.5, 11.5, 7.5, 14);
    context.arc(12, 14, 4.5, Math.PI, 0, true);
    context.bezierCurveTo(16.5, 11.5, 12, 6, 12, 6);
    context.fill();
};
const eye = (context: CanvasRenderingContext2D) => {
    context.beginPath();
    context.moveTo(5.5, 12);
    context.quadraticCurveTo(12, 5.5, 18.5, 12);
    context.quadraticCurveTo(12, 18.5, 5.5, 12);
    context.stroke();
    context.beginPath();
    context.arc(12, 12, 2.2, 0, 2 * Math.PI);
    context.fill();
};

export const POI_KINDS: readonly PoiKind[] = [
    { id: 'hut', color: '#8a4b14', draw: hut, class: 'lodging', subclasses: ['alpine_hut', 'wilderness_hut'] },
    { id: 'shelter', color: '#8a4b14', draw: hut, class: 'shelter' },
    { id: 'campsite', color: '#3d7a2e', draw: tent, class: 'campsite' },
    { id: 'water', color: '#1f6fbf', draw: drop, class: 'drinking_water' },
    { id: 'viewpoint', color: '#6b4fa3', draw: eye, class: 'attraction', subclasses: ['viewpoint'] },
];

// the feature filter of the POI layer: only the kinds above
export function poiFilter(): ExpressionSpecification {
    return ['any', ...POI_KINDS.map(kindMatch)] as ExpressionSpecification;
}

function kindMatch(kind: PoiKind): ExpressionSpecification {
    const byClass: ExpressionSpecification = ['==', ['get', 'class'], kind.class];
    return kind.subclasses ? ['all', byClass, ['in', ['get', 'subclass'], ['literal', kind.subclasses]]] : byClass;
}

// the icon id of a feature: poi-<kind>
export function poiIcon(): ExpressionSpecification {
    const cases = POI_KINDS.flatMap((kind) => [kindMatch(kind), `${POI_ICON_PREFIX}${kind.id}`]);
    return ['case', ...cases, ''] as ExpressionSpecification;
}

// A 24 px icon at pixel ratio 2: a colored circle with a white border and a white sign. null for an unknown id.
export function drawPoiIcon(id: string): { width: number; height: number; data: Uint8Array } | null {
    const kind = POI_KINDS.find((item) => `${POI_ICON_PREFIX}${item.id}` === id);
    if (!kind) {
        return null;
    }
    const ratio = 2;
    const size = 24 * ratio;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
        return null;
    }
    context.scale(ratio, ratio);
    context.beginPath();
    context.arc(12, 12, 10.5, 0, 2 * Math.PI);
    context.fillStyle = kind.color;
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = 'white';
    context.stroke();
    context.fillStyle = 'white';
    context.lineWidth = 1.8;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    kind.draw(context);
    const pixels = context.getImageData(0, 0, size, size);
    return { width: size, height: size, data: new Uint8Array(pixels.data.buffer) };
}

interface ImageHost {
    hasImage(id: string): boolean;
    addImage(
        id: string,
        image: { width: number; height: number; data: Uint8Array },
        options: { pixelRatio: number },
    ): void;
}

// The handler of the map event styleimagemissing: it draws a POI icon on the first request; other ids stay missing
export function providePoiIcon(map: ImageHost, id: string): void {
    if (!id.startsWith(POI_ICON_PREFIX) || map.hasImage(id)) {
        return;
    }
    const image = drawPoiIcon(id);
    if (image) {
        map.addImage(id, image, { pixelRatio: 2 });
    }
}
