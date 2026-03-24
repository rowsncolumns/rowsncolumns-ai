(function () {
  if (typeof window === "undefined") return;

  var noop = function () {};
  var METHODS = ["pushState", "replaceState", "back", "forward", "go"];
  var ensureOnObject = function (obj, name) {
    if (!obj) return;
    try {
      if (typeof obj[name] === "function") return;
    } catch {
      // continue to patch
    }
    try {
      Object.defineProperty(obj, name, {
        value: noop,
        configurable: true,
        writable: true,
      });
      return;
    } catch {
      try {
        obj[name] = noop;
      } catch {
        // no-op
      }
    }
  };

  var applyPatch = function () {
    var historyObj = window.history;
    if (!historyObj) {
      return;
    }

    for (var i = 0; i < METHODS.length; i += 1) {
      ensureOnObject(historyObj, METHODS[i]);
    }

    var proto = Object.getPrototypeOf(historyObj);
    while (proto && proto !== Object.prototype) {
      for (var j = 0; j < METHODS.length; j += 1) {
        ensureOnObject(proto, METHODS[j]);
      }
      proto = Object.getPrototypeOf(proto);
    }

    if (window.History && window.History.prototype) {
      for (var k = 0; k < METHODS.length; k += 1) {
        ensureOnObject(window.History.prototype, METHODS[k]);
      }
    }

    try {
      var rawHistory = historyObj;
      var proxy = new Proxy(rawHistory, {
        get: function (target, prop, receiver) {
          if (typeof prop === "string" && METHODS.indexOf(prop) >= 0) {
            var methodValue = Reflect.get(target, prop, receiver);
            if (typeof methodValue === "function") {
              return methodValue.bind(target);
            }
            return noop;
          }

          var value = Reflect.get(target, prop, receiver);
          if (typeof value === "function") {
            return value.bind(target);
          }
          return value;
        },
      });

      Object.defineProperty(window, "history", {
        configurable: true,
        enumerable: true,
        get: function () {
          return proxy;
        },
      });
    } catch {
      // Ignore if host blocks redefining window.history.
    }
  };

  var patchNextRouterInstance = function () {
    try {
      var nextGlobal = window.next;
      var router = nextGlobal && nextGlobal.router;
      if (!router || router.__excelHistoryPatched) {
        return;
      }

      var originalChangeState = router.changeState;
      if (typeof originalChangeState !== "function") {
        return;
      }

      router.changeState = function (method, url, as, options) {
        var historyObj = window.history;
        var historyMethod = historyObj && historyObj[method];
        if (typeof historyMethod !== "function") {
          return;
        }
        return originalChangeState.call(this, method, url, as, options);
      };

      router.__excelHistoryPatched = true;
    } catch {
      // Ignore router patch failures.
    }
  };

  applyPatch();
  patchNextRouterInstance();

  var intervalId = window.setInterval(function () {
    applyPatch();
    patchNextRouterInstance();
  }, 200);
  window.addEventListener(
    "beforeunload",
    function () {
      window.clearInterval(intervalId);
    },
    { once: true },
  );
})();
