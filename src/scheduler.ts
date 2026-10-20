/**
 * 调度器：用 MessageChannel 把一个宏任务排进事件循环。
 *
 * React 在浏览器里用的是 Scheduler 包的 MessageChannel（非浏览器环境降级为 setTimeout），
 * 目的都是拿到"可被浏览器在帧之间打断的宏任务"，从而实现时间切片。
 */

const taskQueue: Array<() => void> = [];
let channel: MessageChannel | null = null;

function ensureChannel(): void {
  if (channel || typeof MessageChannel !== 'function') return;
  channel = new MessageChannel();
  // onmessage 赋值即自动 start()；Node 与浏览器的 MessagePort 行为一致
  channel.port1.onmessage = () => {
    const task = taskQueue.shift();
    task?.();
  };
}

function postTask(task: () => void): void {
  ensureChannel();
  if (channel) {
    taskQueue.push(task);
    channel.port2.postMessage(null);
    return;
  }
  // 兜底：没有 MessageChannel 的环境用 setTimeout
  setTimeout(task, 0);
}

/** 把一个回调排进调度队列（内部使用） */
export function scheduleHostCallback(task: () => void): void {
  postTask(task);
}

/**
 * 测试与示例用：返回一个 Promise，在所有已排队的任务执行完后 resolve。
 * 与渲染任务共用同一个 MessagePort，因此严格满足先进先出。
 */
export function flushScheduled(): Promise<void> {
  return new Promise<void>((resolve) => postTask(() => resolve()));
}
