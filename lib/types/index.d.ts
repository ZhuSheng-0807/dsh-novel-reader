/**
 * Minimal public types for dsh-novel-reader (hand-written; the runtime is plain JS).
 */
export declare const name: 'dsh-novel-reader'
export declare const inject: string[]
interface WebServerRoute {
  kind: 'prefix'
  path: string
  handler(req: unknown, res: unknown): void | Promise<void>
}
interface WebServer {
  register(route: WebServerRoute): () => void
}
interface PluginContext {
  effect(fn: () => void | (() => void), label?: string): void
  webServer: WebServer
}
export declare function apply(ctx: PluginContext): void
