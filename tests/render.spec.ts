import { beforeEach, describe, expect, it } from 'vitest';

import { h, render } from '../src/index';

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('渲染与 DOM 构建', () => {
  it('渲染嵌套结构：元素、属性与文本节点', () => {
    render(h('div', { className: 'box' }, h('span', null, 'hello')), container);

    const div = container.firstChild as HTMLElement;
    expect(div.tagName).toBe('DIV');
    expect(div.className).toBe('box');

    const span = div.firstChild as HTMLElement;
    expect(span.tagName).toBe('SPAN');
    expect(span.textContent).toBe('hello');
  });

  it('函数组件返回的元素被渲染', () => {
    const App = () => h('main', null, h('h1', null, 'mini-react'));

    render(h(App), container);

    expect(container.querySelector('main > h1')?.textContent).toBe('mini-react');
  });

  it('style 对象被写入元素的行内样式', () => {
    render(h('div', { style: { color: 'rgb(255, 0, 0)', fontSize: '20px' } }), container);

    const div = container.firstChild as HTMLElement;
    expect(div.style.color).toBe('rgb(255, 0, 0)');
    expect(div.style.fontSize).toBe('20px');
  });

  it('children 中的 null / undefined / false 被忽略', () => {
    render(h('div', null, null, undefined, false, 'ok'), container);

    expect((container.firstChild as HTMLElement).textContent).toBe('ok');
  });

  it('数组形式的 children 被拍平后渲染', () => {
    const items = ['a', 'b', 'c'];

    render(h('ul', null, items.map((item) => h('li', { key: item }, item))), container);

    const lis = container.querySelectorAll('li');
    expect(lis.length).toBe(3);
    expect(Array.from(lis).map((li) => li.textContent)).toEqual(['a', 'b', 'c']);
  });

  it('数字类型的 children 会被转成文本节点', () => {
    render(h('div', null, 0, 1), container);

    expect((container.firstChild as HTMLElement).textContent).toBe('01');
  });
});
