import { beforeEach, describe, expect, it } from 'vitest';

import { flushScheduled, h, render, useEffect, useState } from '../src/index';

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('useEffect', () => {
  it('首次渲染提交后异步执行一次', () => {
    const log: string[] = [];
    const App = () => {
      useEffect(() => {
        log.push('effect');
        return () => log.push('cleanup');
      }, []);
      return h('div', null, 'x');
    };

    render(h(App), container);

    expect(log).toEqual(['effect']);
  });

  it('依赖变化时先执行上一次的清理，再执行新的 effect', async () => {
    const log: string[] = [];
    let setCount!: (next: number) => void;
    const App = () => {
      const [count, set] = useState(0);
      setCount = set;
      useEffect(() => {
        log.push(`effect:${count}`);
        return () => log.push(`cleanup:${count}`);
      }, [count]);
      return h('span', null, count);
    };

    render(h(App), container);
    expect(log).toEqual(['effect:0']);

    setCount(1);
    await flushScheduled();

    expect(log).toEqual(['effect:0', 'cleanup:0', 'effect:1']);
  });

  it('依赖未变化时不会重复执行', async () => {
    const log: string[] = [];
    let setCount!: (next: number) => void;
    const App = () => {
      const [count, set] = useState(0);
      setCount = set;
      useEffect(() => {
        log.push('effect');
        return () => log.push('cleanup');
      }, []);
      return h('span', null, count);
    };

    render(h(App), container);
    setCount(1);
    await flushScheduled();
    setCount(2);
    await flushScheduled();

    expect(log).toEqual(['effect']);
  });

  it('不传依赖数组时每次渲染都执行（并清理上一次）', async () => {
    const log: string[] = [];
    let setCount!: (next: number) => void;
    const App = () => {
      const [count, set] = useState(0);
      setCount = set;
      useEffect(() => {
        log.push(`effect:${count}`);
        return () => log.push(`cleanup:${count}`);
      });
      return h('span', null, count);
    };

    render(h(App), container);
    setCount(1);
    await flushScheduled();

    expect(log).toEqual(['effect:0', 'cleanup:0', 'effect:1']);
  });

  it('组件被卸载时执行清理函数', async () => {
    const log: string[] = [];
    let hide!: () => void;
    const Child = () => {
      useEffect(() => {
        log.push('child:mount');
        return () => log.push('child:unmount');
      }, []);
      return h('p', null, 'child');
    };
    const App = () => {
      const [visible, setVisible] = useState(true);
      hide = () => setVisible(false);
      return h('div', null, visible ? h(Child) : null);
    };

    render(h(App), container);
    expect(log).toEqual(['child:mount']);
    expect(container.querySelector('p')).not.toBeNull();

    hide();
    await flushScheduled();

    expect(log).toEqual(['child:mount', 'child:unmount']);
    expect(container.querySelector('p')).toBeNull();
  });
});
