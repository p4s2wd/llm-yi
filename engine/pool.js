export function createPool(concurrency) {
  let active = 0;
  const queue = [];
  function pump() {
    while (active < concurrency && queue.length) {
      active++;
      const { task, resolve, reject } = queue.shift();
      Promise.resolve()
        .then(task)
        .then(resolve, reject)
        .finally(() => { active--; pump(); });
    }
  }
  return {
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        pump();
      });
    },
  };
}
