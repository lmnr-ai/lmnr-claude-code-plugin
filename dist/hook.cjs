"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@opentelemetry/api/build/esm/version.js
var VERSION;
var init_version = __esm({
  "node_modules/@opentelemetry/api/build/esm/version.js"() {
    VERSION = "1.9.1";
  }
});

// node_modules/@opentelemetry/api/build/esm/internal/semver.js
function _makeCompatibilityCheck(ownVersion) {
  const acceptedVersions = /* @__PURE__ */ new Set([ownVersion]);
  const rejectedVersions = /* @__PURE__ */ new Set();
  const myVersionMatch = ownVersion.match(re);
  if (!myVersionMatch) {
    return () => false;
  }
  const ownVersionParsed = {
    major: +myVersionMatch[1],
    minor: +myVersionMatch[2],
    patch: +myVersionMatch[3],
    prerelease: myVersionMatch[4]
  };
  if (ownVersionParsed.prerelease != null) {
    return function isExactmatch(globalVersion) {
      return globalVersion === ownVersion;
    };
  }
  function _reject(v) {
    rejectedVersions.add(v);
    return false;
  }
  function _accept(v) {
    acceptedVersions.add(v);
    return true;
  }
  return function isCompatible2(globalVersion) {
    if (acceptedVersions.has(globalVersion)) {
      return true;
    }
    if (rejectedVersions.has(globalVersion)) {
      return false;
    }
    const globalVersionMatch = globalVersion.match(re);
    if (!globalVersionMatch) {
      return _reject(globalVersion);
    }
    const globalVersionParsed = {
      major: +globalVersionMatch[1],
      minor: +globalVersionMatch[2],
      patch: +globalVersionMatch[3],
      prerelease: globalVersionMatch[4]
    };
    if (globalVersionParsed.prerelease != null) {
      return _reject(globalVersion);
    }
    if (ownVersionParsed.major !== globalVersionParsed.major) {
      return _reject(globalVersion);
    }
    if (ownVersionParsed.major === 0) {
      if (ownVersionParsed.minor === globalVersionParsed.minor && ownVersionParsed.patch <= globalVersionParsed.patch) {
        return _accept(globalVersion);
      }
      return _reject(globalVersion);
    }
    if (ownVersionParsed.minor <= globalVersionParsed.minor) {
      return _accept(globalVersion);
    }
    return _reject(globalVersion);
  };
}
var re, isCompatible;
var init_semver = __esm({
  "node_modules/@opentelemetry/api/build/esm/internal/semver.js"() {
    init_version();
    re = /^(\d+)\.(\d+)\.(\d+)(-(.+))?$/;
    isCompatible = _makeCompatibilityCheck(VERSION);
  }
});

// node_modules/@opentelemetry/api/build/esm/internal/global-utils.js
function registerGlobal(type, instance, diag3, allowOverride = false) {
  var _a;
  const api = _global[GLOBAL_OPENTELEMETRY_API_KEY] = (_a = _global[GLOBAL_OPENTELEMETRY_API_KEY]) !== null && _a !== void 0 ? _a : {
    version: VERSION
  };
  if (!allowOverride && api[type]) {
    const err = new Error(`@opentelemetry/api: Attempted duplicate registration of API: ${type}`);
    diag3.error(err.stack || err.message);
    return false;
  }
  if (api.version !== VERSION) {
    const err = new Error(`@opentelemetry/api: Registration of version v${api.version} for ${type} does not match previously registered API v${VERSION}`);
    diag3.error(err.stack || err.message);
    return false;
  }
  api[type] = instance;
  diag3.debug(`@opentelemetry/api: Registered a global for ${type} v${VERSION}.`);
  return true;
}
function getGlobal(type) {
  var _a, _b;
  const globalVersion = (_a = _global[GLOBAL_OPENTELEMETRY_API_KEY]) === null || _a === void 0 ? void 0 : _a.version;
  if (!globalVersion || !isCompatible(globalVersion)) {
    return;
  }
  return (_b = _global[GLOBAL_OPENTELEMETRY_API_KEY]) === null || _b === void 0 ? void 0 : _b[type];
}
function unregisterGlobal(type, diag3) {
  diag3.debug(`@opentelemetry/api: Unregistering a global for ${type} v${VERSION}.`);
  const api = _global[GLOBAL_OPENTELEMETRY_API_KEY];
  if (api) {
    delete api[type];
  }
}
var major, GLOBAL_OPENTELEMETRY_API_KEY, _global;
var init_global_utils = __esm({
  "node_modules/@opentelemetry/api/build/esm/internal/global-utils.js"() {
    init_version();
    init_semver();
    major = VERSION.split(".")[0];
    GLOBAL_OPENTELEMETRY_API_KEY = Symbol.for(`opentelemetry.js.api.${major}`);
    _global = typeof globalThis === "object" ? globalThis : typeof self === "object" ? self : typeof window === "object" ? window : typeof global === "object" ? global : {};
  }
});

// node_modules/@opentelemetry/api/build/esm/diag/ComponentLogger.js
function logProxy(funcName, namespace, args) {
  const logger = getGlobal("diag");
  if (!logger) {
    return;
  }
  return logger[funcName](namespace, ...args);
}
var DiagComponentLogger;
var init_ComponentLogger = __esm({
  "node_modules/@opentelemetry/api/build/esm/diag/ComponentLogger.js"() {
    init_global_utils();
    DiagComponentLogger = class {
      constructor(props) {
        this._namespace = props.namespace || "DiagComponentLogger";
      }
      debug(...args) {
        return logProxy("debug", this._namespace, args);
      }
      error(...args) {
        return logProxy("error", this._namespace, args);
      }
      info(...args) {
        return logProxy("info", this._namespace, args);
      }
      warn(...args) {
        return logProxy("warn", this._namespace, args);
      }
      verbose(...args) {
        return logProxy("verbose", this._namespace, args);
      }
    };
  }
});

// node_modules/@opentelemetry/api/build/esm/diag/types.js
var DiagLogLevel;
var init_types = __esm({
  "node_modules/@opentelemetry/api/build/esm/diag/types.js"() {
    (function(DiagLogLevel2) {
      DiagLogLevel2[DiagLogLevel2["NONE"] = 0] = "NONE";
      DiagLogLevel2[DiagLogLevel2["ERROR"] = 30] = "ERROR";
      DiagLogLevel2[DiagLogLevel2["WARN"] = 50] = "WARN";
      DiagLogLevel2[DiagLogLevel2["INFO"] = 60] = "INFO";
      DiagLogLevel2[DiagLogLevel2["DEBUG"] = 70] = "DEBUG";
      DiagLogLevel2[DiagLogLevel2["VERBOSE"] = 80] = "VERBOSE";
      DiagLogLevel2[DiagLogLevel2["ALL"] = 9999] = "ALL";
    })(DiagLogLevel || (DiagLogLevel = {}));
  }
});

// node_modules/@opentelemetry/api/build/esm/diag/internal/logLevelLogger.js
function createLogLevelDiagLogger(maxLevel, logger) {
  if (maxLevel < DiagLogLevel.NONE) {
    maxLevel = DiagLogLevel.NONE;
  } else if (maxLevel > DiagLogLevel.ALL) {
    maxLevel = DiagLogLevel.ALL;
  }
  logger = logger || {};
  function _filterFunc(funcName, theLevel) {
    const theFunc = logger[funcName];
    if (typeof theFunc === "function" && maxLevel >= theLevel) {
      return theFunc.bind(logger);
    }
    return function() {
    };
  }
  return {
    error: _filterFunc("error", DiagLogLevel.ERROR),
    warn: _filterFunc("warn", DiagLogLevel.WARN),
    info: _filterFunc("info", DiagLogLevel.INFO),
    debug: _filterFunc("debug", DiagLogLevel.DEBUG),
    verbose: _filterFunc("verbose", DiagLogLevel.VERBOSE)
  };
}
var init_logLevelLogger = __esm({
  "node_modules/@opentelemetry/api/build/esm/diag/internal/logLevelLogger.js"() {
    init_types();
  }
});

// node_modules/@opentelemetry/api/build/esm/api/diag.js
var API_NAME, DiagAPI;
var init_diag = __esm({
  "node_modules/@opentelemetry/api/build/esm/api/diag.js"() {
    init_ComponentLogger();
    init_logLevelLogger();
    init_types();
    init_global_utils();
    API_NAME = "diag";
    DiagAPI = class _DiagAPI {
      /** Get the singleton instance of the DiagAPI API */
      static instance() {
        if (!this._instance) {
          this._instance = new _DiagAPI();
        }
        return this._instance;
      }
      /**
       * Private internal constructor
       * @private
       */
      constructor() {
        function _logProxy(funcName) {
          return function(...args) {
            const logger = getGlobal("diag");
            if (!logger)
              return;
            return logger[funcName](...args);
          };
        }
        const self2 = this;
        const setLogger = (logger, optionsOrLogLevel = { logLevel: DiagLogLevel.INFO }) => {
          var _a, _b, _c;
          if (logger === self2) {
            const err = new Error("Cannot use diag as the logger for itself. Please use a DiagLogger implementation like ConsoleDiagLogger or a custom implementation");
            self2.error((_a = err.stack) !== null && _a !== void 0 ? _a : err.message);
            return false;
          }
          if (typeof optionsOrLogLevel === "number") {
            optionsOrLogLevel = {
              logLevel: optionsOrLogLevel
            };
          }
          const oldLogger = getGlobal("diag");
          const newLogger = createLogLevelDiagLogger((_b = optionsOrLogLevel.logLevel) !== null && _b !== void 0 ? _b : DiagLogLevel.INFO, logger);
          if (oldLogger && !optionsOrLogLevel.suppressOverrideMessage) {
            const stack = (_c = new Error().stack) !== null && _c !== void 0 ? _c : "<failed to generate stacktrace>";
            oldLogger.warn(`Current logger will be overwritten from ${stack}`);
            newLogger.warn(`Current logger will overwrite one already registered from ${stack}`);
          }
          return registerGlobal("diag", newLogger, self2, true);
        };
        self2.setLogger = setLogger;
        self2.disable = () => {
          unregisterGlobal(API_NAME, self2);
        };
        self2.createComponentLogger = (options) => {
          return new DiagComponentLogger(options);
        };
        self2.verbose = _logProxy("verbose");
        self2.debug = _logProxy("debug");
        self2.info = _logProxy("info");
        self2.warn = _logProxy("warn");
        self2.error = _logProxy("error");
      }
    };
  }
});

// node_modules/@opentelemetry/api/build/esm/baggage/internal/symbol.js
var baggageEntryMetadataSymbol;
var init_symbol = __esm({
  "node_modules/@opentelemetry/api/build/esm/baggage/internal/symbol.js"() {
    baggageEntryMetadataSymbol = Symbol("BaggageEntryMetadata");
  }
});

// node_modules/@opentelemetry/api/build/esm/baggage/utils.js
function baggageEntryMetadataFromString(str) {
  if (typeof str !== "string") {
    diag.error(`Cannot create baggage metadata from unknown type: ${typeof str}`);
    str = "";
  }
  return {
    __TYPE__: baggageEntryMetadataSymbol,
    toString() {
      return str;
    }
  };
}
var diag;
var init_utils = __esm({
  "node_modules/@opentelemetry/api/build/esm/baggage/utils.js"() {
    init_diag();
    init_symbol();
    diag = DiagAPI.instance();
  }
});

// node_modules/@opentelemetry/api/build/esm/metrics/NoopMeter.js
function createNoopMeter() {
  return NOOP_METER;
}
var NoopMeter, NoopMetric, NoopCounterMetric, NoopUpDownCounterMetric, NoopGaugeMetric, NoopHistogramMetric, NoopObservableMetric, NoopObservableCounterMetric, NoopObservableGaugeMetric, NoopObservableUpDownCounterMetric, NOOP_METER, NOOP_COUNTER_METRIC, NOOP_GAUGE_METRIC, NOOP_HISTOGRAM_METRIC, NOOP_UP_DOWN_COUNTER_METRIC, NOOP_OBSERVABLE_COUNTER_METRIC, NOOP_OBSERVABLE_GAUGE_METRIC, NOOP_OBSERVABLE_UP_DOWN_COUNTER_METRIC;
var init_NoopMeter = __esm({
  "node_modules/@opentelemetry/api/build/esm/metrics/NoopMeter.js"() {
    NoopMeter = class {
      constructor() {
      }
      /**
       * @see {@link Meter.createGauge}
       */
      createGauge(_name, _options) {
        return NOOP_GAUGE_METRIC;
      }
      /**
       * @see {@link Meter.createHistogram}
       */
      createHistogram(_name, _options) {
        return NOOP_HISTOGRAM_METRIC;
      }
      /**
       * @see {@link Meter.createCounter}
       */
      createCounter(_name, _options) {
        return NOOP_COUNTER_METRIC;
      }
      /**
       * @see {@link Meter.createUpDownCounter}
       */
      createUpDownCounter(_name, _options) {
        return NOOP_UP_DOWN_COUNTER_METRIC;
      }
      /**
       * @see {@link Meter.createObservableGauge}
       */
      createObservableGauge(_name, _options) {
        return NOOP_OBSERVABLE_GAUGE_METRIC;
      }
      /**
       * @see {@link Meter.createObservableCounter}
       */
      createObservableCounter(_name, _options) {
        return NOOP_OBSERVABLE_COUNTER_METRIC;
      }
      /**
       * @see {@link Meter.createObservableUpDownCounter}
       */
      createObservableUpDownCounter(_name, _options) {
        return NOOP_OBSERVABLE_UP_DOWN_COUNTER_METRIC;
      }
      /**
       * @see {@link Meter.addBatchObservableCallback}
       */
      addBatchObservableCallback(_callback, _observables) {
      }
      /**
       * @see {@link Meter.removeBatchObservableCallback}
       */
      removeBatchObservableCallback(_callback) {
      }
    };
    NoopMetric = class {
    };
    NoopCounterMetric = class extends NoopMetric {
      add(_value, _attributes) {
      }
    };
    NoopUpDownCounterMetric = class extends NoopMetric {
      add(_value, _attributes) {
      }
    };
    NoopGaugeMetric = class extends NoopMetric {
      record(_value, _attributes) {
      }
    };
    NoopHistogramMetric = class extends NoopMetric {
      record(_value, _attributes) {
      }
    };
    NoopObservableMetric = class {
      addCallback(_callback) {
      }
      removeCallback(_callback) {
      }
    };
    NoopObservableCounterMetric = class extends NoopObservableMetric {
    };
    NoopObservableGaugeMetric = class extends NoopObservableMetric {
    };
    NoopObservableUpDownCounterMetric = class extends NoopObservableMetric {
    };
    NOOP_METER = new NoopMeter();
    NOOP_COUNTER_METRIC = new NoopCounterMetric();
    NOOP_GAUGE_METRIC = new NoopGaugeMetric();
    NOOP_HISTOGRAM_METRIC = new NoopHistogramMetric();
    NOOP_UP_DOWN_COUNTER_METRIC = new NoopUpDownCounterMetric();
    NOOP_OBSERVABLE_COUNTER_METRIC = new NoopObservableCounterMetric();
    NOOP_OBSERVABLE_GAUGE_METRIC = new NoopObservableGaugeMetric();
    NOOP_OBSERVABLE_UP_DOWN_COUNTER_METRIC = new NoopObservableUpDownCounterMetric();
  }
});

