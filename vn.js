(function () {
    var _slice = Array.prototype.slice,
        _concat = Array.prototype.concat,
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

    function _initArray(len, value) {
        var res = [];

        while (--len >= 0) {
            res[len] = value;
        }

        return res;
    }

    function Node() {
        this.status = Node.UNINIT; // 1: no subscribe 2: active 3: end
        this.subscribs = [];
    }

    Node.UNINIT = 1;
    Node.ACTIVE = 2;
    Node.END = 3;

    Node.NOMORE = '||No More||';
    Node.NOVALUE = '||No Value||';

    Node.stream = function(fn) {
        var node = new Node(),
            unbind;

        node.on('active', function () {
            unbind = fn(function (signal) {
                node.async(signal);
            });
        });

        node.on('end', function () {
            _nextTick(function () {
                unbind && unbind();
            });
        });

        return node;
    };

    Node.bind = function (node, event, map) {
        return Node.stream(function (sink) {
            var fn;

            if (map) {
                fn = function (event) {
                    sink(_isFunction(map) ? map(event) : map);
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
        if (this.status !== Node.ACTIVE) {
            return;
        }

        this.lastValue = value;
        this.fire('send', value);

        return this;
    };

    proto.error = function (error) {
        if (this.status !== Node.ACTIVE) {
            return;
        }

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
            if (_isError(signal)) {
                this.error(signal);
            } else {
                if (signal === Node.NOMORE) {
                    this.end();
                } else {
                    this.send(signal);
                }
            }
        }
    };

    proto.on = function (event, fn, context) {
        if (event === 'error' && this.status === Node.END) {
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
            this.status = Node.ACTIVE;
            this.fire('active');
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

    proto.delay = function (wait) {
        var node = new Node(),
            buffer = [];

        this.on('send', function (value) {
            buffer.push(value);

            setTimeout(function () {
                node.async(buffer.shift());
            }, wait);
        });

        return node;
    };

    proto.sample = function (bump) {
        var node = new Node(),
            curr = Node.NOVALUE;

        this.on('send', function (value) {
            curr = value;
        });

        bump.on('send', function () {
            if (curr !== Node.NOVALUE) {
                node.async(curr);
            }
        });

        return node;
    };

    proto.merge = function () {
        var node = new Node(),
            others = _slice.call(arguments, 0),
            inputs = _concat.call.concat(others, this),
            count = inputs.length;

        function onSend(value) {
            if (value === Node.NOMORE) {
                if (--count === 0) {
                    node.end();
                }
                return;
            }
                
            node.async(value);
        }

        function onError(error) {
            node.error(error);
        }

        inputs.forEach(function (input) {
            input.on('send', onSend);
            input.on('error', onError);
        });

        return node;
    };

    proto.zip = function () {
        var node = new Node(),
            others = _slice.call(arguments, 0),
            inputs = _concat.call.concat(others, this),
            count = inputs.length,
            buffers = _initArray(count, []);

        function onSend(value, index) {
            var values = [],
                i,
                len = buffers.length;

            if (value === Node.NOMORE) {
                if (--count === 0) {
                    node.end();
                }
                return;
            }

            buffers[index].push(value);

            i = -1;

            while (++i < len) {
                if (!buffers[i].length) {
                    return;
                }
            }

            i = -1;

            while (++i < len) {
                values[i] = buffers[i].shift();
            }

            node.async(Promise.all(values));
        }

        function onError(error) {
            node.error(error);
        }

        inputs.forEach(function (input, index) {
            input.on('send', function (value) {
                onSend(value, index)
            });

            input.on('error', onError);
        });

        return node;
    };

    proto.done = function (fn) {
        return this.on('send', fn);
    };

    proto.fail = function (fn) {
        return this.on('error', fn);
    };

    ['map', 'reduce', 'filter', 'delay', 'sample'].forEach(function (method) {
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