export default class Logger {
  constructor(eventBus, debug_mode = false) {
    this.eventBus = eventBus;
    this.logs = [];
    this.debug_mode = debug_mode;
    this.#subscribeToAllEvents();
  }

  #subscribeToAllEvents() {
    this.eventBus.VALID_EVENTS.forEach((e) =>
      this.eventBus.subscribe(e, (payload) => this.#logEvent(e, payload))
    );
  }

  #getTimestamp() {
    const date = new Date();
    const dateString = date.toUTCString().split(" ").slice(1, -1).join(" ");
    return dateString + `:${date.getMilliseconds()}`;
  }

  #logEvent(eventName, payload) {
    this.logs.push({
      timestamp: this.#getTimestamp(),
      type: eventName,
      payload: JSON.parse(JSON.stringify(payload)),
    });
    this.debug_mode && console.log(this.getLastLog());
  }

  logAction(action) {
    this.logs.push({
      timestamp: this.#getTimestamp(),
      type: "UserAction",
      payload: JSON.parse(JSON.stringify(action)),
    });
    this.debug_mode && console.log(this.getLastLog());
  }

  getLogs() {
    return this.logs.slice();
  }

  getLastLog(verboseMode = false) {
    if (this.logs.length <= 0) return "No logs available.";
    const lastLog = this.logs[this.logs.length - 1];
    return verboseMode
      ? `[${lastLog.timestamp}] ${lastLog.type}: ${JSON.stringify(lastLog.payload)}`
      : `[${lastLog.timestamp}] EventType: ${lastLog.type}`;
  }

  clear() {
    this.logs = [];
  }
}
