import type { Fiber } from './fiber';

/**
 * 全局可变状态集中在一处，避免模块之间循环依赖。
 *
 * 真实 React 里这些状态同样以"模块级单例"的形式存在于
 * ReactFiberWorkLoop（workInProgress / workInProgressRoot /
 * workInProgressRootRenderLanes）等模块中。
 */
export interface GlobalState {
  /** 当前正在渲染的函数组件 fiber（useState 等 Hook 需要知道"挂在谁身上"） */
  wipFiber: Fiber | null;
  /** 当前函数组件内的 Hook 游标（Hook 按调用顺序存储，靠下标定位） */
  hookIndex: number;
  /** 正在构建的 work-in-progress 树的根 */
  wipRoot: Fiber | null;
  /** 上一次提交完成、当前正在显示的树（双缓存里的 current） */
  currentRoot: Fiber | null;
  /** 下一个待处理的工作单元（render 阶段的可中断游标） */
  nextUnitOfWork: Fiber | null;
  /** 本轮渲染中收集到的待删除 fiber（提交阶段统一处理） */
  deletions: Fiber[];
  /** 挂载容器 */
  container: HTMLElement | null;
  /** 根元素（更新时用同一个根元素重建 work-in-progress 树） */
  element: unknown;
  /** 是否已安排了一次调度（用于把同一批次的多次 setState 合并为一次渲染） */
  isScheduled: boolean;
}

export const state: GlobalState = {
  wipFiber: null,
  hookIndex: 0,
  wipRoot: null,
  currentRoot: null,
  nextUnitOfWork: null,
  deletions: [],
  container: null,
  element: null,
  isScheduled: false,
};
