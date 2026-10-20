import type { Fiber } from "./fiber";

/**
 * DOM 操作层：创建节点、更新属性、事件委托。
 *
 * 关键点：创建出来的 DOM 节点不会在 render 阶段插入文档，
 * 而是等到 commit 阶段由父节点统一"就位"，这样渲染中途被打断也不会闪屏
 * （React 早期版本就是边遍历边 append，后来改成只收集 effect 再统一提交）。
 */

function isEventProp(key: string): boolean {
  return (
    key.length > 2 && key.startsWith("on") && key[2] === key[2].toUpperCase()
  );
}

function skipKey(key: string): boolean {
  return key === "children" || key === "key" || key === "nodeValue";
}

export function createDom(fiber: Fiber): HTMLElement | Text {
  if (fiber.type === "#text") {
    const text = document.createTextNode(String(fiber.props.nodeValue ?? ""));
    (text as unknown as { __fiber?: Fiber }).__fiber = fiber;
    return text;
  }
  const dom = document.createElement(fiber.type as string);
  setProps(dom, fiber.props, {});
  (dom as unknown as { __fiber?: Fiber }).__fiber = fiber;
  return dom;
}

/**
 * 属性 diff：先删掉"新 props 里没有的"，再写入"变化了的"。
 * 事件属性不在这里绑定监听器——统一交给根容器的事件委托（见下）。
 */
export function setProps(
  dom: HTMLElement,
  next: Record<string, unknown>,
  prev: Record<string, unknown>,
): void {
  for (const key of Object.keys(prev)) {
    if (skipKey(key)) continue;
    if (key in next) continue;
    if (isEventProp(key)) continue;
    if (key === "style") {
      dom.removeAttribute("style");
      continue;
    }
    if (typeof prev[key] === "boolean") {
      // 布尔属性（disabled / checked / hidden…）旧值 true、新 props 又没有该键，说明要关掉
      (dom as unknown as Record<string, unknown>)[key] = false;
      continue;
    }
    if (key === "value") {
      (dom as unknown as { value: string }).value = "";
      continue;
    }
    dom.removeAttribute(key);
  }

  for (const key of Object.keys(next)) {
    if (skipKey(key)) continue;
    const value = next[key];
    if (prev[key] === value) continue;
    if (isEventProp(key)) continue;
    if (key === "style" && value && typeof value === "object") {
      const prevStyle = (
        prev[key] && typeof prev[key] === "object" ? prev[key] : {}
      ) as Record<string, string>;
      const nextStyle = value as Record<string, string>;
      for (const name of Object.keys(prevStyle)) {
        if (!(name in nextStyle))
          (dom.style as unknown as Record<string, string>)[name] = "";
      }
      for (const name of Object.keys(nextStyle)) {
        if (prevStyle[name] !== nextStyle[name]) {
          (dom.style as unknown as Record<string, string>)[name] =
            nextStyle[name];
        }
      }
      continue;
    }
    if (key in dom || typeof value === "boolean") {
      // 与 React 一致：DOM 上已有同名 property 时走 property（这样 disabled=false 才会
      // 真正取消禁用，而不是留下 disabled="false" 这个"存在即生效"的属性）
      (dom as unknown as Record<string, unknown>)[key] = value;
      continue;
    }
    dom.setAttribute(key, String(value));
  }
}

export const DELEGATED_EVENTS = ["click", "input", "change"] as const;

/**
 * 在根容器上为每类事件只挂一个监听器（事件委托）。
 * 真实 React 17+ 也是把事件统一委托到 root 容器，而不是每个元素各挂一份。
 */
export function installEventDelegation(container: HTMLElement): void {
  if (
    (container as unknown as { __miniReactDelegated?: boolean })
      .__miniReactDelegated
  )
    return;
  (
    container as unknown as { __miniReactDelegated?: boolean }
  ).__miniReactDelegated = true;
  for (const type of DELEGATED_EVENTS) {
    container.addEventListener(type, (nativeEvent) =>
      dispatchDelegated(container, nativeEvent),
    );
  }
}

/**
 * 派发委托事件：从事件源沿 DOM 向上冒泡，边走边找"对应 fiber 上是否声明了该事件"。
 * 这样合成的冒泡行为与浏览器原生冒泡一致，且 stopPropagation 能真正阻断后续处理。
 */
function dispatchDelegated(container: HTMLElement, nativeEvent: Event): void {
  let stopped = false;
  const handlerName = `on${nativeEvent.type[0].toUpperCase()}${nativeEvent.type.slice(1)}`;
  const syntheticEvent = {
    type: nativeEvent.type,
    target: nativeEvent.target,
    currentTarget: null as EventTarget | null,
    nativeEvent,
    preventDefault: () => nativeEvent.preventDefault(),
    stopPropagation: () => {
      stopped = true;
    },
  };

  let node: Node | null = nativeEvent.target as Node | null;
  while (node && node !== container) {
    const fiber = (node as unknown as { __fiber?: Fiber }).__fiber;
    const handler = fiber?.props[handlerName];
    if (typeof handler === "function") {
      syntheticEvent.currentTarget = node;
      (handler as (event: typeof syntheticEvent) => void)(syntheticEvent);
      if (stopped) return;
    }
    node = node.parentNode;
  }
}
