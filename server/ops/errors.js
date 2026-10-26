'use strict';

class OpsError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'OpsError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) { throw new OpsError(status, code, message); }
function assert(condition, status, code, message) { if (!condition) fail(status, code, message); }

module.exports = { OpsError, fail, assert };
