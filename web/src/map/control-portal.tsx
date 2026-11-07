import { useControl } from '@vis.gl/react-maplibre';
import { type ReactNode, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// A custom MapLibre control at the top right: the control container with a React portal. So the app buttons go into
// one column with the MapLibre buttons, in the mount order (MapLibre adds the top-right controls downward). The quick
// layers (LayerSwitcher) are first: they go above Street View, zoom and geolocation also after a remount (HMR, key),
// and not only because they render before MapButtons (design layer-thumbnails)

// The MapLibre control container for a React portal
function useControlContainer(className: string, first: boolean): HTMLElement {
    const [container] = useState(() => {
        const element = document.createElement('div');
        element.className = `maplibregl-ctrl ${className}`;
        return element;
    });
    useControl(
        () => ({
            onAdd: () => container,
            onRemove: () => container.remove(),
        }),
        { position: 'top-right' },
    );
    // the useControl effect with addControl has already run: the container is in the column, so move it to the top
    useEffect(() => {
        if (first) {
            container.parentElement?.prepend(container);
        }
    }, [container, first]);
    return container;
}

export function ControlPortal({
    className,
    first = false,
    children,
}: {
    className: string;
    first?: boolean;
    children: ReactNode;
}) {
    return createPortal(children, useControlContainer(className, first));
}
