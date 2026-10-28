function pauseEngineState(engine) {
  engine.enabled = false;
  if (engine.status === "running") {
    engine.currentActivity = "Finishing current cycle · paused";
  } else {
    engine.status = "paused";
    engine.currentActivity = "Engine paused by operator";
  }
  return engine;
}

module.exports = { pauseEngineState };
