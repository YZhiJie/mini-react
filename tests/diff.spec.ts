import { beforeEach, describe, expect, it } from 'vitest';

import { flushScheduled, h, render, useState } from '../src/index';

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

function renderList(): { setItems: (items: string[]) => void } {
  let setItems!: (items: string[]) => void;
  const App = () => {
    const [items, set] = useState(['a', 'b', 'c']);
    setItems = set;
    return h(
      'ul',
      null,
      items.map((item) => h('li', { key: item }, item)),
    );
  };
  render(h(App), container);
  return { setItems };
}

function listTexts(): (string | null)[] {
  return Array.from(container.querySelectorAll('li')).map((li) => li.textContent);
}

describe('Diff（key 复用与节点移动）', () => {
  it('重排时复用同一个 DOM 节点，而不是重建', async () => {
    const { setItems } = renderList();
    const before = Array.from(container.querySelectorAll('li'));
    const nodeC = before[2];
    const nodeA = before[0];

    setItems(['c', 'a', 'b']);
    await flushScheduled();

    expect(listTexts()).toEqual(['c', 'a', 'b']);
    const after = Array.from(container.querySelectorAll('li'));
    expect(after[0]).toBe(nodeC);
    expect(after[1]).toBe(nodeA);
  });

  it('删除列表项时对应 DOM 节点被移除，其余节点保持复用', async () => {
    const { setItems } = renderList();
    const nodeB = container.querySelectorAll('li')[1];

    setItems(['a', 'c']);
    await flushScheduled();

    expect(listTexts()).toEqual(['a', 'c']);
    expect(nodeB.parentNode).toBeNull();
  });

  it('向列表中间插入新项时位置正确', async () => {
    const { setItems } = renderList();
    const nodeC = container.querySelectorAll('li')[2];

    setItems(['a', 'b', 'x', 'c']);
    await flushScheduled();

    expect(listTexts()).toEqual(['a', 'b', 'x', 'c']);
    expect(container.querySelectorAll('li')[3]).toBe(nodeC);
  });

  it('key 存在但类型改变时不会错误复用旧节点', async () => {
    let setMode!: (mode: 'text' | 'bold') => void;
    const App = () => {
      const [mode, set] = useState<'text' | 'bold'>('text');
      setMode = set;
      return h('div', null, h(mode === 'text' ? 'span' : 'b', { key: 'same' }, 'value'));
    };

    render(h(App), container);
    expect(container.querySelector('span')).not.toBeNull();

    setMode('bold');
    await flushScheduled();

    expect(container.querySelector('span')).toBeNull();
    expect(container.querySelector('b')?.textContent).toBe('value');
  });

  it('无 key 的同类节点按位置复用（仅内容更新）', async () => {
    let setItems!: (items: string[]) => void;
    const App = () => {
      const [items, set] = useState(['1', '2', '3']);
      setItems = set;
      return h(
        'ul',
        null,
        items.map((item) => h('li', null, item)),
      );
    };

    render(h(App), container);
    const nodeFirst = container.querySelectorAll('li')[0];

    setItems(['9', '8']);
    await flushScheduled();

    expect(listTexts()).toEqual(['9', '8']);
    expect(container.querySelectorAll('li')[0]).toBe(nodeFirst);
  });
});
