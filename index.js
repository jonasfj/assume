'use strict';

var BackTrace = require('backtrace')
  , Failure = require('./failure')
  , pathval = require('pathval')
  , deep = require('deep-eql');

var toString = Object.prototype.toString
  , hasOwn = Object.prototype.hasOwnProperty;

/**
 * Get class information for a given type.
 *
 * @param {Mixed} of Type to check.
 * @returns {String} The name of the type.
 * @api private
 */
function type(of) {
  return toString.call(of).slice(8, -1).toLowerCase();
}

/**
 * Determine the size of a collection.
 *
 * @param {Mixed} collection The object we want to know the size of.
 * @returns {Number} The size of the collection.
 * @api private
 */
function size(collection) {
  var x, i = 0;

  if ('object' === type(collection)) {
    for (x in collection) {
      if (hasOwn.call(collection, x)) i++;
    }

    return i;
  }

  return +collection.length || 0;
}

/**
 * Iterate over each item in an array.
 *
 * @param {Array} arr Array to iterate over.
 * @param {Function} fn Callback for each item.
 * @private
 */
function each(arr, fn) {
  for (var i = 0, length = arr.length; i < length; i++) {
    fn(arr[i], i, arr);
  }
}

/**
 * Assert values.
 *
 * Flags:
 *
 * - **falsely**: Assert for a false instead of true.
 * - **deeply**:  Ensure a deep match of the given object.
 * - **stacktrace**: Include stacktrace in the assertion.
 * - **diff**: Attempt to show the difference in object/values so we know why
 *   the assertion failed.
 *
 * @constructor
 * @param {Mixed} value Value we need to assert.
 * @param {Object} flags Assertion flags.
 * @api public
 */
function Assert(value, flags) {
  if (!(this instanceof Assert)) return new Assert(value, flags);
  flags = flags || {};

  this.stacktrace = 'stacktrace' in flags ? flags.stacktrace : Assert.config.includeStack;
  this.diff = 'diff' in flags ? flags.diff : Assert.config.showDiff;

  //
  // These flags are by the alias function so we can generate .not and .deep
  // properties which are basically new Assert instances with these flags set.
  //
  this.falsely = 'falsely' in flags ? flags.falsely : false;
  this.deeply = 'deeply' in flags ? flags.deeply : false;
  this.value = value;

  Assert.assign(this)('to, be, been, is, and, has, have, with, that, at, of, same, does');
  Assert.alias(value, this);
}

/**
 * Attempt to mimic the configuration API of chai.js so it's dead simple to
 * migrate from chai.js to assume.
 *
 * @type {Object}
 * @public
 */
Assert.config = {
  includeStack: true,     // mapped to `stacktrace` as default value.
  showDiff: true          // mapped to `diff` as default value.
};

/**
 * Assign values to a given thing.
 *
 * @param {Mixed} where Where do the new properties need to be assigned on.
 * @returns {Function}
 * @api public
 */
Assert.assign = function assign(where) {
  return function assigns(aliases, value) {
    if ('string' === typeof aliases) {
      if (~aliases.indexOf(',')) aliases = aliases.split(/[\s|\,]+/);
      else aliases = [aliases];
    }

    for (var i = 0, length = aliases.length; i < length; i++) {
      where[aliases[i]] = value || where;
    }

    return where;
  };
};

/**
 * Add aliases to the given constructed asserts. This allows us to chain
 * assertion calls together.
 *
 * @param {Mixed} value Value that we need to assert.
 * @param {Assert} assert The constructed assert instance.
 * @returns {Assert} The given assert instance.
 * @api private
 */
Assert.alias = function alias(value, assert) {
  var assign = Assert.assign(assert)
    , flags, flag, prop;

  for (prop in Assert.aliases) {
    if (!hasOwn.call(Assert.aliases, prop)) continue;

    if (!assert[prop]) {
      flags = {};

      for (flag in Assert.aliases) {
        if (!hasOwn.call(Assert.aliases, flag)) continue;
        flags[flag] = assert[flag];
      }

      //
      // Add some default values to the flags.
      //
      flags.stacktrace = assert.stacktrace;
      flags.diff = assert.diff;
      flags[prop] = true;

      assign(Assert.aliases[prop], new Assert(value, flags));
    } else assign(Assert.aliases);
  }

  return assert;
};

