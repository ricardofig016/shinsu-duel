export default class Logger {
  DEBUGGER = true; // flag to print every log to console

  constructor(eventBus) {
    this.eventBus = eventBus;
    this.logs = [];
    this.#subscribeToAllEvents();
  }

  #subscribeToAllEvents() {
    this.eventBus.VALID_EVENTS.forEach((e) =>
      this.eventBus.subscribe(e, (payload) => this.#logEvent(e, payload))
    );
  }

  #logEvent(eventName, payload) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      type: eventName,
      payload: JSON.parse(JSON.stringify(payload)),
    });
    this.DEBUGGER && console.log(this.getLastLog() + "\n");
  }

  logAction(action) {
    this.logs.push({
      timestamp: new Date().toISOString(),
      type: "UserAction",
      payload: JSON.parse(JSON.stringify(action)),
    });
    this.DEBUGGER && console.log(this.getLastLog() + "\n");
  }

  getLogs() {
    return this.logs.slice();
  }

  getLastLog() {
    if (this.logs.length > 0) {
      const lastLog = this.logs[this.logs.length - 1];
      return `[${lastLog.timestamp}] ${lastLog.type}: ${JSON.stringify(lastLog.payload)}`;
    } else {
      return "No logs available.";
    }
  }

  clear() {
    this.logs = [];
  }
}
