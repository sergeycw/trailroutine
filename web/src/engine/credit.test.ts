import { describe, expect, test } from 'vitest';
import { routingAttribution } from './credit';

describe('Built with CheerpJ credit', () => {
    test('Credit in the attribution', () => {
        expect(routingAttribution('browser')).toContain('>Built with CheerpJ</a>');
        expect(routingAttribution('browser')).toContain('href="https://cheerpj.com/"');
        expect(routingAttribution('browser')).toContain('>BRouter</a>');
        // the server BRouter of the local build does not use CheerpJ
        expect(routingAttribution('server')).toBeUndefined();
    });
});