/**
 * List of aliases and properties that need to be created for chaining purposes.
 * Plugins could add extra properties that needed to be chained as well.
 *
 * @type {Object}
 * @public
 */
Assert.aliases = {
  falsely: 'doesnt, not, dont',
  deeply: 'deep'
};

/**
 * API sugar of adding aliased prototypes to the Assert. This makes the code
 * a bit more workable and human readable.
 *
 * @param {String|Array} aliases List of methods.
 * @param {Function} fn Actual assertion function.
 * @returns {Assert}
 * @api public
 */
Assert.add = Assert.assign(Assert.prototype);

/**
 * Asserts if the given value is the correct type. We need to use
 * Object.toString here because there are some implementation bugs the `typeof`
 * operator:
 *
 * - Chrome <= 9: /Regular Expressions/ are evaluated to `function`
 *
 * As well as all common flaws like Arrays being seen as Objects etc. This
 * eliminates all these edge cases.
 *
 * @param {String} of Type of class it should equal
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('a, an', function typecheck(of, msg) {
  return this.test(type(this.value) === of, msg, new BackTrace());
});

/**
 * Asserts that the value is instanceof the given constructor.
 *
 * @param {Function} constructor Constructur the value should inherit from.
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('instanceOf, instanceof, inherits, inherit', function of(constructor, msg) {
  return this.test(this.value instanceof constructor, msg, new BackTrace());
});

/**
 * Assert that the value includes the given value.
 *
 * @param {Mixed} val Value to match.
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('include, includes, contain, contains', function contain(val, msg) {
  var includes = false;

  switch (type(this.value)) {
    case 'array':
      for (var i = 0, length = this.value.length; i < length; i++) {
        if (val === this.value[i]) {
          includes = true;
          break;
        }
      }
    break;

    case 'object':
      if (val in this.value) {
        includes = true;
      }
    break;

    case 'string':
      if (~this.value.indexOf(val)) {
        includes = true;
      }
    break;
  }

  return this.test(includes === true, msg, new BackTrace());
});

/**
 * Assert that the value is truthy.
 *
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('ok, truthy, truly', function ok(msg) {
  return this.test(Boolean(this.value) === true, msg, new BackTrace());
});

/**
 * Assert that the value is `true`.
 *
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('true', function ok(msg) {
  return this.test(this.value === true, msg, new BackTrace());
});

/**
 * Assert that the value is `true`.
 *
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('false', function nope(msg) {
  return this.test(this.value === false, msg, new BackTrace());
});

/**
 * Assert that the value is falsey.
 *
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('falsely, falsey', function nope(msg) {
  return this.test(Boolean(this.value) === false, msg, new BackTrace());
});

/**
 * Assert that the value exists.
 *
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('exists', function exists(msg) {
  return this.test(this.value != null, msg, new BackTrace());
});

/**
 * Asserts that the value's length is 0 or doesn't contain any enumerable keys.
 *
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('empty', function empty(msg) {
  return this.test(size(this.value) === 0, msg, new BackTrace());
});

/**
 * Assert that the value is greater than the specified value.
 *
 * @param {Number} value The greater than value.
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('above, gt, greater, greaterThan', function above(value, msg) {
  var amount = type(this.value) !== 'number'
    ? size(this.value)
    : this.value;

  return this.test(amount > value, msg, new BackTrace());
});

/**
 * Assert that the value is equal or greater than the specified value.
 *
 * @param {Number} value The specified value.
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('least, gte', function least(value, msg) {
  var amount = type(this.value) !== 'number'
    ? size(this.value)
    : this.value;

  return this.test(amount >= value, msg, new BackTrace());
});

/**
 * Assert that the value is below the specified value.
 *
 * @param {Number} value The specified value.
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('below, lt, less, lessThan', function below(value, msg) {
  var amount = type(this.value) !== 'number'
    ? size(this.value)
    : this.value;

  return this.test(amount < value, msg, new BackTrace());
});

/**
 * Assert that the value is below or equal to the specified value.
 *
 * @param {Number} value The specified value.
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('most, lte', function most(value, msg) {
  var amount = type(this.value) !== 'number'
    ? size(this.value)
    : this.value;

  return this.test(amount <= value, msg, new BackTrace());
});

/**
 * Assert that that value is within the given range.
 *
 * @param {Number} start Lower bound.
 * @param {Number} finish Upper bound.
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('within, between', function within(start, finish, msg) {
  var amount = type(this.value) !== 'number'
    ? size(this.value)
    : this.value;

  return this.test(amount >= start && amount <= finish, msg, new BackTrace());
});

/**
 * Assert that the value has an own property with the given prop.
 *
 * @param {String} prop Property name.
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('hasOwn, own, ownProperty, haveOwnProperty', function has(prop, msg) {
  return this.test(hasOwn.call(this.value, prop), msg, new BackTrace());
});

/**
 * Assert that the value equals a given thing.
 *
 * @param {Mixed} thing Thing it should equal.
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('equal, equals, eq', function equal(thing, msg) {
  if (!this.deeply) return this.test(this.value === thing, msg, new BackTrace());

  return this.eql(thing, msg);
});

/**
 * Assert that the value **deeply** equals a given thing.
 *
 * @param {Mixed} thing Thing it should equal.
 * @param {String} msg Reason of failure.
 * @returns {Assert}
 * @api public
 */
