(function () {
    var _slice = Array.prototype.slice,
        _toString = Object.prototype.toString;

    function _isType(type) {
        return function (obj) {
            return _toString.call(obj) === '[object ' + type + ']';
        };
    }

    var _isArray = _isType('Array'),
        _isString = _isType('String'),
        _isFunction = _isType('Function'),
        _isError = _isType('Error'),
        _isPromise = _isType('Promise');

    function _nextTick(fn) {
        setTimeout(function () {
            fn();
        }, 0);
    }

    function Node() {
        this.status = Node.UNINIT; // 1: no subscribe 2: working 3: end 4: error
        this.subscribs = [];
    }

    Node.UNINIT = 1;
    Node.WORKING = 2;
    Node.END = 3;
    Node.ERROR = 4;

    Node.NOMORE = '||No More||';

    Node.stream = function(fn) {
        var node = new Node(),
            unbind;

        node.on('working', function () {
            unbind = fn(function (signal) {
                node.async(signal);
            });
        });

        node.on('end', function () {
            _nextTick(function () {
                unbind();
            });
        });

        return node;
    };

    Node.bind = function (node, event, filter) {
        return Node.stream(function (sink) {
            var fn;

            if (filter) {
                fn = function (event) {
                    sink(_isFunction(filter) ? filter(event) : filter);
                };
            } else {
                fn = sink;
            }

            node.addEventListener(event, fn, false);

            return function () {
                node.removeEventListener(event, fn);
            };
        });
    };

    var proto = Node.prototype;

    proto.end = function () {
        this.status = Node.END;
        this.fire('end');

        return this;
    };

    proto.send = function (value) {
        if (this.status !== Node.WORKING) {
            return;
        }

        this.lastValue = value;
        this.fire('send', value);

        return this;
    };

    proto.error = function (error) {
        this.status = Node.ERROR;

        this.lastError = error;
        this.fire('error', error);

        return this;
    };

    proto.async = function (signal) {
        var self = this;

        if (_isPromise(signal)) {
            signal.then(function (value) {
                if (value === Node.NOMORE) {
                    self.end();
                } else {
                    self.send(value);
                }
            }, function (error) {
                self.error(error);
            });
        } else {
            if (signal === Node.NOMORE) {
                this.end();
            } else if (_isError(signal)) {
                this.error(signal);
            } else {
                this.send(signal);
            }
        }
    }

    proto.on = function (event, fn, context) {
        if (event === 'error' && this.status === Node.ERROR) {
            fn.call(context || this, this.lastError);
        } else if (event === 'send' && this.status === Node.END) {
            fn.call(context || this, this.lastValue);
        }

        this.subscribs.push({
            type: event,
            handler: fn,
            context: context
        });

        if (event === 'send' && this.status === Node.UNINIT) {
            this.status = Node.WORKING;
            this.fire('working');
        }

        return this;
    };

    proto.fire = function (event) {
        var args = _slice.call(arguments, 1),

            type,
            handler,
            context,
            i = -1,
            len = this.subscribs.length;

        while (++i < len) {
            type = this.subscribs[i].type;
            handler = this.subscribs[i].handler;
            context = this.subscribs[i].context;

            if (type === event) {
                handler.apply(context || this, args);
            }
        }

        return this;
    };

    proto.map = function (fn) {
        var node = new Node();

        this.on('send', function (value) {
            node.async(fn(value));
        });

        return node;
    };

    proto.reduce = function (fn, memo) {
        var node = new Node(),
            init = false;

        this.on('send', function (value) {
            if (!init && memo === void 0) {
                memo = value;
            } else {
                memo = fn(memo, value);
            }

            init = true;
            node.async(memo);
        });

        return node;
    };

    proto.filter = function (fn) {
        var node = new Node();

        this.on('send', function (value) {
            if (!fn(value)) {
                return;
            }

            node.async(value);
        });

        return node;
    };

    proto.done = function (fn) {
        return this.on('send', fn);
    };

    proto.fail = function (fn) {
        return this.on('error', fn);
    };

    ['map', 'reduce', 'filter'].forEach(function (method) {
        var fn = proto[method];

        proto[method] = function () {
            var node = fn.apply(this, arguments);

            this.on('error', function (error) {
                node.error(error);
            });

            return node;
        };
    });

    window.vn = Node;
})();