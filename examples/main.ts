import { h, render, useEffect, useMemo, useRef, useState } from '../src/index';

/**
 * 示例应用：计数器 + 待办列表。
 *
 * 刻意不用 JSX —— 本仓库目标是展示运行时原理，用 h() 直接书写虚拟 DOM
 * 可以让「元素 → vnode → fiber → DOM」这条链路更透明。
 */

const Counter = (): unknown => {
  const [count, setCount] = useState(0);
  const clicks = useRef(0);
  const doubled = useMemo(() => count * 2, [count]);

  useEffect(() => {
    document.title = `count = ${count}`;
    return () => {
      // 依赖变化时先跑这里，再跑下一次 effect —— 与真实 React 一致
    };
  }, [count]);

  return h(
    'section',
    { className: 'counter' },
    h('h2', null, 'Counter'),
    h('p', null, `count: `, count, ` / doubled: `, doubled),
    h(
      'button',
      {
        onClick: () => {
          clicks.current += 1;
          // 连续三次 setState 会被合并为一次渲染（见 hooks.ts 的 queue 消费）
          setCount((prev: number) => prev + 1);
          setCount((prev: number) => prev + 1);
          setCount((prev: number) => prev + 1);
        },
      },
      '每次点击 +3',
    ),
    h('p', { className: 'hint' }, `render 次数由 ref 记录：${clicks.current}`),
  );
};

const TodoList = (): unknown => {
  const [items, setItems] = useState<{ id: string; text: string }[]>([
    { id: 'a', text: '读懂 Fiber 的双缓存' },
    { id: 'b', text: '搞清 key 在 diff 里如何复用节点' },
  ]);
  const [draft, setDraft] = useState('');
  const nextId = useRef(0);

  const add = (): void => {
    const text = draft.trim();
    if (!text) return;
    nextId.current += 1;
    setItems([...items, { id: `n${nextId.current}`, text }]);
    setDraft('');
  };

  const remove = (id: string): void => setItems(items.filter((item) => item.id !== id));

  return h(
    'section',
    { className: 'todo' },
    h('h2', null, 'Todo'),
    h('div', { className: 'row' }, h('input', {
      value: draft,
      placeholder: '输入后回车或点添加',
      onInput: (event: { target: { value: string } }) => setDraft(event.target.value),
      onChange: (event: { target: { value: string } }) => setDraft(event.target.value),
    }), h('button', { onClick: add }, '添加')),
    h(
      'ul',
      null,
      items.map((item) =>
        h(
          'li',
          { key: item.id },
          h('span', null, item.text),
          h('button', { className: 'del', onClick: () => remove(item.id) }, '删除'),
        ),
      ),
    ),
    h('p', { className: 'hint' }, `共 ${items.length} 项（key 保证重排时 DOM 节点被复用）`),
  );
};

const App = (): unknown => h('main', null, h('h1', null, 'mini-react'), h(Counter), h(TodoList));

const root = document.querySelector('#root');
if (root instanceof HTMLElement) render(h(App), root);