Assert.add('eql, eqls', function eqls(thing, msg) {
  return this.test(deep(this.value, thing), msg, new BackTrace());
});

/**
 * Validate the assertion.
 *
 * @param {Boolean} passed Didn't the test pass or fail.
 * @param {String} msg Custom message provided by users.
 * @param {String} expectation What the assertion expected.
 * @param {Array} stack Stack trace
 * @returns {Assert}
 * @api private
 */
Assert.add('test', function test(passed, msg, expectation, stack) {
  if (this.falsely) passed = !passed;
  if (passed) return this;

  if (expectation instanceof BackTrace) {
    stack = expectation;
    expectation = undefined;
  }

  throw new Failure(msg, {
    stack: stack.slice(4),
    expectation: expectation,
    stacktrace: this.stacktrace
  });
});

//
// Create type checks for all build-in JavaScript classes.
//
each(('new String,new Number,new Array,new Date,new Error,new RegExp,new Boolean,'
  + 'new Float32Array,new Float64Array,new Int16Array,new Int32Array,new Int8Array,'
  + 'new Uint16Array,new Uint32Array,new Uint8Array,new Uint8ClampedArray,'
  + 'new ParallelArray,new Map,new Set,new WeakMap,new WeakSet,'
  + 'new DataView(new ArrayBuffer(1)),new ArrayBuffer(1),new Promise(function(){}),'
  + 'new Blob,arguments,null,undefined,new Buffer(1)').split(','), function iterate(code) {
  var name, arg;

  //
  // Not all of these constructors are supported in the browser, we're going to
  // compile dedicated functions that returns a new instance of the given
  // constructor. If it's not supported the code will throw and we will simply
  // return.
  //
  try { arg = (new Function('return '+ code))(); }
  catch (e) { return; }

  name = type(arg);

  Assert.add(name, function typecheck(msg) {
    return this.test(type(this.value) === name, msg, new BackTrace());
  });
});

//
// Introduce an alternate API:
//
// ```js
// var i = require('assume');
//
// i.assume.that('foo').equals('bar');
// i.sincerely.hope.that('foo').equals('bar');
// i.expect.that('foo').equals('bar');
// ```
//
Assert.hope = { that: Assert };
Assert.assign(Assert)('sincerely, expect');
Assert.assign(Assert)('assume, expect', Assert.hope);

//
// Expose the module.
//
module.exports = Assert;
