// File bytes → text. The old client read files as a binary string and always decoded names from UTF-8, so GPX and
// KML in Windows-1251 with a correct encoding= gave broken names. Here the encoding comes from the XML declaration
// (design add-web-tracks, «Парсеры»); TextDecoder knows windows-1251, koi8-r, ibm866 and others by the WHATWG labels.

const UTF8_BOM = [0xef, 0xbb, 0xbf];

export function hasUtf8Bom(bytes: Uint8Array): boolean {
    return UTF8_BOM.every((byte, i) => bytes[i] === byte);
}

export function decode(bytes: Uint8Array, encoding = 'utf-8'): string {
    let decoder: TextDecoder;
    try {
        decoder = new TextDecoder(encoding);
    } catch {
        // a label that WHATWG Encoding does not have: as without a declaration
        decoder = new TextDecoder('utf-8');
    }
    // the decoder removes the BOM by itself only for UTF-8; other encodings never have a BOM
    return decoder.decode(bytes);
}

// Encoding from <?xml … encoding="…"?> at the start of the file; the declaration is always in ASCII-compatible bytes
export function xmlEncoding(bytes: Uint8Array): string {
    if (hasUtf8Bom(bytes)) {
        return 'utf-8';
    }
    const head = String.fromCharCode(...bytes.subarray(0, 200));
    const match = /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([A-Za-z0-9._-]+)["']/u.exec(head);
    return match ? match[1].toLowerCase() : 'utf-8';
}

export function decodeXml(bytes: Uint8Array): string {
    return decode(bytes, xmlEncoding(bytes));
}

// Whether the bytes start with this ASCII string (after the UTF-8 BOM, if there is one)
export function startsWithAscii(bytes: Uint8Array, prefix: string): boolean {
    const offset = hasUtf8Bom(bytes) ? UTF8_BOM.length : 0;
    for (let i = 0; i < prefix.length; i++) {
        if (bytes[offset + i] !== prefix.charCodeAt(i)) {
            return false;
        }
    }
    return true;
}
