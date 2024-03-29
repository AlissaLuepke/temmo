"use strict";
var poiManager = (function () {
    var db, deg, lat1, lon1, currentObj, heading, accuracy;
    var pois = [];
    var radians = [];
    var seen_pois = "seen_pois";
    var has_seen_poi = [];
    console.log("old Array" + has_seen_poi.length);
    // save data to Local Storage
    localStorage.setItem(seen_pois, JSON.stringify(has_seen_poi));
    var has_seen_poi2 = localStorage.getItem(seen_pois);
    has_seen_poi = JSON.parse(has_seen_poi2);
    // get data from Local Storage
    console.log("retrieved Array" + has_seen_poi.length);
    var active_poi = 0;
    var categories = {
        sights: 0
        , culinary: 1
        , insidertip: 2
    }
    var active = [false, false, false];
    //48.15961   11.640874s
    function init(_db) {
        db = _db;
        // Eventuell aufrufen von filterDatabase();
        // filterDatabase(); aus updatePOIS(); rausnehmen 
        // changePOIS(); in updatePOIS(); umbennen 
        updatePOIS();
        // $('#divGeoWait').show();
        // $('#divGeoWait').hide();
        positionManager.register(_event_watchPosition, function (err) {
            var error;
            switch (err.code) {
            case err.PERMISSION_DENIED:
                error = "GPS nicht verfügbar";
                break;
            case err.POSITION_UNAVAILABLE:
                error = "GPS deaktiviert"
                break;
            case err.TIMEOUT:
                error = "Fehler durch Zeitüberschreitung";
                break;
            default:
                error = "unbekannter Fehler";
            }
            alert(err.code + ': ' + error);
           
        });
        
        
        document.addEventListener("rotarydetent", _event_rotaryEventHandler, false);
        bufferUser();
        redraw();
    }
    for (var i in categories) {
        if (!categories.hasOwnProperty(i)) continue;
        $('#' + i).unbind().click(function () {
            if ($(this).hasClass($(this).attr('id') + 'filteractive')) {
                $('#' + $(this).attr('id')).removeClass($(this).attr('id') + 'filteractive');
                active[categories[$(this).attr('id')]] = false;
                filterDatabase();
            }
            else {
                $('#' + $(this).attr('id')).addClass($(this).attr('id') + 'filteractive');
                active[categories[$(this).attr('id')]] = true;
                console.log($(this).attr('id'));
                filterDatabase();
            }
        })
    }

    function filterDatabase() {
        var query = {};
        var count = 0;
        active.forEach(function (val) {
            if (val == true) count++;
        });
        if (count > 1) query['$or'] = [];
        for (var key in categories) {
            if (!categories.hasOwnProperty(key)) continue;
            if (count > 1) {
                var tmpQuery = {};
                tmpQuery["properties." + key] = true;
                if (active[categories[key]]) query['$or'].push(tmpQuery);
            }
            else {
                if (active[categories[key]]) query["properties." + key] = true;
            }
        }
        db.find(query).fetch(function (results) {
            changePOIS(results);
            redraw();
        }, function (error) {
            console.log(error);
        });
    }
    //Pois werden aus der Datenbank geholt
    // daten aus der datenbank werden durchgegangen 
    // Berechnungen werden durchgeführt
    function updatePOIS() {
        filterDatabase();
    }

    function changePOIS(results) {
        pois = [];
        var had_active;
        for (var i = 0; i < results.length; i++) {
            var has_seen = false;
            var lat2 = results[i].geometry.coordinates[1];
            var lon2 = results[i].geometry.coordinates[0];
            var props = results[i].properties;
            var id = results[i]._id;
            var is_active = active_poi ? results[i]._id == active_poi._id : false;
            //  var has_seen =  visited_poi ? pois[i]._radian.has_seen == : false;
            for (var j = 0; j < has_seen_poi.length; j++) {
                //console.log("for has seen");
                if (id == has_seen_poi[j]) {
                    has_seen = true;
                }
                else {
                    has_seen = false;
                }
            }
            if (is_active) {
                had_active = true;
            }
            var d = getDistance.calculate(lat1, lon1, lat2, lon2);
            var coords = getBearing.calculate(lat1, lon1, lat2, lon2);
            //neuer CODE 
            /* if (d <= 500 && d > 300) {
                 console.log("<500")
                 var x2 = Math.cos(coords[3]) * 162.5 + 162.5;
                 var y2 = Math.sin(coords[3]) * 162.5 + 162.5;
             }else if(d <= 300 && d >100){
                 console.log("<200")
                  var x2 = Math.cos(coords[3]) * 137.5 + 137.5;
                 var y2 = Math.sin(coords[3]) * 137.5 + 137.5;
             }else if(d <= 100){
                 console.log("<100")
                  var x2 = Math.cos(coords[3]) * 112.5 + 112.5;
                 var y2 = Math.sin(coords[3]) * 112.5 + 112.5;
             }*/
            //alter code  
            //  var x2 = Math.cos(coords[3]) * 157.5 + 157.5;
            //  var y2 = Math.sin(coords[3]) * 157.5 + 157.5;
            //
            // Welche Punkte werden angezeigt - die in einbem bestimmten radius sind 
            if (d < 500) {
                // results POIS - werden in var poi geschrieben
                // alle werte werden upgedatet
                var poi = results[i];
                poi._radian = {
                    angle: coords[3]
                    , properties: props
                    , x: coords[0]
                    , y: coords[1]
                    , id: id
                    , is_active: is_active, //true oder false
                    distance: d
                    , heading: heading
                    , has_seen: has_seen
                };
                // in pois werden die daten von Poi reingeschrieben 
                pois.push(poi);
                pois.sort(function (a, b) {
                    return b._radian.angle - a._radian.angle
                });
            }
        }
        if (!had_active) {
            active_poi = null;
            getActivePoi();
        }
    }
    //Überwachung der Position 
    function _event_watchPosition(pos) {
        $('#divGeoWait').hide();
        lat1 = pos.latitude;
        lon1 = pos.longitude;
        heading = pos.heading;
        accuracy = pos.accuracy;
        console.log("accuracy: " + accuracy);
        updatePOIS();
        redraw();
        bufferUser();
    }

    function singleVibration() {
        console.log("vibration");
        /* Vibrate for 2 seconds */
        navigator.vibrate(500);
    }
    // Puffer um den Nutzer bei Distanz von x Metern 
    function bufferUser() {
        for (var i = 0; i < pois.length; i++) {
            if (pois[i]._radian.distance <= 30) {
                if (pois[i]._radian.has_seen == false) {
                    singleVibration();
                    notificationManager.message(pois[i]);
                    has_seen_poi.push(pois[i]._radian.id);
                }
            }
        }
    }
    // rotation Clockwise und Counterclockwise - Aktiv setzen der POIs 
    function _event_rotaryEventHandler(e) {
        var index, len = pois.length
            , index_change = -1
            , activeP, currentIndex;
        if (e.detail.direction === "CCW") {
            index_change = 1;
        }
        activeP = getActivePoi();
        // wenn es noch keinen aktiven punkt gibt, dann soll der aktive auf den Wert im array gesetzt werden der die kleinste Distanz zum Nutzer hat
        // wenn es einen gibt dann nimm diesen
        currentObj = activeP != null ? activeP : pois[0];
        for (var i = 0; i < len; i++) {
            if (pois[i]._radian.id === currentObj._radian.id) {
                index = i; //0
                pois[index]._radian.is_active = false;
                break;
            }
        }
        for (var i = 0; i < len; i++) {
            if (i === index) {
                currentIndex = (index += pois.length + (index_change)) % pois.length;
                deg = pois[currentIndex]._radian.angle;
                pois[currentIndex]._radian.is_active = true;
                active_poi = pois[currentIndex];
                index = currentIndex;
                break;
            }
        }
        $('#image').finish();
        redrawPictures();
        redraw();
    }

    function getActivePoi() {
        console.log("Get active POI: " + active_poi);
        if (active_poi == null) {
            return active_poi;
        }
        else {
            for (var i = 0; i < pois.length; i++) {
                if (pois[i]._radian.id === active_poi._id) {
                    console.log("new pois: " + pois[i]._radian.id);
                    return pois[i];
                }
            }
        }
    }

    function redraw() {
        redrawArrow();
        redrawPOIS();
        redrawTextelements();
    }
    // TODO:
    // - funktionen redrawPictures und show Picture zusammenlegen: 
    // if(rotary Event){}
    // if (click){}
    function redrawPictures() {
        var activeImage = active_poi.properties.poi_img;
        $("#image").css("opacity", "0.6");
        $("#image").css("z-index", "2");
        $('#image').html("<img  id='imgPOI' src='img/" + activeImage + "' alt='image'>").fadeIn(1000).delay(2000).fadeOut(1000);
    }

    function showPicture() {
        var activeImage = active_poi.properties.poi_img;
        $("#image").css("opacity", "1");
        $("#image").css("z-index", "200");
        $('#image').html("<img  id='imgPOI' src='img/" + activeImage + "' alt='image'>").fadeIn(500).show();
    }

    function redrawArrow() {
      /*  var len = pois.length;
        for (var i = 0; i < len; i++) {
            var poi_rotation = 360 - pois[i]._radian.heading;
            direction.style.transform = 'rotate(' + poi_rotation + 'deg)';
        }
        //center.style.transform = 'rotate(' + poi_rotation + 'deg)';
        console.log("redraw Arrow");
        // var arrow_rotation = poi_rotation - deg;*/
    }

    function redrawTextelements() {
        var title = active_poi.properties.title;
        $('#title').html(title);
        for (var i = 0; i < pois.length; i++) {
            if (pois[i]._radian.is_active == true) {
                var distance = pois[i]._radian.distance;
                $('#distance').html(distance.toFixed(0) + " m");
            }
        }
        //var reUnit =  distance >= 1000 ? (reUnit = 'km', distance = distance/1000) : reUnit = 'm';
        //$('#distance').html(distance.toFixed(0) + " " + reUnit);
    };

    function redrawPOIS() {
        $('#center').empty();
        /*   $('#center2').empty();
           $('#center3').empty();*/
        var len = pois.length;
        for (var i = 0; i < len; i++) {
            var props = pois[i]._radian.properties;
            var color = (props.sights === true) ? "sights" : (props.culinary === true) ? "culinary" : "insidertip";
            // Wenn ich richtung Westen gehe (Heading = 270°) müssen die Punkte um (350°-270°) gedreht werden
            // heißt: poi_rotation = 360° - heading
            var poi_rotation = 360 - pois[i]._radian.heading;
            console.log("angle: " + pois[i]._radian.angle);
            console.log("distance: " + pois[i]._radian.distance);
            //alter CODE ohne dynamischer Distanz
            /// nur center.style.transform
            // nur $('#center').append zeichnen alle anderen nicht
            // keine if abfrage
            center.style.transform = 'rotate(' + poi_rotation + 'deg)';
            /*   center2.style.transform = 'rotate(' + poi_rotation + 'deg)';
               center3.style.transform = 'rotate(' + poi_rotation + 'deg)';*/
            $("#center").append("<div class='" + color + " " + (pois[i]._radian.is_active ? color + "active" : " ") + "' id=" + pois[i]._radian.id + " style='left:" + (pois[i]._radian.x - 11) + "px;top:" + (pois[i]._radian.y - 11) + "px'></div>");
            /* if (pois[i]._radian.distance <= 500 && pois[i]._radian.distance > 300) {
                 $("#center").append("<div class='" + color + " " + (pois[i]._radian.is_active ? color + "active" : " ") + "' id=" + pois[i]._radian.id + " style='left:" + (pois[i]._radian.x - 11) + "px;top:" + (pois[i]._radian.y - 11) + "px'></div>")
             }
             else if (pois[i]._radian.distance <= 300 && pois[i]._radian.distance > 100) {
                 $("#center2").append("<div class='" + color + " " + (pois[i]._radian.is_active ? color + "active" : " ") + "' id=" + pois[i]._radian.id + " style='left:" + (pois[i]._radian.x - 11) + "px;top:" + (pois[i]._radian.y - 11) + "px'></div>")
             }
             else if (pois[i]._radian.distance <= 100) {
                 $("#center3").append("<div class='" + color + " " + (pois[i]._radian.is_active ? color + "active" : " ") + "' id=" + pois[i]._radian.id + " style='left:" + (pois[i]._radian.x - 11) + "px;top:" + (pois[i]._radian.y - 11) + "px'></div>")
             }*/
        }
    }
    // Public API
    return {
        init: init
        , picture: function () {
            return showPicture();
        }
        , rotary: _event_rotaryEventHandler
    }
})();