// node_modules/@opentelemetry/api/build/esm/trace/trace_flags.js
var TraceFlags;
var init_trace_flags = __esm({
  "node_modules/@opentelemetry/api/build/esm/trace/trace_flags.js"() {
    (function(TraceFlags2) {
      TraceFlags2[TraceFlags2["NONE"] = 0] = "NONE";
      TraceFlags2[TraceFlags2["SAMPLED"] = 1] = "SAMPLED";
    })(TraceFlags || (TraceFlags = {}));
  }
});

// node_modules/@opentelemetry/api/build/esm/trace/span_kind.js
var SpanKind;
var init_span_kind = __esm({
  "node_modules/@opentelemetry/api/build/esm/trace/span_kind.js"() {
    (function(SpanKind2) {
      SpanKind2[SpanKind2["INTERNAL"] = 0] = "INTERNAL";
      SpanKind2[SpanKind2["SERVER"] = 1] = "SERVER";
      SpanKind2[SpanKind2["CLIENT"] = 2] = "CLIENT";
      SpanKind2[SpanKind2["PRODUCER"] = 3] = "PRODUCER";
      SpanKind2[SpanKind2["CONSUMER"] = 4] = "CONSUMER";
    })(SpanKind || (SpanKind = {}));
  }
});

// node_modules/@opentelemetry/api/build/esm/trace/status.js
var SpanStatusCode;
var init_status = __esm({
  "node_modules/@opentelemetry/api/build/esm/trace/status.js"() {
    (function(SpanStatusCode2) {
      SpanStatusCode2[SpanStatusCode2["UNSET"] = 0] = "UNSET";
      SpanStatusCode2[SpanStatusCode2["OK"] = 1] = "OK";
      SpanStatusCode2[SpanStatusCode2["ERROR"] = 2] = "ERROR";
    })(SpanStatusCode || (SpanStatusCode = {}));
  }
});

// node_modules/@opentelemetry/api/build/esm/diag-api.js
var diag2;
var init_diag_api = __esm({
  "node_modules/@opentelemetry/api/build/esm/diag-api.js"() {
    init_diag();
    diag2 = DiagAPI.instance();
  }
});

// node_modules/@opentelemetry/api/build/esm/index.js
var init_esm = __esm({
  "node_modules/@opentelemetry/api/build/esm/index.js"() {
    init_utils();
    init_NoopMeter();
    init_span_kind();
    init_status();
    init_trace_flags();
    init_diag_api();
  }
});

// src/hook.ts
var fs7 = __toESM(require("node:fs"), 1);
var path7 = __toESM(require("node:path"), 1);

