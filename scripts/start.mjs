// Production entry: set NODE_ENV before server.ts (and its config module) is
// evaluated. Works on Windows and POSIX without cross-env.
process.env.NODE_ENV = 'production'

await import('../server.ts')
