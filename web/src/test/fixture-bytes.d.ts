// Import of a fixture as bytes: the plugin fixtureBytes in vitest.config.ts
declare module '*?bytes' {
    const base64: string;
    export default base64;
}
