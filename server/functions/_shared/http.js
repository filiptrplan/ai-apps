// What the AI functions throw to answer with an error: routes/fn.js turns it
// into { error: message } with this status, and shared/ai.js's callAI shows
// the message as is. Anything else a function throws is a 500.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
