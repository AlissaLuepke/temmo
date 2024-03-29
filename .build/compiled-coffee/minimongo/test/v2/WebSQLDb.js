(function() {
  var Collection, WebSQLDb, async, compileSort, createUid, doNothing, processFind, _;

  _ = require('lodash');

  async = require('async');

  createUid = require('./utils').createUid;

  processFind = require('./utils').processFind;

  compileSort = require('./selector').compileSort;

  doNothing = function() {};

  module.exports = WebSQLDb = (function() {

    function WebSQLDb(options, success, error) {
      var createTables,
        _this = this;
      this.collections = {};
      this.db = window.openDatabase('minimongo_' + options.namespace, '', 'Minimongo:' + options.namespace, 5 * 1024 * 1024);
      if (!this.db) {
        return error("Failed to create database");
      }
      createTables = function(tx) {
        return tx.executeSql('CREATE TABLE IF NOT EXISTS docs (\n  col TEXT NOT NULL,\n  id TEXT NOT NULL,\n  state TEXT NOT NULL,\n  doc TEXT,\n  PRIMARY KEY (col, id));', [], doNothing, error);
      };
      this.db.transaction(createTables, error, function() {
        if (success) {
          return success(_this);
        }
      });
    }

    WebSQLDb.prototype.addCollection = function(name, success, error) {
      var collection;
      collection = new Collection(name, this.db);
      this[name] = collection;
      this.collections[name] = collection;
      if (success) {
        return success();
      }
    };

    WebSQLDb.prototype.removeCollection = function(name, success, error) {
      delete this[name];
      delete this.collections[name];
      return this.db.transaction(function(tx) {
        return tx.executeSql("DELETE FROM docs WHERE col = ?", [name], success, error);
      }, error);
    };

    return WebSQLDb;

  })();

  Collection = (function() {

    function Collection(name, db) {
      this.name = name;
      this.db = db;
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
      var _this = this;
      error = error || function() {};
      return this.db.readTransaction(function(tx) {
        return tx.executeSql("SELECT * FROM docs WHERE col = ?", [_this.name], function(tx, results) {
          var docs, i, row, _i, _ref;
          docs = [];
          for (i = _i = 0, _ref = results.rows.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
            row = results.rows.item(i);
            if (row.state !== "removed") {
              docs.push(JSON.parse(row.doc));
            }
          }
          if (success != null) {
            return success(processFind(docs, selector, options));
          }
        }, error);
      }, error);
    };

    Collection.prototype.upsert = function(doc, success, error) {
      var item, items, _i, _len,
        _this = this;
      error = error || function() {};
      items = doc;
      if (!_.isArray(items)) {
        items = [items];
      }
      for (_i = 0, _len = items.length; _i < _len; _i++) {
        item = items[_i];
        if (!item._id) {
          item._id = createUid();
        }
      }
      return this.db.transaction(function(tx) {
        var _j, _len1, _results;
        _results = [];
        for (_j = 0, _len1 = items.length; _j < _len1; _j++) {
          item = items[_j];
          _results.push(tx.executeSql("INSERT OR REPLACE INTO docs (col, id, state, doc) VALUES (?, ?, ?, ?)", [_this.name, item._id, "upserted", JSON.stringify(item)], doNothing, error));
        }
        return _results;
      }, error, function() {
        if (success) {
          return success(doc);
        }
      });
    };

    Collection.prototype.remove = function(id, success, error) {
      var _this = this;
      error = error || function() {};
      return this.db.transaction(function(tx) {
        return tx.executeSql("SELECT * FROM docs WHERE col = ? AND id = ?", [_this.name, id], function(tx, results) {
          if (results.rows.length > 0) {
            return tx.executeSql('UPDATE docs SET state="removed" WHERE col = ? AND id = ?', [_this.name, id], function() {
              if (success) {
                return success(id);
              }
            }, error);
          } else {
            return tx.executeSql("INSERT INTO docs (col, id, state, doc) VALUES (?, ?, ?, ?)", [
              _this.name, id, "removed", JSON.stringify({
                _id: id
              })
            ], function() {
              if (success) {
                return success(id);
              }
            }, error);
          }
        }, error);
      }, error);
    };

    Collection.prototype.cache = function(docs, selector, options, success, error) {
      var _this = this;
      error = error || function() {};
      return this.db.transaction(function(tx) {
        return async.eachSeries(docs, function(doc, callback) {
          return tx.executeSql("SELECT * FROM docs WHERE col = ? AND id = ?", [_this.name, doc._id], function(tx, results) {
            var existing;
            if (results.rows.length === 0 || results.rows.item(0).state === "cached") {
              existing = results.rows.length > 0 ? JSON.parse(results.rows.item(0).doc) : null;
              if (!existing || !doc._rev || !existing._rev || doc._rev >= existing._rev) {
                return tx.executeSql("INSERT OR REPLACE INTO docs (col, id, state, doc) VALUES (?, ?, ?, ?)", [_this.name, doc._id, "cached", JSON.stringify(doc)], function() {
                  return callback();
                }, error);
              } else {
                return callback();
              }
            } else {
              return callback();
            }
          }, callback, error);
        }, function(err) {
          var docsMap, sort;
          if (err) {
            if (error) {
              error(err);
            }
            return;
          }
          docsMap = _.object(_.pluck(docs, "_id"), docs);
          if (options.sort) {
            sort = compileSort(options.sort);
          }
          return _this.find(selector, options).fetch(function(results) {
            return _this.db.transaction(function(tx) {
              return async.eachSeries(results, function(result, callback) {
                return tx.executeSql("SELECT * FROM docs WHERE col = ? AND id = ?", [_this.name, result._id], function(tx, rows) {
                  if (!docsMap[result._id] && rows.rows.length > 0 && rows.rows.item(0).state === "cached") {
                    if (options.sort && options.limit && docs.length === options.limit) {
                      if (sort(result, _.last(docs)) >= 0) {
                        return callback();
                      }
                    }
                    return tx.executeSql("DELETE FROM docs WHERE col = ? AND id = ?", [_this.name, result._id], function() {
                      return callback();
                    }, error);
                  } else {
                    return callback();
                  }
                }, callback, error);
              }, function(err) {
                if (err != null) {
                  if (error != null) {
                    error(err);
                  }
                  return;
                }
                if (success != null) {
                  return success();
                }
              });
            }, error);
          }, error);
        });
      }, error);
    };

    Collection.prototype.pendingUpserts = function(success, error) {
      var _this = this;
      error = error || function() {};
      return this.db.readTransaction(function(tx) {
        return tx.executeSql("SELECT * FROM docs WHERE col = ? AND state = ?", [_this.name, "upserted"], function(tx, results) {
          var docs, i, row, _i, _ref;
          docs = [];
          for (i = _i = 0, _ref = results.rows.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
            row = results.rows.item(i);
            docs.push(JSON.parse(row.doc));
          }
          if (success != null) {
            return success(docs);
          }
        }, error);
      }, error);
    };

    Collection.prototype.pendingRemoves = function(success, error) {
      var _this = this;
      error = error || function() {};
      return this.db.readTransaction(function(tx) {
        return tx.executeSql("SELECT * FROM docs WHERE col = ? AND state = ?", [_this.name, "removed"], function(tx, results) {
          var docs, i, row, _i, _ref;
          docs = [];
          for (i = _i = 0, _ref = results.rows.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
            row = results.rows.item(i);
            docs.push(JSON.parse(row.doc)._id);
          }
          if (success != null) {
            return success(docs);
          }
        }, error);
      }, error);
    };

    Collection.prototype.resolveUpsert = function(doc, success, error) {
      var items,
        _this = this;
      error = error || function() {};
      items = doc;
      if (!_.isArray(items)) {
        items = [items];
      }
      return this.db.transaction(function(tx) {
        return async.eachSeries(items, function(item, cb) {
          return tx.executeSql("SELECT * FROM docs WHERE col = ? AND id = ?", [_this.name, item._id], function(tx, results) {
            if (results.rows.length > 0) {
              if (results.rows.item(0).state === "upserted" && _.isEqual(JSON.parse(results.rows.item(0).doc), item)) {
                tx.executeSql('UPDATE docs SET state="cached" WHERE col = ? AND id = ?', [_this.name, item._id], doNothing, error);
                return cb();
              } else {
                return cb();
              }
            } else {
              return cb();
            }
          }, error);
        }, function(err) {
          if (err) {
            return error(err);
          }
          if (success) {
            return success(doc);
          }
        });
      }, error);
    };

    Collection.prototype.resolveRemove = function(id, success, error) {
      var _this = this;
      error = error || function() {};
      return this.db.transaction(function(tx) {
        return tx.executeSql('DELETE FROM docs WHERE state="removed" AND col = ? AND id = ?', [_this.name, id], function() {
          if (success) {
            return success(id);
          }
        }, error);
      }, error);
    };

    Collection.prototype.seed = function(doc, success, error) {
      var _this = this;
      error = error || function() {};
      return this.db.transaction(function(tx) {
        return tx.executeSql("SELECT * FROM docs WHERE col = ? AND id = ?", [_this.name, doc._id], function(tx, results) {
          if (results.rows.length === 0) {
            return tx.executeSql("INSERT INTO docs (col, id, state, doc) VALUES (?, ?, ?, ?)", [_this.name, doc._id, "cached", JSON.stringify(doc)], function() {
              if (success) {
                return success(doc);
              }
            }, error);
          } else {
            if (success) {
              return success(doc);
            }
          }
        }, error);
      }, error);
    };

    Collection.prototype.cacheOne = function(doc, success, error) {
      var _this = this;
      error = error || function() {};
      return this.db.transaction(function(tx) {
        return tx.executeSql("SELECT * FROM docs WHERE col = ? AND id = ?", [_this.name, doc._id], function(tx, results) {
          var existing;
          if (results.rows.length === 0 || results.rows.item(0).state === "cached") {
            existing = results.rows.length > 0 ? JSON.parse(results.rows.item(0).doc) : null;
            if (!existing || !doc._rev || !existing._rev || doc._rev >= existing._rev) {
              return tx.executeSql("INSERT OR REPLACE INTO docs (col, id, state, doc) VALUES (?, ?, ?, ?)", [_this.name, doc._id, "cached", JSON.stringify(doc)], function() {
                if (success) {
                  return success(doc);
                }
              }, error);
            } else {
              if (success) {
                return success(doc);
              }
            }
          } else {
            if (success) {
              return success(doc);
            }
          }
        }, error);
      }, error);
    };

    return Collection;

  })();

}).call(this);
