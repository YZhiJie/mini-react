import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 需要真实 DOM（createElement / insertBefore / 事件派发）来验证渲染结果
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts'],
  },
});