// src/config.ts
var fs = __toESM(require("node:fs"), 1);
var os = __toESM(require("node:os"), 1);
var path = __toESM(require("node:path"), 1);
var env = (name) => process.env[name] ?? "";
var nonEmpty = (v) => typeof v === "string" ? v : "";
var DEBUG = env("CC_LMNR_DEBUG").toLowerCase() === "true";
var CAPTURE_SKILL_CONTENT = env("CC_LMNR_CAPTURE_SKILL_CONTENT").toLowerCase() === "true";
var MAX_CHARS = Number.parseInt(env("CC_LMNR_MAX_CHARS"), 10) || 2e4;
var EXPORT_TIMEOUT_MS = 5e3;
function lmnrConfigDir() {
  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, "lmnr");
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "lmnr");
  }
  return path.join(os.homedir(), ".config", "lmnr");
}
function readJsonObject(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf-8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
function getLaminarConfig() {
  const plugin = readJsonObject(path.join(lmnrConfigDir(), "claude-code-plugin.json"));
  const apiKey = env("LMNR_PROJECT_API_KEY") || nonEmpty(plugin.projectApiKey);
  if (!apiKey) {
    return null;
  }
  const baseUrl = (env("LMNR_BASE_URL") || nonEmpty(plugin.baseUrl) || "https://api.lmnr.ai").replace(/\/+$/, "");
  const creds = readJsonObject(path.join(lmnrConfigDir(), "credentials.json"));
  const userId = env("LMNR_USER_ID") || nonEmpty(creds.userEmail) || nonEmpty(creds.userId) || null;
  return { apiKey, baseUrl, userId };
}
function stateDir() {
  return env("CC_LMNR_STATE_DIR") || path.join(os.homedir(), ".claude", "state");
}
var LOG_MAX_BYTES = 5e6;
function writeLog(level, msg) {
  try {
    const file = path.join(stateDir(), "lmnr_hook.log");
    fs.mkdirSync(stateDir(), { recursive: true });
    try {
      if (fs.statSync(file).size > LOG_MAX_BYTES) {
        fs.renameSync(file, `${file}.1`);
      }
    } catch {
    }
    fs.appendFileSync(file, `${(/* @__PURE__ */ new Date()).toISOString()} [${level}] ${msg}
`, "utf-8");
  } catch {
  }
}
function debug(msg) {
  if (DEBUG) {
    writeLog("DEBUG", msg);
  }
}
function info(msg) {
  writeLog("INFO", msg);
}

// src/pipeline.ts
var fs6 = __toESM(require("node:fs"), 1);

// src/otlp.ts
var crypto = __toESM(require("node:crypto"), 1);
init_esm();

// node_modules/@opentelemetry/core/build/esm/baggage/constants.js
var BAGGAGE_KEY_PAIR_SEPARATOR = "=";
var BAGGAGE_PROPERTIES_SEPARATOR = ";";
var BAGGAGE_ITEMS_SEPARATOR = ",";

// node_modules/@opentelemetry/core/build/esm/baggage/utils.js
init_esm();
function parsePairKeyValue(entry) {
  if (!entry)
    return;
  const metadataSeparatorIndex = entry.indexOf(BAGGAGE_PROPERTIES_SEPARATOR);
  const keyPairPart = metadataSeparatorIndex === -1 ? entry : entry.substring(0, metadataSeparatorIndex);
  const separatorIndex = keyPairPart.indexOf(BAGGAGE_KEY_PAIR_SEPARATOR);
  if (separatorIndex <= 0)
    return;
  const rawKey = keyPairPart.substring(0, separatorIndex).trim();
  const rawValue = keyPairPart.substring(separatorIndex + 1).trim();
  if (!rawKey || !rawValue)
    return;
  let key;
  let value;
  try {
    key = decodeURIComponent(rawKey);
    value = decodeURIComponent(rawValue);
  } catch {
    return;
  }
  let metadata;
  if (metadataSeparatorIndex !== -1 && metadataSeparatorIndex < entry.length - 1) {
    const metadataString = entry.substring(metadataSeparatorIndex + 1);
    metadata = baggageEntryMetadataFromString(metadataString);
  }
  return { key, value, metadata };
}
function parseKeyPairsIntoRecord(value) {
  const result = {};
  if (typeof value === "string" && value.length > 0) {
    value.split(BAGGAGE_ITEMS_SEPARATOR).forEach((entry) => {
      const keyPair = parsePairKeyValue(entry);
      if (keyPair !== void 0 && keyPair.value.length > 0) {
        result[keyPair.key] = keyPair.value;
      }
    });
  }
  return result;
}

// node_modules/@opentelemetry/core/build/esm/platform/node/environment.js
init_esm();
var import_util = require("util");
function getNumberFromEnv(key) {
  const raw = process.env[key];
  if (raw == null || raw.trim() === "") {
    return void 0;
  }
  const value = Number(raw);
  if (isNaN(value)) {
    diag2.warn(`Unknown value ${(0, import_util.inspect)(raw)} for ${key}, expected a number, using defaults`);
    return void 0;
  }
  return value;
}
function getStringFromEnv(key) {
  const raw = process.env[key];
  if (raw == null || raw.trim() === "") {
    return void 0;
  }
  return raw;
}

// node_modules/@opentelemetry/core/build/esm/platform/node/index.js
var otperformance = performance;

// node_modules/@opentelemetry/core/build/esm/common/time.js
var NANOSECOND_DIGITS = 9;
var NANOSECOND_DIGITS_IN_MILLIS = 6;
var MILLISECONDS_TO_NANOSECONDS = Math.pow(10, NANOSECOND_DIGITS_IN_MILLIS);
var SECOND_TO_NANOSECONDS = Math.pow(10, NANOSECOND_DIGITS);
function millisToHrTime(epochMillis) {
  const epochSeconds = epochMillis / 1e3;
  const seconds = Math.trunc(epochSeconds);
  const nanos = Math.round(epochMillis % 1e3 * MILLISECONDS_TO_NANOSECONDS);
  return [seconds, nanos];
}
function hrTime(performanceNow) {
  const timeOrigin = millisToHrTime(otperformance.timeOrigin);
  const now = millisToHrTime(typeof performanceNow === "number" ? performanceNow : otperformance.now());
  return addHrTimes(timeOrigin, now);
}
function hrTimeDuration(startTime, endTime) {
  let seconds = endTime[0] - startTime[0];
  let nanos = endTime[1] - startTime[1];
  if (nanos < 0) {
    seconds -= 1;
    nanos += SECOND_TO_NANOSECONDS;
  }
  return [seconds, nanos];
}
function hrTimeToNanoseconds(time) {
  return time[0] * SECOND_TO_NANOSECONDS + time[1];
}
function hrTimeToMilliseconds(time) {
  return time[0] * 1e3 + time[1] / 1e6;
}
function addHrTimes(time1, time2) {
  const out = [time1[0] + time2[0], time1[1] + time2[1]];
  if (out[1] >= SECOND_TO_NANOSECONDS) {
    out[1] -= SECOND_TO_NANOSECONDS;
    out[0] += 1;
  }
  return out;
}

// node_modules/@opentelemetry/core/build/esm/ExportResult.js
var ExportResultCode;
(function(ExportResultCode2) {
  ExportResultCode2[ExportResultCode2["SUCCESS"] = 0] = "SUCCESS";
  ExportResultCode2[ExportResultCode2["FAILED"] = 1] = "FAILED";
})(ExportResultCode || (ExportResultCode = {}));

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/OTLPExporterBase.js
var OTLPExporterBase = class {
  _delegate;
  constructor(delegate) {
    this._delegate = delegate;
  }
  /**
   * Export items.
   * @param items
   * @param resultCallback
   */
  export(items, resultCallback) {
    this._delegate.export(items, resultCallback);
  }
  forceFlush() {
    return this._delegate.forceFlush();
  }
  shutdown() {
    return this._delegate.shutdown();
  }
  setMetrics(metrics) {
    this._delegate.setMetrics(metrics);
  }
};

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/types.js
var OTLPExporterError = class extends Error {
  code;
  name = "OTLPExporterError";
  data;
  constructor(message, code, data) {
    super(message);
    this.data = data;
    this.code = code;
  }
};

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/configuration/shared-configuration.js
function validateTimeoutMillis(timeoutMillis) {
  if (Number.isFinite(timeoutMillis) && timeoutMillis > 0) {
    return timeoutMillis;
  }
  throw new Error(`Configuration: timeoutMillis is invalid, expected number greater than 0 (actual: '${timeoutMillis}')`);
}
function wrapStaticHeadersInFunction(headers) {
  if (headers == null) {
    return void 0;
  }
  return async () => headers;
}
function mergeOtlpSharedConfigurationWithDefaults(userProvidedConfiguration, fallbackConfiguration, defaultConfiguration) {
  return {
    timeoutMillis: validateTimeoutMillis(userProvidedConfiguration.timeoutMillis ?? fallbackConfiguration.timeoutMillis ?? defaultConfiguration.timeoutMillis),
    concurrencyLimit: userProvidedConfiguration.concurrencyLimit ?? fallbackConfiguration.concurrencyLimit ?? defaultConfiguration.concurrencyLimit,
    compression: userProvidedConfiguration.compression ?? fallbackConfiguration.compression ?? defaultConfiguration.compression
  };
}
function getSharedConfigurationDefaults() {
  return {
    timeoutMillis: 1e4,
    concurrencyLimit: 30,
    compression: "none"
  };
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/bounded-queue-export-promise-handler.js
var BoundedQueueExportPromiseHandler = class {
  _concurrencyLimit;
  _sendingPromises = [];
  /**
   * @param concurrencyLimit maximum promises allowed in a queue at the same time.
   */
  constructor(concurrencyLimit) {
    this._concurrencyLimit = concurrencyLimit;
  }
  pushPromise(promise) {
    if (this.hasReachedLimit()) {
      throw new Error("Concurrency Limit reached");
    }
    this._sendingPromises.push(promise);
    const popPromise = () => {
      const index = this._sendingPromises.indexOf(promise);
      void this._sendingPromises.splice(index, 1);
    };
    promise.then(popPromise, popPromise);
  }
  hasReachedLimit() {
    return this._sendingPromises.length >= this._concurrencyLimit;
  }
  async awaitAll() {
    await Promise.all(this._sendingPromises);
  }
};
function createBoundedQueueExportPromiseHandler(options) {
  return new BoundedQueueExportPromiseHandler(options.concurrencyLimit);
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/logging-response-handler.js
init_esm();
function isPartialSuccessResponse(response) {
  return Object.prototype.hasOwnProperty.call(response, "partialSuccess");
}
function createLoggingPartialSuccessResponseHandler() {
  return {
    handleResponse(response) {
      if (response == null || !isPartialSuccessResponse(response) || response.partialSuccess == null || Object.keys(response.partialSuccess).length === 0) {
        return;
      }
      diag2.warn("Received Partial Success response:", JSON.stringify(response.partialSuccess));
    }
  };
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/otlp-export-delegate.js
init_esm();
var OTLPExportDelegate = class {
  _metrics;
  _diagLogger;
  _transport;
  _serializer;
  _responseHandler;
  _promiseQueue;
  _timeout;
  constructor(transport, serializer, responseHandler, promiseQueue, metrics, timeout) {
    this._transport = transport;
    this._serializer = serializer;
    this._responseHandler = responseHandler;
    this._promiseQueue = promiseQueue;
    this._timeout = timeout;
    this._diagLogger = diag2.createComponentLogger({
      namespace: "OTLPExportDelegate"
    });
    this._metrics = metrics;
  }
  export(internalRepresentation, resultCallback) {
    this._diagLogger.debug("items to be sent", internalRepresentation);
    if (this._promiseQueue.hasReachedLimit()) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error("Concurrent export limit reached")
      });
      return;
    }
    const serializedRequest = this._serializer.serializeRequest(internalRepresentation);
    if (serializedRequest == null) {
      resultCallback({
        code: ExportResultCode.FAILED,
        error: new Error("Nothing to send")
      });
      return;
    }
    const finishExport = this._metrics.startExport(internalRepresentation);
    this._promiseQueue.pushPromise(this._transport.send(serializedRequest, this._timeout).then((response) => {
      if (response.status === "success") {
        finishExport(void 0);
        if (response.data != null) {
          try {
            this._responseHandler.handleResponse(this._serializer.deserializeResponse(response.data));
          } catch (e) {
            this._diagLogger.warn("Export succeeded but could not deserialize response - is the response specification compliant?", e, response.data);
          }
        }
        resultCallback({
          code: ExportResultCode.SUCCESS
        });
        return;
      } else if (response.status === "failure" && response.error) {
        finishExport(response.error);
        resultCallback({
          code: ExportResultCode.FAILED,
          error: response.error
        });
        return;
      } else if (response.status === "retryable") {
        finishExport("export_max_retries");
        resultCallback({
          code: ExportResultCode.FAILED,
          error: response.error ?? new OTLPExporterError("Export failed with retryable status")
        });
      } else {
        finishExport("export_failed");
        resultCallback({
          code: ExportResultCode.FAILED,
          error: new OTLPExporterError("Export failed with unknown error")
        });
      }
    }, (reason) => {
      finishExport(reason);
      resultCallback({
        code: ExportResultCode.FAILED,
        error: reason
      });
    }));
  }
  forceFlush() {
    return this._promiseQueue.awaitAll();
  }
  setMetrics(metrics) {
    this._metrics = metrics;
  }
  async shutdown() {
    this._diagLogger.debug("shutdown started");
    await this.forceFlush();
    this._transport.shutdown();
  }
};
function createOtlpExportDelegate(components, settings) {
  return new OTLPExportDelegate(components.transport, components.serializer, createLoggingPartialSuccessResponseHandler(), components.promiseHandler, components.metrics, settings.timeout);
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/ExporterMetrics.js
init_esm();

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/semconv.js
var ATTR_HTTP_RESPONSE_STATUS_CODE = "http.response.status_code";
var ATTR_OTEL_COMPONENT_NAME = "otel.component.name";
var ATTR_OTEL_COMPONENT_TYPE = "otel.component.type";
var ATTR_SERVER_ADDRESS = "server.address";
var ATTR_SERVER_PORT = "server.port";
var ATTR_ERROR_TYPE = "error.type";

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/version.js
var VERSION2 = "0.223.0";

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/ExporterMetrics.js
var componentCounter = /* @__PURE__ */ new Map();
var ExporterMetrics = class {
  inflight;
  exported;
  duration;
  standardAttrs;
  responseAttributesFromError;
  helper;
  constructor(options) {
    const { componentType, metricsHelper, meterProvider, url, responseAttributesFromError } = options;
    this.responseAttributesFromError = responseAttributesFromError;
    const meter = meterProvider ? meterProvider.getMeter("@opentelemetry/otlp-exporter", VERSION2) : createNoopMeter();
    const counter = componentCounter.get(componentType) ?? 0;
    componentCounter.set(componentType, counter + 1);
    this.standardAttrs = {
      [ATTR_OTEL_COMPONENT_TYPE]: componentType,
      [ATTR_OTEL_COMPONENT_NAME]: `${componentType}/${counter}`
    };
    if (url) {
      let urlToParse = url;
      if (!url.includes("://")) {
        urlToParse = `http://${url}`;
      }
      try {
        const parsedUrl = new URL(urlToParse);
        this.standardAttrs[ATTR_SERVER_ADDRESS] = parsedUrl.hostname;
        let port = void 0;
        if (parsedUrl.port) {
          port = Number(parsedUrl.port);
        } else if (parsedUrl.protocol === "http:") {
          port = 80;
        } else if (parsedUrl.protocol === "https:") {
          port = 443;
        }
        if (typeof port === "number") {
          this.standardAttrs[ATTR_SERVER_PORT] = port;
        }
      } catch {
      }
    }
    this.helper = metricsHelper;
    this.inflight = meter.createUpDownCounter(`otel.sdk.exporter.${this.helper.name}.inflight`, {
      unit: `{${this.helper.name}}`,
      description: `The number of ${this.helper.name}s which were passed to the exporter, but that have not been exported yet (neither successful, nor failed).`
    });
    this.exported = meter.createCounter(`otel.sdk.exporter.${this.helper.name}.exported`, {
      unit: `{${this.helper.name}}`,
      description: `The number of ${this.helper.name}s for which the export has finished, either successful or failed.`
    });
    this.duration = meter.createHistogram("otel.sdk.exporter.operation.duration", {
      unit: "s",
      description: "The duration of exporting a batch of telemetry records.",
      advice: {
        explicitBucketBoundaries: []
      }
    });
  }
  startExport(request) {
    const numItems = this.helper.countItems(request);
    const startTime = hrTime();
    this.inflight.add(numItems, this.standardAttrs);
    return (error) => {
      const endTime = hrTime();
      this.inflight.add(-numItems, this.standardAttrs);
      const exportedAttrs = error ? {
        ...this.standardAttrs,
        [ATTR_ERROR_TYPE]: error instanceof Error ? error.name : "export_failed"
      } : this.standardAttrs;
      this.exported.add(numItems, exportedAttrs);
      const durationAttrs = {
        ...exportedAttrs,
        ...this.responseAttributesFromError(error)
      };
      const duration = hrTimeToMilliseconds(hrTimeDuration(startTime, endTime)) / 1e3;
      this.duration.record(duration, durationAttrs);
    };
  }
};

// node_modules/@opentelemetry/otlp-transformer/build/esm/trace/index.js
var TraceExporterMetricsHelper = {
  name: "span",
  countItems: (request) => request.length
};

// node_modules/@opentelemetry/resources/build/esm/ResourceImpl.js
init_esm();

// node_modules/@opentelemetry/resources/build/esm/utils.js
var isPromiseLike = (val) => {
  return val !== null && typeof val === "object" && typeof val.then === "function";
};

// node_modules/@opentelemetry/resources/build/esm/ResourceImpl.js
var ResourceImpl = class _ResourceImpl {
  _rawAttributes;
  _asyncAttributesPending = false;
  _schemaUrl;
  _memoizedAttributes;
  static FromAttributeList(attributes, options) {
    const res = new _ResourceImpl({}, options);
    res._rawAttributes = guardedRawAttributes(attributes);
    res._asyncAttributesPending = attributes.filter(([_, val]) => isPromiseLike(val)).length > 0;
    return res;
  }
  constructor(resource, options) {
    const attributes = resource.attributes ?? {};
    this._rawAttributes = Object.entries(attributes).map(([k, v]) => {
      if (isPromiseLike(v)) {
        this._asyncAttributesPending = true;
      }
      return [k, v];
    });
    this._rawAttributes = guardedRawAttributes(this._rawAttributes);
    this._schemaUrl = validateSchemaUrl(options?.schemaUrl);
  }
  get asyncAttributesPending() {
    return this._asyncAttributesPending;
  }
  async waitForAsyncAttributes() {
    if (!this.asyncAttributesPending) {
      return;
    }
    for (let i = 0; i < this._rawAttributes.length; i++) {
      const [k, v] = this._rawAttributes[i];
      this._rawAttributes[i] = [k, isPromiseLike(v) ? await v : v];
    }
    this._asyncAttributesPending = false;
  }
  get attributes() {
    if (this.asyncAttributesPending) {
      diag2.error("Accessing resource attributes before async attributes settled");
    }
    if (this._memoizedAttributes) {
      return this._memoizedAttributes;
    }
    const attrs = {};
    for (const [k, v] of this._rawAttributes) {
      if (isPromiseLike(v)) {
        diag2.debug(`Unsettled resource attribute ${k} skipped`);
        continue;
      }
      if (v != null) {
        attrs[k] ??= v;
      }
    }
    if (!this._asyncAttributesPending) {
      this._memoizedAttributes = attrs;
    }
    return attrs;
  }
  getRawAttributes() {
    return this._rawAttributes;
  }
  get schemaUrl() {
    return this._schemaUrl;
  }
  merge(resource) {
    if (resource == null)
      return this;
    const mergedSchemaUrl = mergeSchemaUrl(this, resource);
    const mergedOptions = mergedSchemaUrl ? { schemaUrl: mergedSchemaUrl } : void 0;
    return _ResourceImpl.FromAttributeList([...resource.getRawAttributes(), ...this.getRawAttributes()], mergedOptions);
  }
};
function resourceFromAttributes(attributes, options) {
  return ResourceImpl.FromAttributeList(Object.entries(attributes), options);
}
function guardedRawAttributes(attributes) {
  return attributes.map(([k, v]) => {
    if (isPromiseLike(v)) {
      return [
        k,
        v.catch((err) => {
          diag2.debug("promise rejection for resource attribute: %s - %s", k, err);
          return void 0;
        })
      ];
    }
    return [k, v];
  });
}
function validateSchemaUrl(schemaUrl) {
  if (typeof schemaUrl === "string" || schemaUrl === void 0) {
    return schemaUrl;
  }
  diag2.warn("Schema URL must be string or undefined, got %s. Schema URL will be ignored.", schemaUrl);
  return void 0;
}
function mergeSchemaUrl(old, updating) {
  const oldSchemaUrl = old?.schemaUrl;
  const updatingSchemaUrl = updating?.schemaUrl;
  const isOldEmpty = oldSchemaUrl === void 0 || oldSchemaUrl === "";
  const isUpdatingEmpty = updatingSchemaUrl === void 0 || updatingSchemaUrl === "";
  if (isOldEmpty) {
    return updatingSchemaUrl;
  }
  if (isUpdatingEmpty) {
    return oldSchemaUrl;
  }
  if (oldSchemaUrl === updatingSchemaUrl) {
    return oldSchemaUrl;
  }
  diag2.warn('Schema URL merge conflict: old resource has "%s", updating resource has "%s". Resulting resource will have undefined Schema URL.', oldSchemaUrl, updatingSchemaUrl);
  return void 0;
}

// node_modules/@opentelemetry/otlp-transformer/build/esm/common/internal.js
function createResource(resource, encoder) {
  const result = {
    attributes: toAttributes(resource.attributes, encoder),
    droppedAttributesCount: 0
  };
  const schemaUrl = resource.schemaUrl;
  if (schemaUrl && schemaUrl !== "")
    result.schemaUrl = schemaUrl;
  return result;
}
function createInstrumentationScope(scope, encoder) {
  const result = {
    name: scope.name,
    version: scope.version
  };
  if (scope.attributes && Object.keys(scope.attributes).length > 0) {
    result.attributes = toAttributes(scope.attributes, encoder);
    result.droppedAttributesCount = scope.droppedAttributesCount ?? 0;
  }
  return result;
}
function toAttributes(attributes, encoder) {
  return Object.keys(attributes).map((key) => toKeyValue(key, attributes[key], encoder));
}
function toKeyValue(key, value, encoder) {
  return {
    key,
    value: toAnyValue(value, encoder)
  };
}
function toAnyValue(value, encoder) {
  const t = typeof value;
  if (t === "string")
    return { stringValue: value };
  if (t === "number") {
    if (!Number.isInteger(value))
      return { doubleValue: value };
    return { intValue: value };
  }
  if (t === "boolean")
    return { boolValue: value };
  if (value instanceof Uint8Array)
    return { bytesValue: encoder.encodeUint8Array(value) };
  if (Array.isArray(value)) {
    const values = new Array(value.length);
    for (let i = 0; i < value.length; i++) {
      values[i] = toAnyValue(value[i], encoder);
    }
    return { arrayValue: { values } };
  }
  if (t === "object" && value != null) {
    const keys = Object.keys(value);
    const values = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      values[i] = {
        key: keys[i],
        value: toAnyValue(value[keys[i]], encoder)
      };
    }
    return { kvlistValue: { values } };
  }
  return {};
}

// node_modules/@opentelemetry/otlp-transformer/build/esm/common/utils.js
function hrTimeToNanos(hrTime3) {
  const NANOSECONDS = BigInt(1e9);
  return BigInt(Math.trunc(hrTime3[0])) * NANOSECONDS + BigInt(Math.trunc(hrTime3[1]));
}
function encodeAsString(hrTime3) {
  const nanos = hrTimeToNanos(hrTime3);
  return nanos.toString();
}
var encodeTimestamp = typeof BigInt !== "undefined" ? encodeAsString : hrTimeToNanoseconds;
function identity(value) {
  return value;
}
var JSON_ENCODER = {
  encodeHrTime: encodeTimestamp,
  encodeSpanContext: identity,
  encodeOptionalSpanContext: identity,
  encodeUint8Array: (bytes) => {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(bytes).toString("base64");
    }
    const chars = new Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      chars[i] = String.fromCharCode(bytes[i]);
    }
    return btoa(chars.join(""));
  }
};

