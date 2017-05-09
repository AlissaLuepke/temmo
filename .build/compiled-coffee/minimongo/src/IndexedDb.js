(function() {
  var Collection, IDBStore, IndexedDb, async, compileSort, processFind, utils, _;

  _ = require('lodash');

  async = require('async');

  IDBStore = require('idb-wrapper');

  utils = require('./utils');

  processFind = require('./utils').processFind;

  compileSort = require('./selector').compileSort;

  module.exports = IndexedDb = (function() {

    function IndexedDb(options, success, error) {
      var _this = this;
      this.collections = {};
      try {
        this.store = new IDBStore({
          dbVersion: 1,
          storeName: 'minimongo_' + options.namespace,
          keyPath: ['col', 'doc._id'],
          autoIncrement: false,
          onStoreReady: function() {
            if (success) {
              return success(_this);
            }
          },
          onError: error,
          indexes: [
            {
              name: 'col',
              keyPath: 'col',
              unique: false,
              multiEntry: false
            }, {
              name: 'col-state',
              keyPath: ['col', 'state'],
              unique: false,
              multiEntry: false
            }
          ]
        });
      } catch (ex) {
        if (error) {
          error(ex);
        }
        return;
      }
    }

    IndexedDb.prototype.addCollection = function(name, success, error) {
      var collection;
      collection = new Collection(name, this.store);
      this[name] = collection;
      this.collections[name] = collection;
      if (success) {
        return success();
      }
    };

    IndexedDb.prototype.removeCollection = function(name, success, error) {
      var _this = this;
      delete this[name];
      delete this.collections[name];
      return this.store.query(function(matches) {
        var keys;
        keys = _.map(matches, function(m) {
          return [m.col, m.doc._id];
        });
        if (keys.length > 0) {
          return _this.store.removeBatch(keys, function() {
            if (success != null) {
              return success();
            }
          }, error);
        } else {
          if (success != null) {
            return success();
          }
        }
      }, {
        index: "col",
        keyRange: this.store.makeKeyRange({
          only: name
        }),
        onError: error
      });
    };

    return IndexedDb;

  })();

  Collection = (function() {

    function Collection(name, store) {
      this.name = name;
      this.store = store;
    }

    Collection.prototype.find = function(selector, options) {
      var _this = this;
      return {
        fetch: function(success, error) {
          return _this._findFetch(selector, options, success, error);
        }
      };
    };

    Collection.prototype.findOne = function(selector, options, success, error) {
      var _ref;
      if (_.isFunction(options)) {
        _ref = [{}, options, success], options = _ref[0], success = _ref[1], error = _ref[2];
      }
      return this.find(selector, options).fetch(function(results) {
        if (success != null) {
          return success(results.length > 0 ? results[0] : null);
        }
      }, error);
    };

    Collection.prototype._findFetch = function(selector, options, success, error) {
      return this.store.query(function(matches) {
        matches = _.filter(matches, function(m) {
          return m.state !== "removed";
        });
        if (success != null) {
          return success(processFind(_.pluck(matches, "doc"), selector, options));
        }
      }, {
        index: "col",
        keyRange: this.store.makeKeyRange({
          only: this.name
        }),
        onError: error
      });
    };

    Collection.prototype.upsert = function(docs, bases, success, error) {
      var items, keys, _ref,
        _this = this;
      _ref = utils.regularizeUpsert(docs, bases, success, error), items = _ref[0], success = _ref[1], error = _ref[2];
      keys = _.map(items, function(item) {
        return [_this.name, item.doc._id];
      });
      return this.store.getBatch(keys, function(records) {
        var puts;
        puts = _.map(items, function(item, i) {
          var base;
          if (item.base !== void 0) {
            base = item.base;
          } else if (records[i] && records[i].doc && records[i].state === "cached") {
            base = records[i].doc;
          } else if (records[i] && records[i].doc && records[i].state === "upserted") {
            base = records[i].base;
          } else {
            base = null;
          }
          return {
            col: _this.name,
            state: "upserted",
            doc: item.doc,
            base: base
          };
        });
        return _this.store.putBatch(puts, function() {
          if (success) {
            return success(docs);
          }
        }, error);
      }, error);
    };

    Collection.prototype.remove = function(id, success, error) {
      var _this = this;
      if (_.isObject(id)) {
        this.find(id).fetch(function(rows) {
          return async.each(rows, function(row, cb) {
            return _this.remove(row._id, (function() {
              return cb();
            }), cb);
          }, function() {
            return success();
          });
        }, error);
        return;
      }
      return this.store.get([this.name, id], function(record) {
        if (record == null) {
          record = {
            col: _this.name,
            doc: {
              _id: id
            }
          };
        }
        record.state = "removed";
        return _this.store.put(record, function() {
          if (success) {
            return success(id);
          }
        }, error);
      });
    };

    Collection.prototype.cache = function(docs, selector, options, success, error) {
      var keys, puts, step2,
        _this = this;
      step2 = function() {
        var docsMap, sort;
        docsMap = _.object(_.pluck(docs, "_id"), docs);
        if (options.sort) {
          sort = compileSort(options.sort);
        }
        return _this.find(selector, options).fetch(function(results) {
          var keys, removes;
          removes = [];
          keys = _.map(results, function(result) {
            return [_this.name, result._id];
          });
          if (keys.length === 0) {
            if (success != null) {
              success();
            }
            return;
          }
          return _this.store.getBatch(keys, function(records) {
            var i, record, result, _i, _ref;
            for (i = _i = 0, _ref = records.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
              record = records[i];
              result = results[i];
              if (!docsMap[result._id] && record && record.state === "cached") {
                if (options.sort && options.limit && docs.length === options.limit) {
                  if (sort(result, _.last(docs)) >= 0) {
                    continue;
                  }
                }
                removes.push([_this.name, result._id]);
              }
            }
            if (removes.length > 0) {
              return _this.store.removeBatch(removes, function() {
                if (success != null) {
                  return success();
                }
              }, error);
            } else {
              if (success != null) {
                return success();
              }
            }
          }, error);
        }, error);
      };
      if (docs.length === 0) {
        return step2();
      }
      keys = _.map(docs, function(doc) {
        return [_this.name, doc._id];
      });
      puts = [];
      return this.store.getBatch(keys, function(records) {
        var doc, i, record, _i, _ref;
        for (i = _i = 0, _ref = records.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
          record = records[i];
          doc = docs[i];
          if ((record == null) || record.state === "cached") {
            if (!record || !doc._rev || !record.doc._rev || doc._rev >= record.doc._rev) {
              puts.push({
                col: _this.name,
                state: "cached",
                doc: doc
              });
            }
          }
        }
        if (puts.length > 0) {
          return _this.store.putBatch(puts, step2, error);
        } else {
          return step2();
        }
      }, error);
    };

    Collection.prototype.pendingUpserts = function(success, error) {
      return this.store.query(function(matches) {
        var upserts;
        upserts = _.map(matches, function(m) {
          return {
            doc: m.doc,
            base: m.base || null
          };
        });
        if (success != null) {
          return success(upserts);
        }
      }, {
        index: "col-state",
        keyRange: this.store.makeKeyRange({
          only: [this.name, "upserted"]
        }),
        onError: error
      });
    };

    Collection.prototype.pendingRemoves = function(success, error) {
      return this.store.query(function(matches) {
        if (success != null) {
          return success(_.pluck(_.pluck(matches, "doc"), "_id"));
        }
      }, {
        index: "col-state",
        keyRange: this.store.makeKeyRange({
          only: [this.name, "removed"]
        }),
        onError: error
      });
    };

    Collection.prototype.resolveUpserts = function(upserts, success, error) {
      var keys,
        _this = this;
      keys = _.map(upserts, function(upsert) {
        return [_this.name, upsert.doc._id];
      });
      return this.store.getBatch(keys, function(records) {
        var i, puts, record, _i, _ref;
        puts = [];
        for (i = _i = 0, _ref = upserts.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
          record = records[i];
          if (record && record.state === "upserted") {
            if (_.isEqual(record.doc, upserts[i].doc)) {
              record.state = "cached";
              puts.push(record);
            } else {
              record.base = upserts[i].doc;
              puts.push(record);
            }
          }
        }
        if (puts.length > 0) {
          return _this.store.putBatch(puts, function() {
            if (success) {
              return success();
            }
          }, error);
        } else {
          if (success) {
            return success();
          }
        }
      }, error);
    };

    Collection.prototype.resolveRemove = function(id, success, error) {
      var _this = this;
      return this.store.get([this.name, id], function(record) {
        if (!record) {
          if (success != null) {
            success();
          }
          return;
        }
        if (record.state === "removed") {
          return _this.store.remove([_this.name, id], function() {
            if (success != null) {
              return success();
            }
          }, error);
        }
      });
    };

    Collection.prototype.seed = function(docs, success, error) {
      var keys, puts,
        _this = this;
      if (!_.isArray(docs)) {
        docs = [docs];
      }
      keys = _.map(docs, function(doc) {
        return [_this.name, doc._id];
      });
      puts = [];
      return this.store.getBatch(keys, function(records) {
        var doc, i, record, _i, _ref;
        for (i = _i = 0, _ref = records.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
          record = records[i];
          doc = docs[i];
          if (record == null) {
            puts.push({
              col: _this.name,
              state: "cached",
              doc: doc
            });
          }
        }
        if (puts.length > 0) {
          return _this.store.putBatch(puts, function() {
            if (success != null) {
              return success();
            }
          }, error);
        } else {
          if (success != null) {
            return success();
          }
        }
      }, error);
    };

    Collection.prototype.cacheOne = function(doc, success, error) {
      var _this = this;
      return this.store.get([this.name, doc._id], function(record) {
        if (record && doc._rev && record.doc._rev && doc._rev < record.doc._rev) {
          if (success != null) {
            success();
          }
          return;
        }
        if (record == null) {
          record = {
            col: _this.name,
            state: "cached",
            doc: doc
          };
        }
        if (record.state === "cached") {
          record.doc = doc;
          return _this.store.put(record, function() {
            if (success != null) {
              return success();
            }
          }, error);
        } else {
          if (success != null) {
            return success();
          }
        }
      });
    };

    Collection.prototype.uncache = function(selector, success, error) {
      var compiledSelector,
        _this = this;
      compiledSelector = utils.compileDocumentSelector(selector);
      return this.store.query(function(matches) {
        var keys;
        matches = _.filter(matches, function(m) {
          return m.state === "cached" && compiledSelector(m.doc);
        });
        keys = _.map(matches, function(m) {
          return [_this.name, m.doc._id];
        });
        if (keys.length > 0) {
          return _this.store.removeBatch(keys, function() {
            if (success != null) {
              return success();
            }
          }, error);
        } else {
          if (success != null) {
            return success();
          }
        }
      }, {
        index: "col",
        keyRange: this.store.makeKeyRange({
          only: this.name
        }),
        onError: error
      });
    };

    return Collection;

  })();

}).call(this);
