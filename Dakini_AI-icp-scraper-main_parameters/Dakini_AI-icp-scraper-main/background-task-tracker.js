function createBackgroundTaskTracker(onError = (label, error) => {
  console.error(`${label} failed: ${error.message}`);
}) {
  const tasks = new Set();

  function track(task, label) {
    const trackedTask = Promise.resolve(task);
    tasks.add(trackedTask);

    return trackedTask
      .catch(error => {
        onError(label, error);
      })
      .finally(() => {
        tasks.delete(trackedTask);
      });
  }

  async function drain() {
    while (tasks.size > 0) {
      await Promise.allSettled([...tasks]);
    }
  }

  return {
    track,
    drain,
    get size() {
      return tasks.size;
    }
  };
}

module.exports = { createBackgroundTaskTracker };
