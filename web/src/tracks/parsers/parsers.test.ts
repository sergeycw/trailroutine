import { describe } from 'vitest';
import { parserCases } from './cases';

// DOMParser is xmldom (src/test/node-dom.ts); the same scenarios in Chromium are in parsers.browser.test.ts
describe('парсеры в Node', parserCases);
