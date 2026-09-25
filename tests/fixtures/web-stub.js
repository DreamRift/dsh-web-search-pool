/**
 * 测试夹具：`web` seam 的最小 loader 行（与线上 `@deepseek-ai/dsh-web` 同构：
 * 提供 `web` 服务 + 记录 registerSearchProvider 的调用）。
 * 只给 host apply 测试用，不进发布包（package.json 的 files 不含 tests/）。
 */
import z from '@deepseek-ai/schemastery';

export const name = 'web-stub';

export const Config = z.object({
  searchProvider: z.string(),
  fetchProvider: z.string(),
});

export function apply(ctx, config) {
  ctx.reflect.provide('web', {
    config,
    registered: [],
    registerSearchProvider(provider) {
      this.registered.push(provider);
      return () => {
        const index = this.registered.indexOf(provider);
        if (index >= 0) this.registered.splice(index, 1);
      };
    },
  });
}
