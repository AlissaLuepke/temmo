(function() {
  var Collection, LocalStorageDb, compileSort, createUid, processFind, _;

  _ = require('lodash');

  createUid = require('./utils').createUid;

  processFind = require('./utils').processFind;

  compileSort = require('./selector').compileSort;

  module.exports = LocalStorageDb = (function() {

    function LocalStorageDb(options, success) {
      this.collections = {};
      if (options && options.namespace && window.localStorage) {
        this.namespace = options.namespace;
      }
      if (success) {
        success(this);
      }
    }

    LocalStorageDb.prototype.addCollection = function(name, success, error) {
      var collection, namespace;
      if (this.namespace) {
        namespace = this.namespace + "." + name;
      }
      collection = new Collection(name, namespace);
      this[name] = collection;
      this.collections[name] = collection;
      if (success != null) {
        return success();
      }
    };

    LocalStorageDb.prototype.removeCollection = function(name, success, error) {
      var i, key, keys, _i, _j, _len, _ref;
      if (this.namespace && window.localStorage) {
        keys = [];
        for (i = _i = 0, _ref = window.localStorage.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
          keys.push(window.localStorage.key(i));
        }
        for (_j = 0, _len = keys.length; _j < _len; _j++) {
          key = keys[_j];
          if (key.substring(0, this.namespace.length + 1) === this.namespace + ".") {
            window.localStorage.removeItem(key);
          }
        }
      }
      delete this[name];
      delete this.collections[name];
      if (success != null) {
        return success();
      }
    };

    return LocalStorageDb;

  })();

  Collection = (function() {

    function Collection(name, namespace) {
      this.name = name;
      this.namespace = namespace;
      this.items = {};
      this.upserts = {};
      this.removes = {};
      if (window.localStorage && (namespace != null)) {
        this.loadStorage();
      }
    }

    Collection.prototype.loadStorage = function() {
      var i, item, key, removeItems, upsertKeys, _i, _j, _len, _ref;
      this.itemNamespace = this.namespace + "_";
      for (i = _i = 0, _ref = window.localStorage.length; 0 <= _ref ? _i < _ref : _i > _ref; i = 0 <= _ref ? ++_i : --_i) {
        key = window.localStorage.key(i);
        if (key.substring(0, this.itemNamespace.length) === this.itemNamespace) {
          item = JSON.parse(window.localStorage[key]);
          this.items[item._id] = item;
        }
      }
      upsertKeys = window.localStorage[this.namespace + "upserts"] ? JSON.parse(window.localStorage[this.namespace + "upserts"]) : [];
      for (_j = 0, _len = upsertKeys.length; _j < _len; _j++) {
        key = upsertKeys[_j];
        this.upserts[key] = this.items[key];
      }
      removeItems = window.localStorage[this.namespace + "removes"] ? JSON.parse(window.localStorage[this.namespace + "removes"]) : [];
      return this.removes = _.object(_.pluck(removeItems, "_id"), removeItems);
    };

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
      if (success != null) {
        return success(processFind(this.items, selector, options));
      }
    };

    Collection.prototype.upsert = function(doc, success, error) {
      var item, items, _i, _len;
      items = doc;
      if (!_.isArray(items)) {
        items = [items];
      }
      for (_i = 0, _len = items.length; _i < _len; _i++) {
        item = items[_i];
        if (!item._id) {
          item._id = createUid();
        }
        this._putItem(item);
        this._putUpsert(item);
      }
      if (success) {
        return success(doc);
      }
    };

    Collection.prototype.remove = function(id, success, error) {
      if (_.has(this.items, id)) {
        this._putRemove(this.items[id]);
        this._deleteItem(id);
        this._deleteUpsert(id);
      } else {
        this._putRemove({
          _id: id
        });
      }
      if (success != null) {
        return success();
      }
    };

    Collection.prototype._putItem = function(doc) {
      this.items[doc._id] = doc;
      if (this.namespace) {
        return window.localStorage[this.itemNamespace + doc._id] = JSON.stringify(doc);
      }
    };

    Collection.prototype._deleteItem = function(id) {
      delete this.items[id];
      if (this.namespace) {
        return window.localStorage.removeItem(this.itemNamespace + id);
      }
    };

    Collection.prototype._putUpsert = function(doc) {
      this.upserts[doc._id] = doc;
      if (this.namespace) {
        return window.localStorage[this.namespace + "upserts"] = JSON.stringify(_.keys(this.upserts));
      }
    };

    Collection.prototype._deleteUpsert = function(id) {
      delete this.upserts[id];
      if (this.namespace) {
        return window.localStorage[this.namespace + "upserts"] = JSON.stringify(_.keys(this.upserts));
      }
    };

    Collection.prototype._putRemove = function(doc) {
      this.removes[doc._id] = doc;
      if (this.namespace) {
        return window.localStorage[this.namespace + "removes"] = JSON.stringify(_.values(this.removes));
      }
    };

    Collection.prototype._deleteRemove = function(id) {
      delete this.removes[id];
      if (this.namespace) {
        return window.localStorage[this.namespace + "removes"] = JSON.stringify(_.values(this.removes));
      }
    };

    Collection.prototype.cache = function(docs, selector, options, success, error) {
      var doc, docsMap, sort, _i, _len,
        _this = this;
      for (_i = 0, _len = docs.length; _i < _len; _i++) {
        doc = docs[_i];
        this.cacheOne(doc);
      }
      docsMap = _.object(_.pluck(docs, "_id"), docs);
      if (options.sort) {
        sort = compileSort(options.sort);
      }
      return this.find(selector, options).fetch(function(results) {
        var result, _j, _len1;
        for (_j = 0, _len1 = results.length; _j < _len1; _j++) {
          result = results[_j];
          if (!docsMap[result._id] && !_.has(_this.upserts, result._id)) {
            if (options.sort && options.limit && docs.length === options.limit) {
              if (sort(result, _.last(docs)) >= 0) {
                continue;
              }
            }
            _this._deleteItem(result._id);
          }
        }
        if (success != null) {
          return success();
        }
      }, error);
    };

    Collection.prototype.pendingUpserts = function(success) {
      return success(_.values(this.upserts));
    };

    Collection.prototype.pendingRemoves = function(success) {
      return success(_.pluck(this.removes, "_id"));
    };

    Collection.prototype.resolveUpsert = function(doc, success) {
      var item, items, _i, _len;
      items = doc;
      if (!_.isArray(items)) {
        items = [items];
      }
      for (_i = 0, _len = items.length; _i < _len; _i++) {
        item = items[_i];
        if (this.upserts[item._id]) {
          if (_.isEqual(item, this.upserts[item._id])) {
            this._deleteUpsert(item._id);
          }
        }
      }
      if (success != null) {
        return success();
      }
    };

    Collection.prototype.resolveRemove = function(id, success) {
      this._deleteRemove(id);
      if (success != null) {
        return success();
      }
    };

    Collection.prototype.seed = function(doc, success) {
      if (!_.has(this.items, doc._id) && !_.has(this.removes, doc._id)) {
        this._putItem(doc);
      }
      if (success != null) {
        return success();
      }
    };

    Collection.prototype.cacheOne = function(doc, success) {
      var existing;
      if (!_.has(this.upserts, doc._id) && !_.has(this.removes, doc._id)) {
        existing = this.items[doc._id];
        if (!existing || !doc._rev || !existing._rev || doc._rev >= existing._rev) {
          this._putItem(doc);
        }
      }
      if (success != null) {
        return success();
      }
    };

    return Collection;

  })();

}).call(this);
