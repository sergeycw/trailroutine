import { onErrorStopParsing, DOMParser as XmlDomParser } from '@xmldom/xmldom';

// DOMParser for unit tests in Node: the track parsers parse XML with the DOMParser of the browser (design
// add-web-tracks, «Парсеры»). By default, xmldom continues to parse after an error, but the browser gives a
// document with <parsererror>. So here an error stops the parse with an exception, and parseXml returns null in
// both cases. parsers.browser.test.ts finds the differences from the browser on the same fixtures.
class NodeDomParser {
    parseFromString(text: string, type: string) {
        return new XmlDomParser({ onError: onErrorStopParsing }).parseFromString(text, type as 'text/xml');
    }
}

globalThis.DOMParser ??= NodeDomParser as unknown as typeof DOMParser;
