// XML parsing for GPX and KML: the browser DOMParser (in Node unit tests, @xmldom/xmldom, src/test/node-dom.ts).

export function parseXml(text: string): Document | null {
    // Tag name prefixes → `prefix_name`, as in the old client: service files can have prefixes without an xmlns
    // declaration (gpxx:, gx:), and strict XML parsing fails on them. After this, look for `gx_Track`, not `gx:Track`.
    const unprefixed = text.replace(/<([^ >]+):([^ >]+)/gu, '<$1_$2');
    let dom: Document;
    try {
        dom = new DOMParser().parseFromString(unprefixed, 'text/xml');
    } catch {
        return null;
    }
    // the browser does not throw, it inserts <parsererror> (Firefox as the root, Chromium inside the document)
    if (!dom.documentElement || dom.getElementsByTagName('parsererror').length > 0) {
        return null;
    }
    return dom;
}

export function elements(parent: Document | Element, tag: string): Element[] {
    return Array.from(parent.getElementsByTagName(tag));
}

// Node text without child elements (xmlGetNodeText of the old client): text and CDATA of the direct children
export function nodeText(node: Element | undefined): string | null {
    if (!node) {
        return null;
    }
    return Array.from(node.childNodes)
        .map((child) => child.nodeValue ?? '')
        .join('');
}