// node_modules/@opentelemetry/otlp-transformer/build/esm/trace/internal.js
var SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE_MASK = 256;
var SPAN_FLAGS_CONTEXT_IS_REMOTE_MASK = 512;
function buildSpanFlagsFrom(traceFlags, isRemote) {
  let flags = traceFlags & 255 | SPAN_FLAGS_CONTEXT_HAS_IS_REMOTE_MASK;
  if (isRemote) {
    flags |= SPAN_FLAGS_CONTEXT_IS_REMOTE_MASK;
  }
  return flags;
}
function sdkSpanToOtlpSpan(span, encoder) {
  const ctx = span.spanContext();
  const status = span.status;
  const parentSpanId = span.parentSpanContext?.spanId ? encoder.encodeSpanContext(span.parentSpanContext?.spanId) : void 0;
  return {
    traceId: encoder.encodeSpanContext(ctx.traceId),
    spanId: encoder.encodeSpanContext(ctx.spanId),
    parentSpanId,
    traceState: ctx.traceState?.serialize(),
    name: span.name,
    // Span kind is offset by 1 because the API does not define a value for unset
    kind: span.kind == null ? 0 : span.kind + 1,
    startTimeUnixNano: encoder.encodeHrTime(span.startTime),
    endTimeUnixNano: encoder.encodeHrTime(span.endTime),
    attributes: toAttributes(span.attributes, encoder),
    droppedAttributesCount: span.droppedAttributesCount,
    events: span.events.map((event) => toOtlpSpanEvent(event, encoder)),
    droppedEventsCount: span.droppedEventsCount,
    status: {
      // API and proto enums share the same values
      code: status.code,
      message: status.message
    },
    links: span.links.map((link) => toOtlpLink(link, encoder)),
    droppedLinksCount: span.droppedLinksCount,
    flags: buildSpanFlagsFrom(ctx.traceFlags, span.parentSpanContext?.isRemote)
  };
}
function toOtlpLink(link, encoder) {
  return {
    attributes: link.attributes ? toAttributes(link.attributes, encoder) : [],
    spanId: encoder.encodeSpanContext(link.context.spanId),
    traceId: encoder.encodeSpanContext(link.context.traceId),
    traceState: link.context.traceState?.serialize(),
    droppedAttributesCount: link.droppedAttributesCount || 0,
    flags: buildSpanFlagsFrom(link.context.traceFlags, link.context.isRemote)
  };
}
function toOtlpSpanEvent(timedEvent, encoder) {
  return {
    attributes: timedEvent.attributes ? toAttributes(timedEvent.attributes, encoder) : [],
    name: timedEvent.name,
    timeUnixNano: encoder.encodeHrTime(timedEvent.time),
    droppedAttributesCount: timedEvent.droppedAttributesCount || 0
  };
}
function createExportTraceServiceRequest(spans, encoder) {
  return {
    resourceSpans: spanRecordsToResourceSpans(spans, encoder)
  };
}
function createResourceMap(readableSpans) {
  const resourceMap = /* @__PURE__ */ new Map();
  for (const record of readableSpans) {
    let ilsMap = resourceMap.get(record.resource);
    if (!ilsMap) {
      ilsMap = /* @__PURE__ */ new Map();
      resourceMap.set(record.resource, ilsMap);
    }
    const instrumentationScopeKey = `${record.instrumentationScope.name}@${record.instrumentationScope.version || ""}:${record.instrumentationScope.schemaUrl || ""}`;
    let records = ilsMap.get(instrumentationScopeKey);
    if (!records) {
      records = [];
      ilsMap.set(instrumentationScopeKey, records);
    }
    records.push(record);
  }
  return resourceMap;
}
function spanRecordsToResourceSpans(readableSpans, encoder) {
  const resourceMap = createResourceMap(readableSpans);
  const out = [];
  const entryIterator = resourceMap.entries();
  let entry = entryIterator.next();
  while (!entry.done) {
    const [resource, ilmMap] = entry.value;
    const scopeResourceSpans = [];
    const ilmIterator = ilmMap.values();
    let ilmEntry = ilmIterator.next();
    while (!ilmEntry.done) {
      const scopeSpans = ilmEntry.value;
      if (scopeSpans.length > 0) {
        const spans = scopeSpans.map((readableSpan) => sdkSpanToOtlpSpan(readableSpan, encoder));
        scopeResourceSpans.push({
          scope: createInstrumentationScope(scopeSpans[0].instrumentationScope, encoder),
          spans,
          schemaUrl: scopeSpans[0].instrumentationScope.schemaUrl
        });
      }
      ilmEntry = ilmIterator.next();
    }
    const processedResource = createResource(resource, encoder);
    const transformedSpans = {
      resource: processedResource,
      scopeSpans: scopeResourceSpans,
      schemaUrl: processedResource.schemaUrl
    };
    out.push(transformedSpans);
    entry = entryIterator.next();
  }
  return out;
}

