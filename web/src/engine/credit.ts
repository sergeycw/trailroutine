import type { RoutingEngine } from '@/config';

// The routing credit in the map attribution (spec browser-routing-engine, «Built with CheerpJ credit»; change
// cheerpj-credit). The CheerpJ Community license requires a «Built with CheerpJ» credit in the application
// (https://cheerpj.com/licensing/, checked 2026-11-07); the clone runs the engine in the browser with CheerpJ, the
// local build asks the server BRouter and gets no credit (its attribution stays as the layers give it).
export function routingAttribution(engine: RoutingEngine): string | undefined {
    if (engine !== 'browser') {
        return undefined;
    }
    const brouter = '<a href="https://github.com/abrensch/brouter" target="_blank" rel="noopener">BRouter</a>';
    return `Routing ${brouter} · <a href="https://cheerpj.com/" target="_blank" rel="noopener">Built with CheerpJ</a>`;
}
