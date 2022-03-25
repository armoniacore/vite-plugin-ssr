declare module 'ssr:manifest' {
  const manifest: Record<string, string[]>;
  export default manifest;
}

declare module 'ssr:template' {
  const template: string;
  export default template;
}
