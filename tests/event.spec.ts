import { beforeEach, describe, expect, it } from 'vitest';

import { flushScheduled, h, render, useState } from '../src/index';

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

interface SyntheticEvent {
  type: string;
  target: EventTarget | null;
  currentTarget: EventTarget | null;
  stopPropagation: () => void;
}

describe('事件委托与合成事件', () => {
  it('点击子元素时，祖先元素上的 onClick 也会触发（冒泡）', () => {
    const order: string[] = [];
    render(
      h(
        'div',
        { onClick: () => order.push('outer') },
        h('button', { onClick: () => order.push('inner') }, 'go'),
      ),
      container,
    );

    (container.querySelector('button') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // 目标元素先执行，再向祖先冒泡 —— 与浏览器原生行为一致
    expect(order).toEqual(['inner', 'outer']);
  });

  it('stopPropagation 能阻断后续冒泡', () => {
    const order: string[] = [];
    render(
      h(
        'div',
        { onClick: () => order.push('outer') },
        h(
          'button',
          {
            onClick: (event: SyntheticEvent) => {
              order.push('inner');
              event.stopPropagation();
            },
          },
          'go',
        ),
      ),
      container,
    );

    (container.querySelector('button') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(order).toEqual(['inner']);
  });

  it('合成事件对象携带 type / target / currentTarget', () => {
    const events: SyntheticEvent[] = [];
    render(
      h('div', { id: 'outer', onClick: (event: SyntheticEvent) => events.push(event) }, h('span', null, 'text')),
      container,
    );

    const span = container.querySelector('span') as HTMLElement;
    span.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(events.length).toBe(1);
    expect(events[0].type).toBe('click');
    expect(events[0].target).toBe(span);
    expect(events[0].currentTarget).toBe(container.querySelector('#outer'));
  });

  it('handler 被移除后不再触发，再挂回来又能触发', async () => {
    let setEnabled!: (next: boolean) => void;
    let calls = 0;
    const App = () => {
      const [enabled, set] = useState(true);
      setEnabled = set;
      return h('div', enabled ? { onClick: () => (calls += 1) } : {}, h('span', null, 'text'));
    };

    render(h(App), container);
    const span = container.querySelector('span') as HTMLElement;

    span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls).toBe(1);

    setEnabled(false);
    await flushScheduled();
    span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls).toBe(1);

    setEnabled(true);
    await flushScheduled();
    span.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(calls).toBe(2);
  });

  it('只调用当前元素自己的 handler，不会误触兄弟节点的 handler', () => {
    const calls: string[] = [];
    render(
      h(
        'div',
        null,
        h('button', { id: 'a', onClick: () => calls.push('a') }, 'A'),
        h('button', { id: 'b', onClick: () => calls.push('b') }, 'B'),
      ),
      container,
    );

    (container.querySelector('#b') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(calls).toEqual(['b']);
  });
});
