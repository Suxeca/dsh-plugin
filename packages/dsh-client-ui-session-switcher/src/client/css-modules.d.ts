/**
 * CSS Modules type shim: lets the compiler typecheck `import css from
 * './x.module.css'` (the runtime class map comes from the bundle's
 * lightningcss pass). Keep this file in every plugin package that styles
 * itself.
 */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
