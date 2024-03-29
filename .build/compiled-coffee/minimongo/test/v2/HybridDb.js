
/*

Database which caches locally in a localDb but pulls results
ultimately from a RemoteDb
*/


(function() {
  var HybridCollection, HybridDb, processFind, _,
    __indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

  _ = require('lodash');

  processFind = require('./utils').processFind;

  module.exports = HybridDb = (function() {

    function HybridDb(localDb, remoteDb) {
      this.localDb = localDb;
      this.remoteDb = remoteDb;
      this.collections = {};
    }

    HybridDb.prototype.addCollection = function(name, options, success, error) {
      var collection, _ref;
      if (_.isFunction(options)) {
        _ref = [{}, options, success], options = _ref[0], success = _ref[1], error = _ref[2];
      }
      collection = new HybridCollection(name, this.localDb[name], this.remoteDb[name], options);
      this[name] = collection;
      this.collections[name] = collection;
      if (success != null) {
        return success();
      }
    };

    HybridDb.prototype.removeCollection = function(name, success, error) {
      delete this[name];
      delete this.collections[name];
      if (success != null) {
        return success();
      }
    };

    HybridDb.prototype.upload = function(success, error) {
      var cols, uploadCols;
      cols = _.values(this.collections);
      uploadCols = function(cols, success, error) {
        var col;
        col = _.first(cols);
        if (col) {
          return col.upload(function() {
            return uploadCols(_.rest(cols), success, error);
          }, function(err) {
            return error(err);
          });
        } else {
          return success();
        }
      };
      return uploadCols(cols, success, error);
    };

    return HybridDb;

  })();

  HybridCollection = (function() {

    function HybridCollection(name, localCol, remoteCol, options) {
      this.name = name;
      this.localCol = localCol;
      this.remoteCol = remoteCol;
      options = options || {};
      _.defaults(options, {
        caching: true
      });
      this.caching = options.caching;
    }

    HybridCollection.prototype.find = function(selector, options) {
      var _this = this;
      if (options == null) {
        options = {};
      }
      return {
        fetch: function(success, error) {
          return _this._findFetch(selector, options, success, error);
        }
      };
    };

    HybridCollection.prototype.findOne = function(selector, options, success, error) {
      var mode, remoteSuccess2, _ref,
        _this = this;
      if (options == null) {
        options = {};
      }
      if (_.isFunction(options)) {
        _ref = [{}, options, success], options = _ref[0], success = _ref[1], error = _ref[2];
      }
      mode = options.mode || (this.caching ? "hybrid" : "remote");
      if (mode === "hybrid" || mode === "local") {
        options.limit = 1;
        return this.localCol.findOne(selector, options, function(localDoc) {
          var remoteError, remoteSuccess;
          if (localDoc) {
            success(localDoc);
            if (mode === "local") {
              return;
            }
          }
          remoteSuccess = function(remoteDoc) {
            var cacheSuccess, docs;
            cacheSuccess = function() {
              return _this.localCol.findOne(selector, options, function(localDoc2) {
                if (!_.isEqual(localDoc, localDoc2)) {
                  return success(localDoc2);
                } else if (!localDoc) {
                  return success(null);
                }
              });
            };
            docs = remoteDoc ? [remoteDoc] : [];
            return _this.localCol.cache(docs, selector, options, cacheSuccess, error);
          };
          remoteError = function() {
            if (!localDoc) {
              return success(null);
            }
          };
          return _this.remoteCol.findOne(selector, _.omit(options, 'fields'), remoteSuccess, remoteError);
        }, error);
      } else if (mode === "remote") {
        if (selector._id) {
          remoteSuccess2 = function(remoteData) {
            return _this.localCol.pendingUpserts(function(pendingUpserts) {
              var localData;
              localData = _.findWhere(pendingUpserts, {
                _id: selector._id
              });
              if (localData) {
                return success(localData);
              }
              return _this.localCol.pendingRemoves(function(pendingRemoves) {
                var _ref1;
                if (_ref1 = selector._id, __indexOf.call(pendingRemoves, _ref1) >= 0) {
                  return success(null);
                }
                return success(remoteData);
              });
            }, error);
          };
          return this.remoteCol.findOne(selector, options, remoteSuccess2, error);
        } else {
          return this.find(selector, options).fetch(function(findData) {
            if (findData.length > 0) {
              return success(findData[0]);
            } else {
              return success(null);
            }
          }, function(err) {
            if (_this.caching) {
              return _this.localCol.findOne(selector, options, success, error);
            } else {
              if (error) {
                return error(err);
              }
            }
          });
        }
      } else {
        throw new Error("Unknown mode");
      }
    };

    HybridCollection.prototype._findFetch = function(selector, options, success, error) {
      var localSuccess, mode, remoteError, remoteSuccess,
        _this = this;
      mode = options.mode || (this.caching ? "hybrid" : "remote");
      if (mode === "hybrid") {
        localSuccess = function(localData) {
          var remoteSuccess;
          success(localData);
          remoteSuccess = function(remoteData) {
            var cacheSuccess;
            cacheSuccess = function() {
              var localSuccess2;
              localSuccess2 = function(localData2) {
                if (!_.isEqual(localData, localData2)) {
                  return success(localData2);
                }
              };
              return _this.localCol.find(selector, options).fetch(localSuccess2, error);
            };
            return _this.localCol.cache(remoteData, selector, options, cacheSuccess, error);
          };
          return _this.remoteCol.find(selector, _.omit(options, "fields")).fetch(remoteSuccess);
        };
        return this.localCol.find(selector, options).fetch(localSuccess, error);
      } else if (mode === "local") {
        return this.localCol.find(selector, options).fetch(success, error);
      } else if (mode === "remote") {
        remoteSuccess = function(remoteData) {
          var data;
          data = remoteData;
          return _this.localCol.pendingRemoves(function(removes) {
            var removesMap;
            if (removes.length > 0) {
              removesMap = _.object(_.map(removes, function(id) {
                return [id, id];
              }));
              data = _.filter(remoteData, function(doc) {
                return !_.has(removesMap, doc._id);
              });
            }
            return _this.localCol.pendingUpserts(function(upserts) {
              var upsertsMap;
              if (upserts.length > 0) {
                upsertsMap = _.object(_.pluck(upserts, '_id'), _.pluck(upserts, '_id'));
                data = _.filter(data, function(doc) {
                  return !_.has(upsertsMap, doc._id);
                });
                data = data.concat(upserts);
                data = processFind(data, selector, options);
              }
              return success(data);
            });
          });
        };
        remoteError = function(err) {
          if (_this.caching) {
            return _this.localCol.find(selector, options).fetch(success, error);
          } else {
            if (error) {
              return error(err);
            }
          }
        };
        return this.remoteCol.find(selector, options).fetch(remoteSuccess, remoteError);
      } else {
        throw new Error("Unknown mode");
      }
    };

    HybridCollection.prototype.upsert = function(doc, success, error) {
      return this.localCol.upsert(doc, function(result) {
        if (success != null) {
          return success(result);
        }
      }, error);
    };

    HybridCollection.prototype.remove = function(id, success, error) {
      return this.localCol.remove(id, function() {
        if (success != null) {
          return success();
        }
      }, error);
    };

    HybridCollection.prototype.upload = function(success, error) {
      var uploadRemoves, uploadUpserts,
        _this = this;
      uploadUpserts = function(upserts, success, error) {
        var upsert;
        upsert = _.first(upserts);
        if (upsert) {
          return _this.remoteCol.upsert(upsert, function(remoteDoc) {
            return _this.localCol.resolveUpsert(upsert, function() {
              if (_this.caching) {
                return _this.localCol.cacheOne(remoteDoc, function() {
                  return uploadUpserts(_.rest(upserts), success, error);
                }, error);
              } else {
                return _this.localCol.remove(upsert._id, function() {
                  return _this.localCol.resolveRemove(upsert._id, function() {
                    return uploadUpserts(_.rest(upserts), success, error);
                  }, error);
                }, error);
              }
            }, error);
          }, function(err) {
            if (err.status === 410 || err.status === 403) {
              return _this.localCol.remove(upsert._id, function() {
                return _this.localCol.resolveRemove(upsert._id, function() {
                  if (err.status === 410) {
                    return uploadUpserts(_.rest(upserts), success, error);
                  } else {
                    return error(err);
                  }
                }, error);
              }, error);
            } else {
              return error(err);
            }
          });
        } else {
          return success();
        }
      };
      uploadRemoves = function(removes, success, error) {
        var remove;
        remove = _.first(removes);
        if (remove) {
          return _this.remoteCol.remove(remove, function() {
            return _this.localCol.resolveRemove(remove, function() {
              return uploadRemoves(_.rest(removes), success, error);
            }, error);
          }, function(err) {
            if (err.status === 410 || err.status === 403) {
              return _this.localCol.resolveRemove(remove, function() {
                if (err.status === 410) {
                  return uploadRemoves(_.rest(removes), success, error);
                } else {
                  return error(err);
                }
              }, error);
            } else {
              return error(err);
            }
          }, error);
        } else {
          return success();
        }
      };
      return this.localCol.pendingUpserts(function(upserts) {
        return uploadUpserts(upserts, function() {
          return _this.localCol.pendingRemoves(function(removes) {
            return uploadRemoves(removes, success, error);
          }, error);
        }, error);
      }, error);
    };

    return HybridCollection;

  })();

}).call(this);
