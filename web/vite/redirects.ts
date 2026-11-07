// Parsing of public/_redirects by the Cloudflare Pages rules, only the part that the file needs: an exact path or a
// path with an asterisk at the end, `:splat` in the destination, the first matching rule wins, the default code is 302
// (developers.cloudflare.com/pages/configuration/redirects). The unit test of the rules uses it, and so does e2e, which
// answers the browser in place of Pages: vite preview does not read the _redirects file. The query string does not come
// here: Pages move it to the destination themselves (checked with wrangler pages dev), the tests do not need it.

export interface RedirectRule {
    source: string;
    destination: string;
    status: number;
}

export function parseRedirects(text: string): RedirectRule[] {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
            const [source, destination, status] = line.split(/\s+/);
            return { source, destination, status: status ? Number(status) : 302 };
        });
}

export function resolveRedirect(
    rules: readonly RedirectRule[],
    pathname: string,
): { location: string; status: number } | null {
    for (const { source, destination, status } of rules) {
        if (source.endsWith('*')) {
            const prefix = source.slice(0, -1);
            if (pathname.startsWith(prefix)) {
                return { location: destination.replace(':splat', pathname.slice(prefix.length)), status };
            }
        } else if (pathname === source) {
            return { location: destination, status };
        }
    }
    return null;
}
