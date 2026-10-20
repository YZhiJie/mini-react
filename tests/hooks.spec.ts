import { beforeEach, describe, expect, it } from 'vitest';

import { flushScheduled, h, render, useRef, useState } from '../src/index';

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('useState', () => {
  it('初始值被渲染到页面', () => {
    const App = () => {
      const [count] = useState(10);
      return h('p', null, count);
    };

    render(h(App), container);

    expect(container.textContent).toBe('10');
  });

  it('setState 触发重新渲染并更新页面', async () => {
    const App = () => {
      const [count, setCount] = useState(0);
      return h('button', { onClick: () => setCount(count + 1) }, count);
    };

    render(h(App), container);
    (container.querySelector('button') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushScheduled();

    expect(container.querySelector('button')?.textContent).toBe('1');
  });

  it('同一批次内 3 次 setState 合并为一次渲染，且状态一次性推进到位', async () => {
    let renders = 0;
    const App = () => {
      renders += 1;
      const [count, setCount] = useState(0);
      return h(
        'button',
        {
          onClick: () => {
            setCount((prev: number) => prev + 1);
            setCount((prev: number) => prev + 1);
            setCount((prev: number) => prev + 1);
          },
        },
        count,
      );
    };

    render(h(App), container);
    expect(renders).toBe(1);

    (container.querySelector('button') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushScheduled();

    // 三次更新入队后一次性消费：渲染次数只加 1，最终值等于三次函数式更新的累加结果
    expect(renders).toBe(2);
    expect(container.querySelector('button')?.textContent).toBe('3');
  });

  it('连续两次点击会各自触发一次渲染', async () => {
    let renders = 0;
    const App = () => {
      renders += 1;
      const [count, setCount] = useState(0);
      return h('button', { onClick: () => setCount((prev: number) => prev + 1) }, count);
    };

    render(h(App), container);
    const button = container.querySelector('button') as HTMLElement;

    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushScheduled();
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushScheduled();

    expect(renders).toBe(3);
    expect(container.querySelector('button')?.textContent).toBe('2');
  });

  it('直接传值的更新会覆盖状态（而非累加）', async () => {
    const App = () => {
      const [value, setValue] = useState('a');
      return h(
        'div',
        null,
        h('button', { id: 'set-b', onClick: () => setValue('b') }, 'to-b'),
        h('span', null, value),
      );
    };

    render(h(App), container);
    (container.querySelector('#set-b') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushScheduled();

    expect(container.querySelector('span')?.textContent).toBe('b');
  });
});

describe('useRef', () => {
  it('跨渲染保持同一个对象引用，且修改不触发渲染', async () => {
    const refs: Array<{ current: number }> = [];
    const App = () => {
      const [count, setCount] = useState(0);
      const ref = useRef(0);
      refs.push(ref);
      return h('button', { onClick: () => setCount((prev: number) => prev + 1) }, count);
    };

    render(h(App), container);
    refs[0].current = 42;

    (container.querySelector('button') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushScheduled();

    expect(refs.length).toBe(2);
    expect(refs[1]).toBe(refs[0]);
    expect(refs[1].current).toBe(42);
  });
});