// node_modules/@opentelemetry/otlp-transformer/build/esm/trace/json/trace.js
init_esm();
var JsonTraceSerializer = {
  serializeRequest: (arg) => {
    const request = createExportTraceServiceRequest(arg, JSON_ENCODER);
    const encoder = new TextEncoder();
    return encoder.encode(JSON.stringify(request));
  },
  deserializeResponse: (arg) => {
    if (arg.length === 0) {
      return {};
    }
    const decoder = new TextDecoder();
    try {
      return JSON.parse(decoder.decode(arg));
    } catch (err) {
      diag2.warn(`Failed to parse trace export response: ${err.message}. Returning empty response`);
      return {};
    }
  }
};

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/util.js
init_esm();
function validateAndNormalizeHeaders(partialHeaders) {
  const headers = {};
  Object.entries(partialHeaders ?? {}).forEach(([key, value]) => {
    if (typeof value !== "undefined") {
      headers[key] = String(value);
    } else {
      diag2.warn(`Header "${key}" has invalid value (${value}) and will be ignored`);
    }
  });
  return headers;
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/configuration/otlp-http-configuration.js
function mergeHeaders(userProvidedHeaders, fallbackHeaders, defaultHeaders) {
  return async () => {
    const requiredHeaders = {
      ...await defaultHeaders()
    };
    const headers = {};
    if (fallbackHeaders != null) {
      Object.assign(headers, await fallbackHeaders());
    }
    if (userProvidedHeaders != null) {
      Object.assign(headers, validateAndNormalizeHeaders(await userProvidedHeaders()));
    }
    return Object.assign(headers, requiredHeaders);
  };
}
function validateUserProvidedUrl(url) {
  if (url == null) {
    return void 0;
  }
  try {
    const base = globalThis.location?.href;
    return new URL(url, base).href;
  } catch {
    throw new Error(`Configuration: Could not parse user-provided export URL: '${url}'`);
  }
}
function mergeOtlpHttpConfigurationWithDefaults(userProvidedConfiguration, fallbackConfiguration, defaultConfiguration) {
  return {
    ...mergeOtlpSharedConfigurationWithDefaults(userProvidedConfiguration, fallbackConfiguration, defaultConfiguration),
    headers: mergeHeaders(userProvidedConfiguration.headers, fallbackConfiguration.headers, defaultConfiguration.headers),
    url: validateUserProvidedUrl(userProvidedConfiguration.url) ?? fallbackConfiguration.url ?? defaultConfiguration.url
  };
}
function getHttpConfigurationDefaults(requiredHeaders, signalResourcePath) {
  return {
    ...getSharedConfigurationDefaults(),
    headers: async () => requiredHeaders,
    url: "http://localhost:4318/" + signalResourcePath
  };
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/configuration/otlp-node-http-configuration.js
function httpAgentFactoryFromOptions(options) {
  return async (protocol) => {
    const isInsecure = protocol === "http:";
    const module2 = isInsecure ? import("http") : import("https");
    const { Agent } = await module2;
    if (isInsecure) {
      const { ca, cert, key, ...insecureOptions } = options;
      return new Agent(insecureOptions);
    }
    return new Agent(options);
  };
}
function mergeOtlpNodeHttpConfigurationWithDefaults(userProvidedConfiguration, fallbackConfiguration, defaultConfiguration) {
  return {
    ...mergeOtlpHttpConfigurationWithDefaults(userProvidedConfiguration, fallbackConfiguration, defaultConfiguration),
    agentFactory: userProvidedConfiguration.agentFactory ?? fallbackConfiguration.agentFactory ?? defaultConfiguration.agentFactory,
    userAgent: userProvidedConfiguration.userAgent
  };
}
function getNodeHttpConfigurationDefaults(requiredHeaders, signalResourcePath) {
  return {
    ...getHttpConfigurationDefaults(requiredHeaders, signalResourcePath),
    agentFactory: httpAgentFactoryFromOptions({ keepAlive: true })
  };
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/transport/http-transport-utils.js
var zlib = __toESM(require("zlib"));
var import_stream = require("stream");

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/is-export-retryable.js
function isExportHTTPErrorRetryable(statusCode) {
  return statusCode === 429 || statusCode === 502 || statusCode === 503 || statusCode === 504;
}
function parseRetryAfterToMills(retryAfter) {
  if (retryAfter == null) {
    return void 0;
  }
  const seconds = Number.parseInt(retryAfter, 10);
  if (Number.isInteger(seconds)) {
    return seconds > 0 ? seconds * 1e3 : -1;
  }
  const delay = new Date(retryAfter).getTime() - Date.now();
  if (delay >= 0) {
    return delay;
  }
  return 0;
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/transport/http-transport-utils.js
var DEFAULT_USER_AGENT = `OTel-OTLP-Exporter-JavaScript/${VERSION2}`;
var MAX_RESPONSE_BODY_SIZE = 4 * 1024 * 1024;
function sendWithHttp(request, url, headers, compression, userAgent, agent, data, timeoutMillis) {
  return new Promise((resolve3) => {
    const parsedUrl = new URL(url);
    if (userAgent) {
      headers["User-Agent"] = `${userAgent} ${DEFAULT_USER_AGENT}`;
    } else {
      headers["User-Agent"] = DEFAULT_USER_AGENT;
    }
    const options = {
      method: "POST",
      headers,
      agent
    };
    const req = request(parsedUrl, options, (res) => {
      const responseData = [];
      let responseSize = 0;
      res.on("data", (chunk) => {
        responseSize += chunk.length;
        if (responseSize > MAX_RESPONSE_BODY_SIZE) {
          const sizeError = new Error(`OTLP export response body exceeded size limit of ${MAX_RESPONSE_BODY_SIZE} bytes`);
          resolve3({ status: "failure", error: sizeError });
          res.destroy();
          return;
        }
        responseData.push(chunk);
      });
      res.on("end", () => {
        if (res.statusCode && res.statusCode <= 299) {
          resolve3({
            status: "success",
            data: Buffer.concat(responseData)
          });
        } else if (res.statusCode && isExportHTTPErrorRetryable(res.statusCode)) {
          resolve3({
            status: "retryable",
            retryInMillis: parseRetryAfterToMills(res.headers["retry-after"])
          });
        } else {
          const error = new OTLPExporterError(res.statusMessage, res.statusCode, Buffer.concat(responseData).toString());
          resolve3({
            status: "failure",
            error
          });
        }
      });
      res.on("error", (error) => {
        if (res.statusCode && res.statusCode <= 299) {
          resolve3({
            status: "success"
          });
        } else if (res.statusCode && isExportHTTPErrorRetryable(res.statusCode)) {
          resolve3({
            status: "retryable",
            error,
            retryInMillis: parseRetryAfterToMills(res.headers["retry-after"])
          });
        } else {
          resolve3({
            status: "failure",
            error
          });
        }
      });
    });
    req.setTimeout(timeoutMillis, () => {
      req.destroy();
      resolve3({
        status: "retryable",
        error: new Error("Request timed out")
      });
    });
    req.on("error", (error) => {
      if (isHttpTransportNetworkErrorRetryable(error)) {
        resolve3({
          status: "retryable",
          error
        });
      } else {
        resolve3({
          status: "failure",
          error
        });
      }
    });
    compressAndSend(req, compression, data, (error) => {
      resolve3({
        status: "failure",
        error
      });
    });
  });
}
function compressAndSend(req, compression, data, onError) {
  let dataStream = readableFromUint8Array(data);
  if (compression === "gzip") {
    req.setHeader("Content-Encoding", "gzip");
    dataStream = dataStream.on("error", onError).pipe(zlib.createGzip()).on("error", onError);
  }
  dataStream.pipe(req).on("error", onError);
}
function readableFromUint8Array(buff) {
  const readable = new import_stream.Readable();
  readable.push(buff);
  readable.push(null);
  return readable;
}
function isHttpTransportNetworkErrorRetryable(error) {
  const RETRYABLE_NETWORK_ERROR_CODES = /* @__PURE__ */ new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
    "ENETUNREACH",
    "EHOSTUNREACH"
  ]);
  if ("code" in error && typeof error.code === "string") {
    return RETRYABLE_NETWORK_ERROR_CODES.has(error.code);
  }
  return false;
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/transport/http-exporter-transport.js
var HttpExporterTransport = class {
  _utils = null;
  _parameters;
  constructor(parameters) {
    this._parameters = parameters;
  }
  async send(data, timeoutMillis) {
    const { agent, request } = await this._loadUtils();
    const headers = await this._parameters.headers();
    return sendWithHttp(request, this._parameters.url, headers, this._parameters.compression, this._parameters.userAgent, agent, data, timeoutMillis);
  }
  shutdown() {
  }
  async _loadUtils() {
    let utils = this._utils;
    if (utils === null) {
      const protocol = new URL(this._parameters.url).protocol;
      const [agent, request] = await Promise.all([
        this._parameters.agentFactory(protocol),
        requestFunctionFactory(protocol)
      ]);
      utils = this._utils = { agent, request };
    }
    return utils;
  }
};
async function requestFunctionFactory(protocol) {
  const module2 = protocol === "http:" ? import("http") : import("https");
  const { request } = await module2;
  return request;
}
function createHttpExporterTransport(parameters) {
  return new HttpExporterTransport(parameters);
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/retrying-transport.js
init_esm();
var MAX_ATTEMPTS = 5;
var INITIAL_BACKOFF = 1e3;
var MAX_BACKOFF = 5e3;
var BACKOFF_MULTIPLIER = 1.5;
var JITTER = 0.2;
function getJitter() {
  return Math.random() * (2 * JITTER) - JITTER;
}
var RetryingTransport = class {
  _transport;
  constructor(transport) {
    this._transport = transport;
  }
  retry(data, timeoutMillis, inMillis) {
    return new Promise((resolve3, reject) => {
      setTimeout(() => {
        this._transport.send(data, timeoutMillis).then(resolve3, reject);
      }, inMillis);
    });
  }
  async send(data, timeoutMillis) {
    let attempts = MAX_ATTEMPTS;
    let nextBackoff = INITIAL_BACKOFF;
    const deadline = Date.now() + timeoutMillis;
    let result = await this._transport.send(data, timeoutMillis);
    while (result.status === "retryable" && attempts > 0) {
      attempts--;
      const backoff = Math.max(Math.min(nextBackoff * (1 + getJitter()), MAX_BACKOFF), 0);
      nextBackoff = nextBackoff * BACKOFF_MULTIPLIER;
      const retryInMillis = result.retryInMillis ?? backoff;
      const remainingTimeoutMillis = deadline - Date.now();
      if (retryInMillis > remainingTimeoutMillis) {
        diag2.info(`Export retry time ${Math.round(retryInMillis)}ms exceeds remaining timeout ${Math.round(remainingTimeoutMillis)}ms, not retrying further.`);
        return result;
      }
      diag2.verbose(`Scheduling export retry in ${Math.round(retryInMillis)}ms`);
      result = await this.retry(data, remainingTimeoutMillis, retryInMillis);
    }
    if (result.status === "success") {
      diag2.verbose(`Export succeeded after ${MAX_ATTEMPTS - attempts} retry attempts.`);
    } else if (result.status === "retryable") {
      diag2.info(`Export failed after maximum retry attempts (${MAX_ATTEMPTS}).`);
    } else {
      diag2.info(`Export failed with non-retryable error: ${result.error}`);
    }
    return result;
  }
  shutdown() {
    return this._transport.shutdown();
  }
};
function createRetryingTransport(options) {
  return new RetryingTransport(options.transport);
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/otlp-http-export-delegate.js
function createOtlpHttpExporterMetrics(metricsComponentType, exporterMetricsHelper, url, meterProvider) {
  return new ExporterMetrics({
    componentType: metricsComponentType,
    metricsHelper: exporterMetricsHelper,
    url,
    meterProvider,
    responseAttributesFromError: (error) => {
      if (!error) {
        return {
          [ATTR_HTTP_RESPONSE_STATUS_CODE]: 200
        };
      }
      if (!(error instanceof OTLPExporterError)) {
        return {};
      }
      return {
        [ATTR_HTTP_RESPONSE_STATUS_CODE]: error.code
      };
    }
  });
}
function createOtlpHttpExportDelegate(options, serializer, metricsComponentType, exporterMetricsHelper, meterProvider) {
  return createOtlpExportDelegate({
    transport: createRetryingTransport({
      transport: createHttpExporterTransport(options)
    }),
    serializer,
    promiseHandler: createBoundedQueueExportPromiseHandler(options),
    metrics: createOtlpHttpExporterMetrics(metricsComponentType, exporterMetricsHelper, options.url, meterProvider)
  }, { timeout: options.timeoutMillis });
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/configuration/shared-env-configuration.js
init_esm();
function parseAndValidateTimeoutFromEnv(timeoutEnvVar) {
  const envTimeout = getNumberFromEnv(timeoutEnvVar);
  if (envTimeout != null) {
    if (Number.isFinite(envTimeout) && envTimeout > 0) {
      return envTimeout;
    }
    diag2.warn(`Configuration: ${timeoutEnvVar} is invalid, expected number greater than 0 (actual: ${envTimeout})`);
  }
  return void 0;
}
function getTimeoutFromEnv(signalIdentifier) {
  const specificTimeout = parseAndValidateTimeoutFromEnv(`OTEL_EXPORTER_OTLP_${signalIdentifier}_TIMEOUT`);
  const nonSpecificTimeout = parseAndValidateTimeoutFromEnv("OTEL_EXPORTER_OTLP_TIMEOUT");
  return specificTimeout ?? nonSpecificTimeout;
}
function parseAndValidateCompressionFromEnv(compressionEnvVar) {
  const compression = getStringFromEnv(compressionEnvVar)?.trim();
  if (compression == null || compression === "none" || compression === "gzip") {
    return compression;
  }
  diag2.warn(`Configuration: ${compressionEnvVar} is invalid, expected 'none' or 'gzip' (actual: '${compression}')`);
  return void 0;
}
function getCompressionFromEnv(signalIdentifier) {
  const specificCompression = parseAndValidateCompressionFromEnv(`OTEL_EXPORTER_OTLP_${signalIdentifier}_COMPRESSION`);
  const nonSpecificCompression = parseAndValidateCompressionFromEnv("OTEL_EXPORTER_OTLP_COMPRESSION");
  return specificCompression ?? nonSpecificCompression;
}
function getSharedConfigurationFromEnvironment(signalIdentifier) {
  return {
    timeoutMillis: getTimeoutFromEnv(signalIdentifier),
    compression: getCompressionFromEnv(signalIdentifier)
  };
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/configuration/convert-legacy-node-http-options.js
init_esm();

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/configuration/otlp-node-http-env-configuration.js
var fs2 = __toESM(require("fs"));
var path2 = __toESM(require("path"));
init_esm();
function getStaticHeadersFromEnv(signalIdentifier) {
  const signalSpecificRawHeaders = getStringFromEnv(`OTEL_EXPORTER_OTLP_${signalIdentifier}_HEADERS`);
  const nonSignalSpecificRawHeaders = getStringFromEnv("OTEL_EXPORTER_OTLP_HEADERS");
  const signalSpecificHeaders = parseKeyPairsIntoRecord(signalSpecificRawHeaders);
  const nonSignalSpecificHeaders = parseKeyPairsIntoRecord(nonSignalSpecificRawHeaders);
  if (Object.keys(signalSpecificHeaders).length === 0 && Object.keys(nonSignalSpecificHeaders).length === 0) {
    return void 0;
  }
  return Object.assign({}, parseKeyPairsIntoRecord(nonSignalSpecificRawHeaders), parseKeyPairsIntoRecord(signalSpecificRawHeaders));
}
function appendRootPathToUrlIfNeeded(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.toString();
  } catch {
    diag2.warn(`Configuration: Could not parse environment-provided export URL: '${url}', falling back to undefined`);
    return void 0;
  }
}
function appendResourcePathToUrl(url, path8) {
  try {
    new URL(url);
  } catch {
    diag2.warn(`Configuration: Could not parse environment-provided export URL: '${url}', falling back to undefined`);
    return void 0;
  }
  if (!url.endsWith("/")) {
    url = url + "/";
  }
  url += path8;
  try {
    new URL(url);
  } catch {
    diag2.warn(`Configuration: Provided URL appended with '${path8}' is not a valid URL, using 'undefined' instead of '${url}'`);
    return void 0;
  }
  return url;
}
function getNonSpecificUrlFromEnv(signalResourcePath) {
  const envUrl = getStringFromEnv("OTEL_EXPORTER_OTLP_ENDPOINT");
  if (envUrl === void 0) {
    return void 0;
  }
  return appendResourcePathToUrl(envUrl, signalResourcePath);
}
function getSpecificUrlFromEnv(signalIdentifier) {
  const envUrl = getStringFromEnv(`OTEL_EXPORTER_OTLP_${signalIdentifier}_ENDPOINT`);
  if (envUrl === void 0) {
    return void 0;
  }
  return appendRootPathToUrlIfNeeded(envUrl);
}
function readFileFromEnv(signalSpecificEnvVar, nonSignalSpecificEnvVar, warningMessage) {
  const signalSpecificPath = getStringFromEnv(signalSpecificEnvVar);
  const nonSignalSpecificPath = getStringFromEnv(nonSignalSpecificEnvVar);
  const filePath = signalSpecificPath ?? nonSignalSpecificPath;
  if (filePath != null) {
    try {
      return fs2.readFileSync(path2.resolve(process.cwd(), filePath));
    } catch {
      diag2.warn(warningMessage);
      return void 0;
    }
  } else {
    return void 0;
  }
}
function getClientCertificateFromEnv(signalIdentifier) {
  return readFileFromEnv(`OTEL_EXPORTER_OTLP_${signalIdentifier}_CLIENT_CERTIFICATE`, "OTEL_EXPORTER_OTLP_CLIENT_CERTIFICATE", "Failed to read client certificate chain file");
}
function getClientKeyFromEnv(signalIdentifier) {
  return readFileFromEnv(`OTEL_EXPORTER_OTLP_${signalIdentifier}_CLIENT_KEY`, "OTEL_EXPORTER_OTLP_CLIENT_KEY", "Failed to read client certificate private key file");
}
function getRootCertificateFromEnv(signalIdentifier) {
  return readFileFromEnv(`OTEL_EXPORTER_OTLP_${signalIdentifier}_CERTIFICATE`, "OTEL_EXPORTER_OTLP_CERTIFICATE", "Failed to read root certificate file");
}
function getNodeHttpConfigurationFromEnvironment(signalIdentifier, signalResourcePath) {
  return {
    ...getSharedConfigurationFromEnvironment(signalIdentifier),
    url: getSpecificUrlFromEnv(signalIdentifier) ?? getNonSpecificUrlFromEnv(signalResourcePath),
    headers: wrapStaticHeadersInFunction(getStaticHeadersFromEnv(signalIdentifier)),
    agentFactory: httpAgentFactoryFromOptions({
      keepAlive: true,
      ca: getRootCertificateFromEnv(signalIdentifier),
      cert: getClientCertificateFromEnv(signalIdentifier),
      key: getClientKeyFromEnv(signalIdentifier)
    })
  };
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/configuration/convert-legacy-http-options.js
function convertLegacyHeaders(config) {
  if (typeof config.headers === "function") {
    return config.headers;
  }
  return wrapStaticHeadersInFunction(config.headers);
}

// node_modules/@opentelemetry/otlp-exporter-base/build/esm/configuration/convert-legacy-node-http-options.js
function convertLegacyAgentOptions(config) {
  if (typeof config.httpAgentOptions === "function") {
    return config.httpAgentOptions;
  }
  let legacy = config.httpAgentOptions;
  if (config.keepAlive != null) {
    legacy = { keepAlive: config.keepAlive, ...legacy };
  }
  if (legacy != null) {
    return httpAgentFactoryFromOptions(legacy);
  } else {
    return void 0;
  }
}
function convertLegacyHttpOptions(config, signalIdentifier, signalResourcePath, requiredHeaders) {
  if (config.metadata) {
    diag2.warn("Metadata cannot be set when using http");
  }
  return mergeOtlpNodeHttpConfigurationWithDefaults({
    url: config.url,
    headers: convertLegacyHeaders(config),
    concurrencyLimit: config.concurrencyLimit,
    timeoutMillis: config.timeoutMillis,
    compression: config.compression,
    agentFactory: convertLegacyAgentOptions(config),
    userAgent: config.userAgent
  }, getNodeHttpConfigurationFromEnvironment(signalIdentifier, signalResourcePath), getNodeHttpConfigurationDefaults(requiredHeaders, signalResourcePath));
}

// node_modules/@opentelemetry/exporter-trace-otlp-http/build/esm/semconv.js
var OTEL_COMPONENT_TYPE_VALUE_OTLP_HTTP_SPAN_EXPORTER = "otlp_http_span_exporter";

// node_modules/@opentelemetry/exporter-trace-otlp-http/build/esm/platform/node/OTLPTraceExporter.js
var OTLPTraceExporter = class extends OTLPExporterBase {
  constructor(config = {}) {
    super(createOtlpHttpExportDelegate(convertLegacyHttpOptions(config, "TRACES", "v1/traces", {
      "Content-Type": "application/json"
    }), JsonTraceSerializer, OTEL_COMPONENT_TYPE_VALUE_OTLP_HTTP_SPAN_EXPORTER, TraceExporterMetricsHelper, config.selfObsMeterProvider));
  }
};

// src/otlp.ts
var hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
function normalizeId(value, len) {
  if (typeof value !== "string") {
    return null;
  }
  let id = value.trim().replace(/-/g, "").toLowerCase();
  if (len === 16 && id.length === 32) {
    id = id.slice(16);
  }
  return new RegExp(`^[0-9a-f]{${len}}$`).test(id) && !/^0+$/.test(id) ? id : null;
}
function parentFromEnv() {
  const raw = process.env.LMNR_SPAN_CONTEXT?.trim();
  if (!raw) {
    return null;
  }
  try {
    const ctx = JSON.parse(raw);
    const traceId = normalizeId(ctx?.traceId ?? ctx?.trace_id, 32);
    const spanId = normalizeId(ctx?.spanId ?? ctx?.span_id, 16);
    if (traceId && spanId) {
      return { traceId, spanId };
    }
  } catch {
  }
  debug("Ignoring invalid LMNR_SPAN_CONTEXT");
  return null;
}
function setAttributes(span, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== void 0) {
      span.attributes[key] = value;
    }
  }
}
function endSpan(span, endMs) {
  span.endMs = Math.max(span.startMs, endMs ?? span.startMs);
}
var Tracer = class {
  spans = [];
  remoteParent = parentFromEnv();
  /** Start a span under `parent`, or as a turn root (under LMNR_SPAN_CONTEXT if set). */
  start(name, startMs, attrs, parent) {
    const p = parent ?? this.remoteParent;
    const start = startMs ?? Date.now();
    const span = { traceId: p?.traceId ?? hex(16), spanId: hex(8), name, startMs: start, endMs: start, attributes: {} };
    if (p) {
      span.parentSpanId = p.spanId;
    }
    setAttributes(span, attrs);
    this.spans.push(span);
    return span;
  }
};
var SAMPLED = { traceFlags: TraceFlags.SAMPLED };
var RESOURCE = resourceFromAttributes({
  "service.name": "claude-code",
  "telemetry.sdk.language": "nodejs",
  "telemetry.sdk.name": "lmnr-claude-code-plugin"
});
var SCOPE = { name: "lmnr.claude_code" };
var hrTime2 = (ms) => {
  const whole = Math.round(ms);
  return [Math.floor(whole / 1e3), whole % 1e3 * 1e6];
};
function toReadableSpan(s) {
  return {
    name: s.name,
    kind: SpanKind.INTERNAL,
    spanContext: () => ({ traceId: s.traceId, spanId: s.spanId, ...SAMPLED }),
    parentSpanContext: s.parentSpanId ? { traceId: s.traceId, spanId: s.parentSpanId, ...SAMPLED } : void 0,
    startTime: hrTime2(s.startMs),
    endTime: hrTime2(s.endMs),
    duration: hrTime2(s.endMs - s.startMs),
    ended: true,
    status: { code: SpanStatusCode.OK },
    attributes: s.attributes,
    links: [],
    events: [],
    resource: RESOURCE,
    instrumentationScope: SCOPE,
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0
  };
}
var MAX_BATCH_BYTES = 4 * 1024 * 1024;
var spanBytes = (span) => Buffer.byteLength(JSON.stringify(span.attributes)) + 512;
function dropOtlpEnv() {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("OTEL_EXPORTER_OTLP_")) {
      delete process.env[key];
    }
  }
}
async function exportSpans(config, spans) {
  if (spans.length === 0) {
    return true;
  }
  try {
    dropOtlpEnv();
    const exporter = new OTLPTraceExporter({
      url: `${config.baseUrl}/v1/traces`,
      headers: { Authorization: `Bearer ${config.apiKey}` },
      timeoutMillis: EXPORT_TIMEOUT_MS
      // bounds retries too
    });
    const result = await new Promise((resolve3) => exporter.export(spans.map(toReadableSpan), resolve3));
    await exporter.shutdown().catch(() => {
    });
    if (result.code === ExportResultCode.SUCCESS) {
      debug(`OTLP export: ${spans.length} span(s)`);
      return true;
    }
    info(`OTLP export failed: ${String(result.error ?? "unknown error").slice(0, 500)}`);
    return false;
  } catch (e) {
    info(`OTLP export failed: ${e}`);
    return false;
  }
}

// src/render.ts
var path5 = __toESM(require("node:path"), 1);

// src/transcript.ts
var fs3 = __toESM(require("node:fs"), 1);
var path3 = __toESM(require("node:path"), 1);
function contentOf(row) {
  return typeof row.message === "object" && row.message !== null ? row.message.content : row.content;
}
function roleOf(row) {
  if (row.type === "user" || row.type === "assistant") {
    return row.type;
  }
  const role = row.message?.role;
  return role === "user" || role === "assistant" ? role : null;
}
function textOf(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content.map((b) => typeof b === "string" ? b : b?.type === "text" ? b.text || "" : "").filter(Boolean).join("\n");
}
function blocksOf(content, type) {
  return Array.isArray(content) ? content.filter((b) => b?.type === type) : [];
}
function tsOf(value) {
  const raw = typeof value === "object" && value !== null ? value.timestamp : value;
  if (typeof raw !== "string" || !raw) {
    return null;
  }
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}
function truncate(s, maxChars = MAX_CHARS) {
  return s ? s.slice(0, maxChars) : "";
}
function isToolResult(row) {
  return roleOf(row) === "user" && blocksOf(contentOf(row), "tool_result").length > 0;
}
function isPrompt(row) {
  return roleOf(row) === "user" && !row.isMeta && !isToolResult(row) && !isTaskNotification(row);
}
function notificationText(row) {
  if (row.type === "attachment") {
    const a = row.attachment;
    const isNotification = a?.type === "queued_command" && (a.commandMode === "task-notification" || a.origin?.kind === "task-notification");
    return isNotification && typeof a.prompt === "string" ? a.prompt : null;
  }
  if (roleOf(row) !== "user") {
    return null;
  }
  const text = textOf(contentOf(row));
  return row.origin?.kind === "task-notification" || text.trimStart().startsWith("<task-notification>") ? text : null;
}
function xmlTag(text, tag) {
  const open = text.indexOf(`<${tag}>`);
  if (open < 0) {
    return null;
  }
  const close = text.indexOf(`</${tag}>`, open);
  return close < 0 ? null : text.slice(open + tag.length + 2, close);
}
var isTaskNotification = (row) => notificationText(row) !== null;
function notificationToolUseId(row, taskIds) {
  const text = notificationText(row);
  if (text === null) {
    return null;
  }
  const toolUseId = xmlTag(text, "tool-use-id")?.trim();
  if (toolUseId) {
    return toolUseId;
  }
  const taskId = xmlTag(text, "task-id")?.trim();
  return taskId && taskIds[taskId] || null;
}
function notificationResult(row) {
  const text = notificationText(row) ?? "";
  return xmlTag(text, "result") ?? text;
}
function readLines(file, from = 0) {
  let buf;
  try {
    const fd = fs3.openSync(file, "r");
    try {
      const size = fs3.fstatSync(fd).size;
      buf = Buffer.alloc(Math.max(0, size - from));
      if (buf.length > 0) {
        fs3.readSync(fd, buf, 0, buf.length, from);
      }
    } finally {
      fs3.closeSync(fd);
    }
  } catch (e) {
    info(`transcript read failed (${file}): ${e}`);
    return { lines: [], end: from };
  }
  const lines = [];
  let end = from;
  let start = 0;
  while (start < buf.length) {
    const nl = buf.indexOf(10, start);
    const stop = nl < 0 ? buf.length : nl;
    const text = buf.toString("utf-8", start, stop).trim();
    let row = null;
    if (text) {
      try {
        row = JSON.parse(text);
      } catch {
        if (nl < 0) {
          break;
        }
      }
    }
    if (typeof row === "object" && row !== null && !Array.isArray(row)) {
      lines.push({ row, offset: from + start });
    }
    start = nl < 0 ? buf.length : nl + 1;
    end = from + start;
  }
  return { lines, end };
}
function findSubagents(transcriptPath) {
  const dir = path3.join(path3.dirname(transcriptPath), path3.basename(transcriptPath, path3.extname(transcriptPath)), "subagents");
  let names;
  try {
    names = fs3.readdirSync(dir);
  } catch {
    return {};
  }
  const out = {};
  for (const name of names) {
    if (!name.endsWith(".meta.json")) {
      continue;
    }
    const stem = name.slice(0, -".meta.json".length);
    const jsonl = path3.join(dir, `${stem}.jsonl`);
    let meta;
    try {
      meta = JSON.parse(fs3.readFileSync(path3.join(dir, name), "utf-8"));
    } catch {
      continue;
    }
    if (typeof meta?.toolUseId !== "string" || !meta.toolUseId || !fs3.existsSync(jsonl)) {
      continue;
    }
    out[meta.toolUseId] = {
      path: jsonl,
      agentId: stem.replace(/^agent-/, ""),
      agentType: meta.agentType,
      description: meta.description
    };
  }
  return out;
}
function taskIdMap(subagents) {
  return Object.fromEntries(Object.entries(subagents).map(([toolUseId, s]) => [s.agentId, toolUseId]));
}

// src/genai.ts
var USAGE_KEYS = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
var MAX_INPUT_BYTES = 2 * 1024 * 1024;
function boundedHistoryJson(history) {
  const json = JSON.stringify(history);
  if (Buffer.byteLength(json) <= MAX_INPUT_BYTES || history.length < 2) {
    return json;
  }
  const sizes = history.map((m) => Buffer.byteLength(JSON.stringify(m)) + 1);
  let budget = MAX_INPUT_BYTES - sizes[0] - 100;
  let keepFrom = history.length;
  while (keepFrom > 1 && sizes[keepFrom - 1] <= budget) {
    budget -= sizes[--keepFrom];
  }
  const note = { role: "user", content: [{ type: "text", text: `[${keepFrom - 1} earlier messages omitted]` }] };
  return JSON.stringify([history[0], note, ...history.slice(keepFrom)]);
}
function truncateStrings(value) {
  if (typeof value === "string") {
    return truncate(value);
  }
  if (Array.isArray(value)) {
    return value.map(truncateStrings);
  }
  if (typeof value === "object" && value !== null) {
    const out = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = truncateStrings(inner);
    }
    return out;
  }
  return value;
}
function toAnthropicBlock(block) {
  if (typeof block === "string") {
    return block ? { type: "text", text: truncate(block) } : null;
  }
  if (typeof block !== "object" || block === null || Array.isArray(block)) {
    return null;
  }
  switch (block.type) {
    case "text":
      return block.text ? { type: "text", text: truncate(String(block.text)) } : null;
    case "thinking":
      return block.thinking ? { type: "thinking", thinking: truncate(String(block.thinking)) } : null;
    case "redacted_thinking":
      return { type: "redacted_thinking", data: "" };
    case "tool_use":
      return { type: "tool_use", id: String(block.id ?? ""), name: String(block.name ?? ""), input: truncateStrings(block.input ?? {}) };
    case "tool_result":
      return toolResultBlock(String(block.tool_use_id ?? ""), block.content, block.is_error === true);
    case "image":
      return { type: "text", text: "[image]" };
    case "document":
      return { type: "text", text: "[document]" };
    default:
      return truncateStrings(block);
  }
}
function toAnthropicContent(content) {
  const blocks = Array.isArray(content) ? content : [content];
  return blocks.map(toAnthropicBlock).filter((b) => b !== null);
}
function toolResultBlock(toolUseId, content, isError) {
  const block = {
    type: "tool_result",
    tool_use_id: toolUseId,
    content: typeof content === "string" ? truncate(content) : toAnthropicContent(content ?? "")
  };
  if (isError) {
    block.is_error = true;
  }
  return block;
}
function buildUserMessage(userRow) {
  return { role: "user", content: toAnthropicContent(contentOf(userRow)) };
}
function buildGenerationAttributes(history, assistantMessage, toolDefinitions = null) {
  const content = contentOf(assistantMessage);
  const toolUses = blocksOf(content, "tool_use");
  const outputMessage = { role: "assistant", content: toAnthropicContent(content) };
  const model = assistantMessage.message?.model || "claude";
  const attrs = {
    "gen_ai.system": "anthropic",
    "gen_ai.request.model": model,
    "gen_ai.response.model": model,
    "gen_ai.input.messages": boundedHistoryJson(history)
  };
  if (toolDefinitions !== null && toolDefinitions.length > 0) {
    attrs["gen_ai.tool.definitions"] = JSON.stringify(toolDefinitions);
  }
  const stopReason = assistantMessage.message?.stop_reason;
  attrs["gen_ai.output.messages"] = JSON.stringify([
    typeof stopReason === "string" ? { ...outputMessage, stop_reason: stopReason } : outputMessage
  ]);
  const usage = assistantMessage.message?.usage ?? {};
  let total = 0;
  for (const key of USAGE_KEYS) {
    const value = usage[key];
    if (Number.isInteger(value) && value > 0) {
      attrs[`gen_ai.usage.${key}`] = value;
      total += value;
    }
  }
  if (total > 0) {
    attrs["llm.usage.total_tokens"] = total;
  }
  return [attrs, toolUses, outputMessage];
}

// src/tools.ts
var crypto2 = __toESM(require("node:crypto"), 1);
var fs4 = __toESM(require("node:fs"), 1);
var path4 = __toESM(require("node:path"), 1);
var MAX_TOOL_SET_CHANGES = 100;
var TOOL_SET_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;
function toolSetDir() {
  return path4.join(stateDir(), "lmnr_tool_sets");
}
function toToolDefinition(entry) {
  if (typeof entry !== "object" || entry === null || Array.isArray(entry) || typeof entry.name !== "string") {
    return null;
  }
  const tool = { name: entry.name };
  if (typeof entry.description === "string") {
    tool.description = entry.description;
  }
  const schema = entry.input_schema ?? entry.schema;
  if (typeof schema === "object" && schema !== null) {
    tool.input_schema = schema;
  }
  return tool;
}
function toToolDefinitions(entries) {
  return Array.isArray(entries) ? entries.map(toToolDefinition).filter((t) => t !== null) : [];
}
var ToolTimeline = class _ToolTimeline {
  changes;
  persist;
  sets = /* @__PURE__ */ new Map();
  current = { inline: [], deferred: [] };
  /** `persist` stores new sets for later runs; a subagent's timeline is rebuilt each run. */
  constructor(changes = [], persist = true) {
    this.changes = changes.slice(-MAX_TOOL_SET_CHANGES);
    this.persist = persist;
    const last = this.changes[this.changes.length - 1];
    if (last) {
      this.current = this.load(last.hash) ?? this.current;
    }
  }
  /** Build an in-memory timeline from a whole transcript (a subagent's). */
  static fromRows(rows) {
    const timeline = new _ToolTimeline([], false);
    for (const row of rows) {
      timeline.observe(row);
    }
    return timeline;
  }
  /** Record the tool set a transcript row announces, if it announces one. */
  observe(row) {
    const attachment = row.type === "attachment" ? row.attachment : null;
    if (typeof attachment !== "object" || attachment === null || typeof row.timestamp !== "string") {
      return;
    }
    if (attachment.type === "prompt_snapshot" && Array.isArray(attachment.tools)) {
      this.record(row.timestamp, { ...this.current, inline: toToolDefinitions(attachment.tools) });
    } else if (attachment.type === "deferred_tools_record" && Array.isArray(attachment.entries)) {
      const deferred = new Map(this.current.deferred.map((t) => [t.name, t]));
      for (const tool of toToolDefinitions(attachment.entries)) {
        deferred.set(tool.name, tool);
      }
      const sorted = [...deferred.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
      this.record(row.timestamp, { ...this.current, deferred: sorted });
    }
  }
  /**
   * Tools in effect at `timestamp`. Before the first recorded set, that set: the
   * first request records none but was sent the same tools.
   */
  toolsAt(timestamp) {
    if (this.changes.length === 0) {
      return null;
    }
    let change = this.changes[0];
    if (typeof timestamp === "string") {
      for (const c of this.changes) {
        if (c.timestamp <= timestamp) {
          change = c;
        }
      }
    }
    const set = this.load(change.hash);
    if (set === null) {
      return null;
    }
    const tools = [...set.inline, ...set.deferred];
    return tools.length > 0 ? tools : null;
  }
  record(timestamp, set) {
    this.current = set;
    const hash = crypto2.createHash("sha256").update(JSON.stringify(set), "utf-8").digest("hex");
    this.sets.set(hash, set);
    if (this.changes[this.changes.length - 1]?.hash === hash) {
      return;
    }
    this.changes.push({ timestamp, hash });
    this.changes = this.changes.slice(-MAX_TOOL_SET_CHANGES);
    if (this.persist) {
      saveToolSet(hash, set);
    }
  }
  load(hash) {
    const cached = this.sets.get(hash);
    if (cached) {
      return cached;
    }
    if (!this.persist) {
      return null;
    }
    try {
      const raw = JSON.parse(fs4.readFileSync(path4.join(toolSetDir(), `${hash}.json`), "utf-8"));
      const set = { inline: toToolDefinitions(raw.inline), deferred: toToolDefinitions(raw.deferred) };
      this.sets.set(hash, set);
      return set;
    } catch (e) {
      debug(`tool set ${hash.slice(0, 12)} unavailable: ${e}`);
      return null;
    }
  }
};
function saveToolSet(hash, set) {
  try {
    const dir = toolSetDir();
    fs4.mkdirSync(dir, { recursive: true });
    const file = path4.join(dir, `${hash}.json`);
    if (fs4.existsSync(file)) {
      const now = /* @__PURE__ */ new Date();
      fs4.utimesSync(file, now, now);
      return;
    }
    fs4.writeFileSync(file, JSON.stringify(set), "utf-8");
    const cutoff = Date.now() - TOOL_SET_MAX_AGE_MS;
    for (const name of fs4.readdirSync(dir)) {
      const other = path4.join(dir, name);
      if (fs4.statSync(other).mtimeMs < cutoff) {
        fs4.rmSync(other, { force: true });
      }
    }
  } catch (e) {
    debug(`saveToolSet failed: ${e}`);
  }
}
function coerceToolSetChanges(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (c) => typeof c === "object" && c !== null && typeof c.timestamp === "string" && typeof c.hash === "string"
  );
}

// src/turns.ts
function splitTurns(lines) {
  const turns = [];
  for (const line of lines) {
    if (isPrompt(line.row)) {
      turns.push({ start: line.offset, lines: [line] });
    } else if (turns.length > 0) {
      turns[turns.length - 1].lines.push(line);
    }
  }
  return turns;
}
var toolUsesOf = (row) => roleOf(row) === "assistant" ? blocksOf(contentOf(row), "tool_use") : [];
function routeNotifications(turns, taskIds) {
  const owner = /* @__PURE__ */ new Map();
  for (const turn of turns) {
    for (const { row } of turn.lines) {
      for (const toolUse of toolUsesOf(row)) {
        owner.set(String(toolUse.id), turn);
      }
    }
  }
  for (const turn of turns) {
    turn.lines = turn.lines.filter((line) => {
      const id = notificationToolUseId(line.row, taskIds);
      const target = id ? owner.get(id) : void 0;
      if (!target || target === turn) {
        return true;
      }
      target.lines.push(line);
      target.lines.sort((a, b) => a.offset - b.offset);
      return false;
    });
  }
}
function isAsyncLaunch(row, block) {
  const marker = row.toolUseResult;
  if (typeof marker === "object" && marker !== null) {
    return marker.status === "async_launched" || marker.isAsync === true;
  }
  const text = typeof block.content === "string" ? block.content : JSON.stringify(block.content);
  return text.includes("Async agent launched successfully") || text.includes("agentId:") && text.includes("output_file:") && text.includes("You will be notified automatically");
}
function pendingAgents(turn, taskIds) {
  const agentIds = /* @__PURE__ */ new Set();
  const launched = /* @__PURE__ */ new Set();
  const notified = /* @__PURE__ */ new Set();
  for (const { row } of turn.lines) {
    for (const toolUse of toolUsesOf(row)) {
      if (toolUse.name === "Agent" || toolUse.name === "Task") {
        agentIds.add(String(toolUse.id));
      }
    }
    if (isToolResult(row)) {
      for (const block of blocksOf(contentOf(row), "tool_result")) {
        if (agentIds.has(String(block.tool_use_id)) && isAsyncLaunch(row, block)) {
          launched.add(String(block.tool_use_id));
        }
      }
    }
    const notifiedId = notificationToolUseId(row, taskIds);
    if (notifiedId) {
      notified.add(notifiedId);
    }
  }
  return [...launched].filter((id) => !notified.has(id));
}
function isIncomplete(turn, finalAssistantText) {
  let replies = [];
  for (const { row } of turn.lines) {
    if (isToolResult(row)) {
      replies = [];
    } else if (roleOf(row) === "assistant") {
      replies.push(row);
    }
  }
  if (replies.length === 0) {
    return true;
  }
  const want = finalAssistantText.trim();
  return want !== "" && !replies.some((row) => {
    const text = textOf(contentOf(row)).trim();
    return text !== "" && want.endsWith(text);
  });
}

// src/render.ts
var ASSOC = "lmnr.association.properties";
function maxTs(...values) {
  let max = null;
  for (const v of values) {
    if (typeof v === "number" && (max === null || v > max)) {
      max = v;
    }
  }
  return max;
}
var nonEmpty2 = (v) => typeof v === "string" && v ? v : void 0;
var hasReply = (turn) => turn.lines.some((l) => roleOf(l.row) === "assistant");
function mergeAssistantRows(rows) {
  const last = rows[rows.length - 1] ?? {};
  const content = [];
  for (const row of rows) {
    const c = row.message?.content;
    if (Array.isArray(c)) {
      content.push(...c);
    } else if (typeof c === "string" && c) {
      content.push({ type: "text", text: c });
    }
  }
  return { ...last, message: { ...last.message ?? {}, content } };
}
function readConversation(rows, taskIds) {
  const c = { entries: [], results: /* @__PURE__ */ new Map(), notifiedAt: /* @__PURE__ */ new Map(), toolUseTs: /* @__PURE__ */ new Map(), skillContent: /* @__PURE__ */ new Map() };
  const assistants = /* @__PURE__ */ new Map();
  const toolOrder = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (roleOf(row) === "assistant") {
      for (const b of blocksOf(contentOf(row), "tool_use")) {
        toolOrder.set(String(b.id), toolOrder.size);
      }
    }
  }
  const lastReport = /* @__PURE__ */ new Map();
  rows.forEach((row, i) => {
    const id = notificationToolUseId(row, taskIds);
    if (id && toolOrder.has(id)) {
      lastReport.set(id, i);
    }
  });
  const input = (ts) => {
    let entry = c.entries[c.entries.length - 1];
    if (entry?.kind !== "input") {
      entry = { kind: "input", results: [], reports: [], messages: [], ts: null };
      c.entries.push(entry);
    }
    entry.ts = maxTs(entry.ts, ts);
    return entry;
  };
  rows.forEach((row, i) => {
    const ts = tsOf(row);
    if (i === 0) {
      input(ts).messages.push(buildUserMessage(row));
    } else if (row.isMeta) {
      const text = textOf(contentOf(row));
      if (text && row.sourceToolUseID) {
        c.skillContent.set(String(row.sourceToolUseID), text);
      } else if (text) {
        input(ts).messages.push(buildUserMessage(row));
      }
    } else if (isToolResult(row)) {
      for (const b of blocksOf(contentOf(row), "tool_result")) {
        if (b.tool_use_id) {
          c.results.set(String(b.tool_use_id), { content: b.content, ts });
          input(ts).results.push(toolResultBlock(String(b.tool_use_id), b.content, b.is_error === true));
        }
      }
    } else if (isTaskNotification(row)) {
      const id = notificationToolUseId(row, taskIds);
      if (id && lastReport.get(id) === i) {
        c.notifiedAt.set(id, ts);
        input(ts).reports.push(toolResultBlock(id, notificationResult(row), false));
      }
    } else if (roleOf(row) === "assistant") {
      const id = row.message?.id || `noid:${i}`;
      let group = assistants.get(id);
      if (!group) {
        assistants.set(id, group = []);
        c.entries.push({ kind: "assistant", rows: group });
      }
      group.push(row);
      for (const toolUse of blocksOf(contentOf(row), "tool_use")) {
        if (!c.toolUseTs.has(String(toolUse.id))) {
          c.toolUseTs.set(String(toolUse.id), ts);
        }
      }
    }
  });
  for (const entry of c.entries) {
    if (entry.kind === "input") {
      entry.results.sort((x, y) => (toolOrder.get(x.tool_use_id) ?? 0) - (toolOrder.get(y.tool_use_id) ?? 0));
    }
  }
  return c;
}
function renderConversation(ctx, parent, rows, prefix, startTs) {
  const c = readConversation(rows, ctx.taskIds);
  const history = [];
  let inputTs = startTs;
  let end = startTs;
  let last = null;
  let n = 0;
  for (const entry of c.entries) {
    if (entry.kind === "input") {
      const results = [...entry.results, ...entry.reports];
      if (results.length > 0) {
        history.push({ role: "user", content: results });
      }
      history.push(...entry.messages);
      if (n > 0) {
        inputTs = maxTs(inputTs, entry.ts);
      }
      continue;
    }
    const message = mergeAssistantRows(entry.rows);
    const ts = tsOf(message);
    const [attrs, toolUses, output] = buildGenerationAttributes(history, message, ctx.tools?.toolsAt(message.timestamp) ?? null);
    history.push(output);
    const generation = ctx.tracer.start(`${prefix} ${++n}`, inputTs ?? ts, { "lmnr.span.type": "LLM", ...attrs }, parent);
    endSpan(generation, ts ?? generation.startMs);
    end = maxTs(end, generation.endMs);
    for (const toolUse of toolUses) {
      end = maxTs(end, renderTool(ctx, parent, c, toolUse, ts));
    }
    inputTs = ts ?? inputTs;
    last = message;
  }
  return { end, last };
}
function toolInput(toolUse) {
  const raw = toolUse.input;
  if (typeof raw === "string") {
    return truncate(raw);
  }
  return raw !== null && ["object", "number", "boolean"].includes(typeof raw) ? raw : {};
}
function toolOutputText(raw) {
  return truncate(typeof raw === "string" ? raw : JSON.stringify(Array.isArray(raw) ? toAnthropicContent(raw) : raw));
}
function renderTool(ctx, parent, c, toolUse, assistantTs) {
  const id = String(toolUse.id || "");
  const name = toolUse.name || "unknown";
  const start = c.toolUseTs.get(id) ?? assistantTs;
  const result = c.results.get(id);
  const subagent = ctx.subagents[id];
  const span = ctx.tracer.start(
    name,
    start,
    {
      "lmnr.span.type": "TOOL",
      "lmnr.span.input": JSON.stringify(toolInput(toolUse)),
      "claude_code.tool.name": name,
      "claude_code.tool.id": id,
      "claude_code.subagent.type": nonEmpty2(subagent?.agentType),
      "claude_code.subagent.description": nonEmpty2(subagent?.description)
    },
    parent
  );
  let output = result ? toolOutputText(result.content) : null;
  const skill = c.skillContent.get(id);
  if (CAPTURE_SKILL_CONTENT && skill) {
    output = { result: output, injected_instructions: truncate(skill) };
  }
  if (output !== null) {
    setAttributes(span, { "lmnr.span.output": JSON.stringify(output) });
  }
  const subagentEnd = subagent ? renderSubagent(ctx, span, subagent, start) : null;
  endSpan(span, maxTs(result?.ts, c.notifiedAt.get(id), subagentEnd, start));
  return span.endMs;
}
function subagentReport(message) {
  const content = message ? contentOf(message) : "";
  const text = textOf(content);
  if (text) {
    return text;
  }
  const handback = blocksOf(content, "tool_use").find((b) => b.name === "SubagentHandback" && typeof b.input?.message === "string");
  return handback?.input.message ?? "";
}
function renderSubagent(ctx, parent, subagent, startTs) {
  const { lines } = readLines(subagent.path);
  const first = lines.findIndex((l) => roleOf(l.row) === "user");
  const lead = [];
  if (first >= 0 && !isPrompt(lines[first].row)) {
    const next = lines.findIndex((l, i) => i > first && isPrompt(l.row));
    lead.push({ start: lines[first].offset, lines: lines.slice(first, next < 0 ? void 0 : next) });
  }
  const turns = [...lead, ...splitTurns(lines)].filter(hasReply);
  if (turns.length === 0) {
    return startTs;
  }
  const sub = {
    tracer: ctx.tracer,
    subagents: Object.fromEntries(Object.entries(ctx.subagents).filter(([, s]) => s.path !== subagent.path)),
    taskIds: {},
    tools: ToolTimeline.fromRows(lines.map((l) => l.row))
  };
  const prompt = turns[0].lines[0].row;
  const start = startTs ?? tsOf(prompt);
  const span = ctx.tracer.start(
    subagent.description ? `Subagent: ${subagent.description}` : "Subagent",
    start,
    {
      "lmnr.span.type": "DEFAULT",
      "lmnr.span.input": JSON.stringify({ role: "user", content: truncate(textOf(contentOf(prompt))) }),
      "claude_code.subagent.type": nonEmpty2(subagent.agentType)
    },
    parent
  );
  let end = start;
  let last = null;
  for (const turn of turns) {
    const r = renderConversation(sub, span, turn.lines.map((l) => l.row), "Subagent LLM Call", end);
    end = maxTs(end, r.end);
    last = r.last ?? last;
  }
  setAttributes(span, { "lmnr.span.output": JSON.stringify({ role: "assistant", content: truncate(subagentReport(last)) }) });
  endSpan(span, end);
  return end;
}
function shortSessionLabel(sessionId, maxLen = 12) {
  const sid = sessionId.trim();
  if (!sid) {
    return "unknown";
  }
  const parts = sid.split("-");
  if (parts.length === 5 && parts[0].length === 8) {
    return parts[0];
  }
  return sid.length <= maxLen ? sid : sid.slice(0, maxLen).replace(/-+$/, "");
}
function rootAttributes(config, sessionId, turnNum, rows, transcriptPath) {
  const prompt = rows[0];
  const skills = /* @__PURE__ */ new Set();
  for (const row of rows) {
    if (roleOf(row) === "assistant") {
      for (const b of blocksOf(contentOf(row), "tool_use")) {
        if (b.name === "Skill" && nonEmpty2(b.input?.skill)) {
          skills.add(b.input.skill);
        }
      }
    }
  }
  return {
    "lmnr.span.type": "DEFAULT",
    "lmnr.span.input": JSON.stringify({ role: "user", content: truncate(textOf(contentOf(prompt))) }),
    [`${ASSOC}.session_id`]: sessionId,
    [`${ASSOC}.user_id`]: config.userId,
    [`${ASSOC}.metadata.source`]: "claude-code",
    [`${ASSOC}.metadata.turn_number`]: String(turnNum),
    [`${ASSOC}.metadata.transcript`]: path5.basename(transcriptPath),
    [`${ASSOC}.metadata.os`]: process.platform,
    [`${ASSOC}.metadata.skills`]: skills.size > 0 ? [...skills].join(",") : null,
    [`${ASSOC}.metadata.cwd`]: nonEmpty2(prompt.cwd),
    [`${ASSOC}.metadata.git_branch`]: nonEmpty2(prompt.gitBranch),
    [`${ASSOC}.metadata.claude_code_version`]: nonEmpty2(prompt.version)
  };
}
function renderTurn(ctx, config, sessionId, turnNum, turn, transcriptPath) {
  const rows = turn.lines.map((l) => l.row);
  const promptTs = tsOf(rows[0]);
  const root = ctx.tracer.start(
    `Claude Code - Turn ${turnNum} (${shortSessionLabel(sessionId)})`,
    promptTs,
    rootAttributes(config, sessionId, turnNum, rows, transcriptPath)
  );
  const { end, last } = renderConversation(ctx, root, rows, "LLM Call", promptTs);
  setAttributes(root, { "lmnr.span.output": JSON.stringify({ role: "assistant", content: truncate(textOf(last ? contentOf(last) : "")) }) });
  endSpan(root, maxTs(end, promptTs));
}

// src/state.ts
var crypto3 = __toESM(require("node:crypto"), 1);
var fs5 = __toESM(require("node:fs"), 1);
var path6 = __toESM(require("node:path"), 1);
var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1e3;
var LOCK_WAIT_MS = 1e4;
var LOCK_STALE_MS = 3e4;
var sessionsDir = () => path6.join(stateDir(), "lmnr_sessions");
function sessionKey(sessionId, transcriptPath) {
  return crypto3.createHash("sha256").update(`${sessionId}::${transcriptPath}`, "utf-8").digest("hex");
}
function emptyState() {
  return { offset: 0, exported: [], turnCount: 0, toolsScannedTo: 0, toolSetChanges: [] };
}
var num = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
function fromJson(raw) {
  return {
    offset: num(raw.offset),
    exported: Array.isArray(raw.exported) ? raw.exported.filter((x) => typeof x === "number") : [],
    turnCount: num(raw.turnCount),
    toolsScannedTo: num(raw.toolsScannedTo),
    toolSetChanges: coerceToolSetChanges(raw.toolSetChanges)
  };
}
function loadState(key, transcriptPath) {
  const file = path6.join(sessionsDir(), `${key}.json`);
  if (fs5.existsSync(file)) {
    return fromJson(readJsonObject(file));
  }
  pruneOldSessions();
  return migrateLegacyState(key, transcriptPath) ?? emptyState();
}
function saveState(key, state) {
  try {
    fs5.mkdirSync(sessionsDir(), { recursive: true });
    const file = path6.join(sessionsDir(), `${key}.json`);
    fs5.writeFileSync(`${file}.tmp`, JSON.stringify(state), "utf-8");
    fs5.renameSync(`${file}.tmp`, file);
  } catch (e) {
    info(`saveState failed: ${e}; already-exported turns may be re-emitted on the next hook run`);
  }
}
function pruneOldSessions() {
  try {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const name of fs5.readdirSync(sessionsDir())) {
      const file = path6.join(sessionsDir(), name);
      if (fs5.statSync(file).mtimeMs < cutoff) {
        fs5.rmSync(file, { force: true });
      }
    }
  } catch {
  }
}
async function withSessionLock(key, fn) {
  const lock = path6.join(sessionsDir(), `${key}.lock`);
  try {
    fs5.mkdirSync(sessionsDir(), { recursive: true });
  } catch {
    return fn();
  }
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (; ; ) {
    try {
      fs5.closeSync(fs5.openSync(lock, "wx"));
      break;
    } catch (e) {
      if (e?.code !== "EEXIST") {
        return fn();
      }
    }
    try {
      if (Date.now() - fs5.statSync(lock).mtimeMs > LOCK_STALE_MS) {
        fs5.rmSync(lock, { force: true });
        continue;
      }
    } catch {
      continue;
    }
    if (Date.now() > deadline) {
      throw new Error("session state lock timeout");
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  try {
    return await fn();
  } finally {
    fs5.rmSync(lock, { force: true });
  }
}
function migrateLegacyState(key, transcriptPath) {
  const legacy = readJsonObject(path6.join(stateDir(), "lmnr_state.json"))[key];
  if (typeof legacy !== "object" || legacy === null) {
    return null;
  }
  const readTo = num(legacy.offset) - Buffer.byteLength(typeof legacy.buffer === "string" ? legacy.buffer : "", "utf-8");
  const held = [
    ...Array.isArray(legacy.pendingAgentTurns) ? legacy.pendingAgentTurns.map((t) => t?.rows?.[0]) : [],
    Array.isArray(legacy.pendingTurnRows) ? legacy.pendingTurnRows[0] : void 0
  ];
  const heldUuids = new Set(held.map((r) => r?.uuid).filter((u) => typeof u === "string"));
  const state = {
    ...emptyState(),
    offset: Math.max(0, readTo),
    turnCount: num(legacy.turnCount),
    toolsScannedTo: Math.max(0, readTo),
    toolSetChanges: coerceToolSetChanges(legacy.toolSetChanges)
  };
  if (heldUuids.size > 0) {
    const prompts = readLines(transcriptPath).lines.filter((l) => l.offset < readTo && isPrompt(l.row));
    const firstHeld = prompts.find((l) => heldUuids.has(l.row.uuid));
    if (firstHeld) {
      state.offset = firstHeld.offset;
      state.exported = prompts.filter((l) => l.offset > firstHeld.offset && !heldUuids.has(l.row.uuid)).map((l) => l.offset);
    }
  }
  info(`migrated legacy state for session ${key.slice(0, 12)}: resuming at byte ${state.offset}`);
  return state;
}

// src/pipeline.ts
var MAX_REREAD_BYTES = 2e7;
async function exportInBatches(config, turnSpans, exportFn) {
  let batch = [];
  let bytes = 0;
  let sent = 0;
  let queued = 0;
  const flush = async () => {
    const ok = batch.length === 0 || await exportFn(config, batch);
    batch = [];
    bytes = 0;
    return ok;
  };
  for (const spans of turnSpans) {
    for (const span of spans) {
      const size = spanBytes(span);
      if (batch.length > 0 && bytes + size > MAX_BATCH_BYTES) {
        if (!await flush()) {
          return sent;
        }
        sent += queued;
        queued = 0;
      }
      batch.push(span);
      bytes += size;
    }
    queued += 1;
  }
  return await flush() ? sent + queued : sent;
}
function fileSize(file) {
  try {
    return fs6.statSync(file).size;
  } catch {
    return 0;
  }
}
async function processTranscript(config, sessionId, transcriptPath, opts = {}) {
  const { sessionEnd = false, finalAssistantText = "", exportFn = exportSpans, renderFn = renderTurn } = opts;
  const key = sessionKey(sessionId, transcriptPath);
  return withSessionLock(key, async () => {
    let state = loadState(key, transcriptPath);
    if (fileSize(transcriptPath) < state.offset) {
      debug(`transcript shrank below byte ${state.offset}; restarting from the beginning`);
      state = { ...emptyState(), turnCount: state.turnCount, toolSetChanges: state.toolSetChanges };
    }
    const { lines, end } = readLines(transcriptPath, state.offset);
    const tools = new ToolTimeline(state.toolSetChanges);
    for (const line of lines) {
      if (line.offset >= state.toolsScannedTo) {
        tools.observe(line.row);
      }
    }
    const subagents = findSubagents(transcriptPath);
    const taskIds = taskIdMap(subagents);
    const turns = splitTurns(lines);
    routeNotifications(turns, taskIds);
    const exported = new Set(state.exported);
    const handled = [];
    const ready = [];
    let waitingFrom = null;
    const waitForAgents = !sessionEnd && end - state.offset <= MAX_REREAD_BYTES;
    turns.forEach((turn, i) => {
      if (exported.has(turn.start)) {
        return;
      }
      const agents = waitForAgents ? pendingAgents(turn, taskIds) : [];
      const unfinished = !sessionEnd && i === turns.length - 1 && isIncomplete(turn, finalAssistantText);
      if (agents.length > 0 || unfinished) {
        debug(`turn at byte ${turn.start} waits for ${agents.length > 0 ? `agents ${agents}` : "its final row"}`);
        waitingFrom ??= turn.start;
        return;
      }
      handled.push(turn.start);
      if (hasReply(turn)) {
        ready.push(turn);
      }
    });
    const tracer = new Tracer();
    const ctx = { tracer, subagents, taskIds, tools };
    const rendered = [];
    for (const turn of ready) {
      const mark = tracer.spans.length;
      try {
        renderFn(ctx, config, sessionId, state.turnCount + rendered.length + 1, turn, transcriptPath);
        rendered.push({ turn, spans: tracer.spans.slice(mark) });
      } catch (e) {
        tracer.spans.length = mark;
        info(`renderTurn failed: ${e}`);
      }
    }
    const sent = await exportInBatches(config, rendered.map((r) => r.spans), exportFn);
    const failedAt = sent < rendered.length ? rendered[sent].turn.start : null;
    if (failedAt !== null) {
      info(`OTLP export failed; ${rendered.length - sent} turn(s) will be retried on the next hook run`);
    }
    for (const start of handled) {
      if (failedAt === null || start < failedAt) {
        exported.add(start);
      }
    }
    const offset = Math.min(waitingFrom ?? end, failedAt ?? end);
    saveState(key, {
      offset,
      exported: [...exported].filter((start) => start > offset).sort((a, b) => a - b),
      turnCount: state.turnCount + sent,
      toolsScannedTo: Math.max(state.toolsScannedTo, end),
      toolSetChanges: tools.changes
    });
    return sent;
  });
}

// src/hook.ts
function readPayload() {
  try {
    const payload = JSON.parse(fs7.readFileSync(0, "utf-8"));
    return typeof payload === "object" && payload !== null ? payload : {};
  } catch (e) {
    debug(`unreadable hook payload: ${e}`);
    return {};
  }
}
async function main() {
  const start = Date.now();
  const config = getLaminarConfig();
  if (config === null) {
    return;
  }
  const payload = readPayload();
  const sessionId = payload.session_id;
  const transcriptPath = payload.transcript_path;
  if (typeof sessionId !== "string" || !sessionId || typeof transcriptPath !== "string" || !fs7.existsSync(transcriptPath)) {
    debug(`missing session_id or transcript (${transcriptPath}); nothing to do`);
    return;
  }
  const count = await processTranscript(config, sessionId, path7.resolve(transcriptPath), {
    sessionEnd: payload.hook_event_name === "SessionEnd",
    finalAssistantText: typeof payload.last_assistant_message === "string" ? payload.last_assistant_message : ""
  });
  info(`Processed ${count} turns in ${((Date.now() - start) / 1e3).toFixed(2)}s (session=${sessionId})`);
}
main().catch((e) => debug(`Unexpected failure: ${e}`)).finally(() => process.exit(0));
