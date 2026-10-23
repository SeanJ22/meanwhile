
var locationMarkers = [];

var markerNormal = L.divIcon({ className: 'fa fa-location-dot fa-xl red', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var markerCheck = L.divIcon({ className: 'fa fa-location-dot fa-xl green', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var markerBang = L.divIcon({ className: 'fa fa-location-dot fa-xl yellow', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var markerPlusRed = L.divIcon({ className: 'fa fa-location-dot fa-xl pin-red', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var markerPlusGreen = L.divIcon({ className: 'fa fa-location-dot fa-xl pin-green', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var markerMinus = L.divIcon({ className: 'fa fa-location-dot fa-xl red', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var markerTimes = L.divIcon({ className: 'fa fa-location-dot fa-xl red', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var markerSlash = L.divIcon({ className: 'fa fa-map-marker-slash fa-bell-slash fa-xl red-slash', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var starMarker = L.divIcon({ className: 'fa fa-star fa-xl you-are-here' });

//var markerCarNormal = L.divIcon({ className: 'fa fa-car orange-car', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var markerCarNormal = L.divIcon({
    html: '<i class="fa fa-car orange-car" data-fa-transform="shrink-10 up-.5" data-fa-mask="fas fa-plus"></i>'
    , iconAnchor: [9, 24], popupAnchor: [0, -24]
});
var markerCarGreen = L.divIcon({ className: 'fa fa-car green-car', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var markerCarYellow = L.divIcon({ className: 'fa fa-car yellow-car', iconAnchor: [9, 24], popupAnchor: [0, -24] });
var markerCarRed = L.divIcon({ className: 'fa fa-car red-car', iconAnchor: [9, 24], popupAnchor: [0, -24] });

var markerMailNormal = L.divIcon({ className: 'fa fa-envelope orange-mail', iconAnchor: [9, 24], popupAnchor: [0, -24] });

var map = L.map('div-map', { wheelPxPerZoomLevel: 120, minZoom: 7 }).setView([29.760777, -95.357344], 10);
map.zoomControl.setPosition('bottomright');


L.esri.featureLayer({
    url: 'https://services.arcgis.com/su8ic9KbA7PYVxPS/arcgis/rest/services/HC_Boundary/FeatureServer/0',
    style: { fill: false, color: "#00006666" }
}).addTo(map);

L.esri.Vector.vectorBasemapLayer("ArcGIS:LightGray", {
    apikey: esriMapApiKey
}).addTo(map);

function CreateMarkers(locations) {
    L.Popup.include({
        _hvIndex: 0,
        _hvLatitude: 0,
        _hvLongitude: 0,
        _hvPollCode: '',

        SetHVProperties: function (index, latitude, longitude, pollCode) {
            this._hvIndex = index;
            this._hvLatitude = latitude;
            this._hvLongitude = longitude;
            this._hvPollCode = pollCode;
        },

        GetIndex: function () { return this._hvIndex; },
        GetLatitude: function () { return this._hvLatitude; },
        GetLongitude: function () { return this._hvLongitude; },
        GetPollCode: function () { return this._hvPollCode; }

    });

    locations.forEach(function (location) {
        var marker = null;
        if (location.PollingLocationId == 0) {
            map.setView([location.Latitude, location.Longitude], map.getZoom());
            locationMarker = starMarker;

            marker = L.marker([location.Latitude, location.Longitude], { icon: locationMarker, zIndexOffset: 1000 });
            marker.bindPopup(location.PopupContent);
            locationMarkers.push(marker);
        }
        else {
            if (location.IsDropoff && location.PollCode.startsWith("BD")) {
                locationMarker = markerMailNormal;
            }
            else if (location.Notes && location.IsActive == 0) {
                locationMarker = markerSlash;
            }
            else if (location.QueueLength == 3) {
                locationMarker = markerMinus;
                if (location.IsDriveThru) {
                    locationMarker = markerCarRed;
                }
            }
            else if (location.QueueLength == 2) {
                locationMarker = markerBang;
                if (location.IsDriveThru) {
                    locationMarker = markerCarYellow;
                }
            }
            else {
                locationMarker = markerCheck;
                if (location.IsDriveThru) {
                    locationMarker = markerCarGreen;
                }
            }

            if (location.AddressLine1 != null) {
                marker = L.marker([location.Latitude, location.Longitude], { icon: locationMarker });
                var popupOptions = {
                    _hvIndex: locationMarkers.length,
                    _hvLatitude: location.Latitude,
                    _hvLongitude: location.Longitude,
                    _hvPollCode: location.PollCode
                };

                marker.bindPopup(location.PopupContent);
                var popup = marker.getPopup();
                popup.SetHVProperties(locationMarkers.length, location.Latitude, location.Longitude, location.PollCode);
            }

            marker.on('popupopen', test);
            locationMarkers.push(marker);
        }
    });
    if (locationMarkers.length > 1) {
        var group = L.featureGroup(locationMarkers).addTo(map);
        map.fitBounds(group.getBounds());
    }
}

function test(e) {
    //GetNearByLocations(e.popup.GetIndex(), e.popup.GetLatitude(), e.popup.GetLongitude(), e.popup.GetPollCode());
}
function ClearMarkers() {
    locationMarkers.forEach(function (marker) {
        map.removeLayer(marker);
    });

    locationMarkers = [];
}

function ResetMarkers() {
    markerNormal = L.divIcon({ className: 'fa fa-location-dot fa-xl red', iconAnchor: [9, 24], popupAnchor: [0, -24] });
    markerCheck = L.divIcon({ className: 'fa fa-location-dot fa-xl green', iconAnchor: [9, 24], popupAnchor: [0, -24] });
    markerBang = L.divIcon({ className: 'fa fa-location-dot fa-xl yellow', iconAnchor: [9, 24], popupAnchor: [0, -24] });
    markerPlusRed = L.divIcon({ className: 'fa fa-location-dot fa-xl pin-red', iconAnchor: [9, 24], popupAnchor: [0, -24] });
    markerPlusGreen = L.divIcon({ className: 'fa fa-location-dot fa-xl pin-green', iconAnchor: [9, 24], popupAnchor: [0, -24] });
    markerMinus = L.divIcon({ className: 'fa fa-location-dot fa-xl red', iconAnchor: [9, 24], popupAnchor: [0, -24] });
    markerSlash = L.divIcon({ className: 'fa fa-map-marker-slash fa-bell-slash fa-xl red-slash', iconAnchor: [9, 24], popupAnchor: [0, -24] });
    starMarker = L.divIcon({ className: 'fa fa-star fa-xl you-are-here' });
    markerCarNormal = L.divIcon({ className: 'fa fa-car orange-car', iconAnchor: [9, 24], popupAnchor: [0, -24] });
    markerCarGreen = L.divIcon({ className: 'fa fa-car green-car', iconAnchor: [9, 24], popupAnchor: [0, -24] });
    markerCarYellow = L.divIcon({ className: 'fa fa-car yellow-car', iconAnchor: [9, 24], popupAnchor: [0, -24] });
    markerCarRed = L.divIcon({ className: 'fa fa-car red-car', iconAnchor: [9, 24], popupAnchor: [0, -24] });

}

function SetLanguage(evt, lang) {
    evt.preventDefault();

    let rurl = new URL(window.location.href);

    if (rurl.searchParams.has("lang"))
        rurl.searchParams.delete("lang");

    rurl.searchParams.append("lang", lang);

    window.location = rurl.href;

}