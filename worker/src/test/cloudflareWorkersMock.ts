export class DurableObject<Bindings = unknown> {
  protected ctx: any;
  protected env: Bindings;
  constructor(ctx: any, env: Bindings) { this.ctx = ctx; this.env = env; }
}
