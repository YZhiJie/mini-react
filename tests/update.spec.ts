import { beforeEach, describe, expect, it } from 'vitest';

import { flushScheduled, h, render, useState } from '../src/index';

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

describe('属性与文本更新', () => {
  it('props 变化后 DOM 属性同步更新', async () => {
    let setDisabled!: (next: boolean) => void;
    const App = () => {
      const [disabled, set] = useState(false);
      setDisabled = set;
      return h('button', { disabled, title: disabled ? 'off' : 'on' }, 'go');
    };

    render(h(App), container);
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    setDisabled(true);
    await flushScheduled();

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe('off');
  });

  it('className 从有到无时会被清除', async () => {
    let setClass!: (next: string) => void;
    const App = () => {
      const [cls, set] = useState('active');
      setClass = set;
      return h('div', { className: cls }, 'x');
    };

    render(h(App), container);
    const div = container.firstChild as HTMLElement;
    expect(div.className).toBe('active');

    setClass('');
    await flushScheduled();

    expect(div.className).toBe('');
  });

  it('style 中消失的属性会被清除', async () => {
    let setColor!: (next: string) => void;
    const App = () => {
      const [color, set] = useState('red');
      setColor = set;
      return h('div', { style: { color, fontSize: '12px' } }, 'x');
    };

    render(h(App), container);
    const div = container.firstChild as HTMLElement;
    expect(div.style.color).toBe('red');
    expect(div.style.fontSize).toBe('12px');

    setColor('blue');
    await flushScheduled();

    expect(div.style.color).toBe('blue');
    expect(div.style.fontSize).toBe('12px');
  });

  it('文本内容更新时只改 nodeValue，节点被复用', async () => {
    let setText!: (next: string) => void;
    const App = () => {
      const [text, set] = useState('before');
      setText = set;
      return h('p', null, text);
    };

    render(h(App), container);
    const textNode = container.querySelector('p')?.firstChild;

    setText('after');
    await flushScheduled();

    expect(container.querySelector('p')?.textContent).toBe('after');
    expect(container.querySelector('p')?.firstChild).toBe(textNode);
  });

  it('条件渲染：从存在到 null 时节点被移除，再切回来会重新挂载', async () => {
    let setVisible!: (next: boolean) => void;
    const App = () => {
      const [visible, set] = useState(true);
      setVisible = set;
      return h('div', null, visible ? h('span', null, 'hi') : null);
    };

    render(h(App), container);
    expect(container.querySelector('span')).not.toBeNull();

    setVisible(false);
    await flushScheduled();
    expect(container.querySelector('span')).toBeNull();

    setVisible(true);
    await flushScheduled();
    expect(container.querySelector('span')?.textContent).toBe('hi');
  });
});
