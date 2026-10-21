(function ($) {

    /* _Member Variables */

    var _homeaddr = {};
    var _pollsite = {};
    var _elections = {};
    var _parties = {};

    var _daysOfTheWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    var _alpha3LangCodes = {
        en: "eng",
        es: "spa",
        zh: "zho",
        tw: "zho",
        ko: "kor",
        bn: "ben"
    };

    var _settings = {
        markerColor: "#f62b2b",
        languageShortCode: "en"
    };

    var _errors = {
        StreetNotRecognized: "This street name is not recognized",
        HouseNumberError: "This building number is not recognized",
        StreetNoAddressError: "This street has no addresses",
        HouseNumberRangeError: "This building number is out of range",
        NoPollSiteFoundError: "No Poll Site found for this address",
        UnrecognizedAddress: "This is an unrecognized address. Please make sure your address is accurate and try again.",
        AddressSplitError: "This address has more than one Election District associated with it.  Please provide a building number suffix (a, b, c, etc.).",
        GeoServerOffline: "The geocoding server is unavailable at this time.  Please try again later."
    };

    var _settingsPollTime = 60 * 1000;

    var _init = true;

    var _contestOnlyCDAltId = "";
    var _controllingDistrictAltId = "";

    //var _controlURL = "https://localhost/NYCFindYourPollsite/nyc_psl_controls.json"
    //var _controlURL = "https://www.vote.nyc/sites/default/files/psl/nyc_psl_controls.json";

    var _controlURL = "api/nycsettings";

    var _nycControlSettings = {};

    var _fallbackNYC_Settings = {
        checkBackOn: true,
        checkBackMessage: "Please check back later.",
        helpfulMessageOn: false,
        helpfulMessage: "",
        noBallotMessageOn: true,
        noBallotMessage: "",
        counties: [
            {
                name: "New York",
                controllingDistrictId: 4,
                controllingDistrictAltId: "10",
                sortKey: 1,
                settings: {
                    showEDSites: true,
                    showEDSchedule: true,
                    showEVSites: true,
                    showEVSchedule: true,
                    showContestList: true,
                    showSampleBallots: true,
                    checkBackOn: false,
                    checkBackMessage: "",
                    helpfulMessageOn: false,
                    helpfulMessage: "",
                    noBallotMessageOn: true,
                    noBallotMessage: "You have no ballot"
                }
            },
            {
                name: "Bronx",
                controllingDistrictId: 3,
                controllingDistrictAltId: "11",
                sortKey: 2,
                settings: {
                    showEDSites: true,
                    showEDSchedule: true,
                    showEVSites: true,
                    showEVSchedule: true,
                    showContestList: true,
                    showSampleBallots: true,
                    checkBackOn: false,
                    checkBackMessage: "",
                    helpfulMessageOn: false,
                    helpfulMessage: "",
                    noBallotMessageOn: false,
                    noBallotMessage: ""
                }
            },
            {
                name: "Kings",
                controllingDistrictId: 2,
                controllingDistrictAltId: "12",
                sortKey: 3,
                settings: {
                    showEDSites: true,
                    showEDSchedule: true,
                    showEVSites: true,
                    showEVSchedule: true,
                    showContestList: true,
                    showSampleBallots: true,
                    checkBackOn: false,
                    checkBackMessage: "",
                    helpfulMessageOn: false,
                    helpfulMessage: "",
                    noBallotMessageOn: false,
                    noBallotMessage: ""
                }
            },
            {
                name: "Queens",
                controllingDistrictId: 11,
                controllingDistrictAltId: "13",
                sortKey: 4,
                settings: {
                    showEDSites: true,
                    showEDSchedule: true,
                    showEVSites: true,
                    showEVSchedule: true,
                    showContestList: true,
                    showSampleBallots: true,
                    checkBackOn: false,
                    checkBackMessage: "",
                    helpfulMessageOn: false,
                    helpfulMessage: "",
                    noBallotMessageOn: false,
                    noBallotMessage: ""
                }
            },
            {
                name: "Richmond",
                controllingDistrictId: 5,
                controllingDistrictAltId: "14",
                sortKey: 5,
                settings: {
                    showEDSites: true,
                    showEDSchedule: true,
                    showEVSites: true,
                    showEVSchedule: true,
                    showContestList: true,
                    showSampleBallots: true,
                    checkBackOn: false,
                    checkBackMessage: "",
                    helpfulMessageOn: false,
                    helpfulMessage: "",
                    noBallotMessageOn: true,
                    noBallotMessage: "no ballot"
                }
            }
        ]
    };

    /* Events */

    // This function runs every time there's a transition event,
    // which in your case occurs when a section's height or opacity changes.
    $('section').on('transitionend', function () {
        var $this = $(this);  // Cache the current section (the one that just transitioned)

        // Get the computed styles for the section
        var style = window.getComputedStyle(this);
        var opacity = parseFloat(style.opacity);
        var height = parseFloat(style.height);

        // Check if the section is visible (i.e., has an opacity greater than 0 and a height greater than 0).
        // If it is, remove the aria-hidden attribute; if not, set aria-hidden to true.
        if (opacity > 0 && height > 0) {
            $this.attr('aria-hidden', 'false');
        } else {
            $this.attr('aria-hidden', 'true');
        }
    });


    $(".form").keypress(function (e) {
        if (event.which == 13) {
            $(".button.primary", this).click();
        }
    });

    $("#translate-button").click(function (e) {
        e.preventDefault();
        e.stopPropagation();
        $("#translate-menu").toggleClass("show");
    });

    $("#btnSearch").click(function () {
        var btn$ = $(this);

        var hasErrors = false;

        $("#search-box .form-group")
            .removeClass("empty")
            .find("span.empty-error").text("");

        $("#search-box .form-group.required").each(function () {
            if ($(this).is(":visible")) {
                if (!$(this).find("input").val()) {
                    hasErrors = true;
                    var label = $(this).find("label").text();
                    $(this).find("span.empty-error").text(label + " is required");
                    $(this).addClass("empty");
                }
            }
        });

        if (btn$.hasClass("disabled")) return;

        if (hasErrors) $("#search-box .form-group.empty input").first().focus();
        else searchGeo();
    });

    $("main")
        .on("click", "#btnSearchAgain", function () {
            clear();
            viewstate("search");
            _controllingDistrictAltId = "";
            $("#txtHouseNumber").focus();
        });

    $(document).click(function (e) {
        $(".pop-menu").removeClass("show");
    });

    $(".weglot-link").click(function (e) {
        e.preventDefault();
        e.stopPropagation();

        Weglot.switchTo($(this).data("shortcode"));
        $("#translate-menu").removeClass("show");
    });

    Weglot.on("languageChanged", function () {
        var elId = $("#ddlElections").val();
        if (!!elId) buildContestList(_elections[elId]);
    });

    $("#translate-menu").click(function (e) {
        e.preventDefault();
        e.stopPropagation();
    });

    $("#btnShowContests").click(function () {
        viewstate("contests");
    });

    $("#btnShowPollSite").click(function () {
        viewstate("result");
    });

    $("#ddlElections").change(function () {
        var elId = $(this).val();
        var dkey = _pollsite.districtKey;

        var el = _elections[elId];

        $("main, #contests-info").toggleClass("is-primary", !!el.IsPrimary);

        if (el.IsPrimary==true && el.BallotStatus.toLowerCase() != "has_ballot") {
            viewstate("no-ballot");
            //return;
        }

        bindSchedules(el);
        buildContestList(el);
    });

    $("#ddlParties").change(function () {
        var party = _parties[$(this).val()];
        var sample$ = $("#sample-ballots table");

        sample$.find("tbody").empty();

        if (!!party) {
            $.each(party.ballotStyles, function (i, bs) {
                sample$.find("tbody")
                    .append($("<tr>")
                        .addClass("sample-ballot-row")
                        .append($("<td>")
                            .addClass("options")
                            .append($("<a>")
                                .attr({
                                    role: "button",
                                    target: "_blank",
                                    href: bs.sample_ballot_url
                                })
                                .addClass("ballot-option button primary")
                                .append($("<span>")
                                    .addClass("button-icon icon-search")
                                )
                                .append($("<span>")
                                    .attr("aria-hidden", "true")
                                    .addClass("option-label")
                                    .text("View Sample Ballot")
                                )
                                .append($("<span>", { class: "visually-hidden", text: "Download Sample Ballot PDF" }))
                                .append($("<span>")
                                    .addClass("ballot-style")
                                    .text("(" + bs.voter_label + ")")
                                )
                            )
                            .append($("<a>")
                                .attr({
                                    role: "button",
                                    href: "mailto:?Subject=Sample Ballot for: " + _homeaddr.freetext + "&Body=View Sample Ballot: " + " " + bs.sample_ballot_url,
                                    target: "_blank"
                                })
                                .addClass("ballot-option button contrast")
                                .text("Email Sample Ballot")
                                .prepend($("<span>")
                                    .addClass("button-icon icon-mail")
                                )
                                .append($("<span>")
                                    .addClass("ballot-style")
                                    .text("(" + bs.voter_label + ")")
                                )
                            )
                        )
                    );
            });

            var hasStyles = (!!party.ballotStyles && party.ballotStyles.length > 1);

            sample$.toggleClass("has-multiple-styles", hasStyles);

            $("#sample-ballots p:first").toggle(hasStyles);

            $("main").removeClass("show-no-party-ballot");

            //clear the ballot...            
            $("#ballot").empty();


            if (!party.contests || party.contests.length == 0 || (party.contests.length == 1 && party.contests[0].candidacies.length == 0)) {
                $("main").addClass("show-no-party-ballot");

            //    $("#ballot").append($("<h1>", {
            //        text: ($("main").hasClass("setting-no-ballot-msg-show") !! ? _nycControlSettings.noBallotMessage : "No Contests") }));
            }
            else {
                $.each(party.contests, function () {
                    var contest = this;
                    var cont$ = addContestBlock(contest, party.altId).appendTo("#ballot");

                    $.each(contest.candidacies, function () {
                        var can = this;
                        var cand$ = addChoiceRow(can).appendTo(cont$.find(".choices"))
                    });

                    $("#contest-list").append($("<a>").text(this.contest_description));
                });
            }
        }
    });

    /* Main entry point */

    $(document).ready(function () {

        _nycControlSettings = _fallbackNYC_Settings;
        $("#loading-cover").addClass("show");

        loadNYC_Settings();
        window.setInterval(loadNYC_Settings, _settingsPollTime);

    });

    function checkQS() {
        if (!!$.qs("altelectionid") && !!$.qs("districtkey")) {
            viewstate("contests-only");

            buildContestList(null, {
                altElectionId: $.qs("altelectionid"),
                districtKey: $.qs("districtkey"),
                contestsOnly: true
            });
        }

        if (!!$.qs("hn")
            ||
            !!$.qs("sn")
            ||
            !!$.qs["zip"]) {

            $("#txtHouseNumber")
                .val($.qs("hn"));
            $("#txtStreetName")
                .val($.qs("sn"));
            $("#txtZipcode")
                .val($.qs("zip"));


            if (!!$("#txtStreetName").val()
                && !!$("#txtZipcode").val()
                && !!$("#txtHouseNumber").val()
            )
                $("#btnSearch").click();
        }

        $("#txtHouseNumber").focus();

        if (!!$("#txtStreetName").val()
            && !!$("#txtZipcode").val()
            && !!$("#txtHouseNumber").val()
        )
            $("#btnSearch").click();
    };

    /* NYC Control Settings */
    
    function loadNYC_Settings() {
        url = _controlURL + "?ts=" + (new Date()).getTime().toString();

        $.getJSON(
            url,
            function (d) {
                if (!!d) {
                    _nycControlSettings = $.extend(true, _fallbackNYC_Settings, d.settings);
                }
            }
        ).always(function () {
            $("#loading-cover").removeClass("show");
            applySettings();
        });
    };

    function applySettings() {

        var cs = null;

        var cdAltId = (_contestOnlyCDAltId || _controllingDistrictAltId);

        if (!!cdAltId) { //check county specific settings

            $.each(_nycControlSettings.counties, function (i, c) {
                if (c.controllingDistrictAltId == cdAltId) {
                    cs = c.settings;
                    return false;
                }
            });

            if (!cs) {
                alert("county settings not found");
            }
        }

        $(".site-notice")
            .find("p:first")
            .html((!!cs) ? (cs.helpfulMessage || _nycControlSettings.helpfulMessage)  : _nycControlSettings.helpfulMessage)
            .end()
            .toggle((!!cs) ? cs.helpfulMessageOn : _nycControlSettings.helpfulMessageOn);

        $(".no-ballot-msg")
            .text((!!cs) ? (cs.noBallotMessage || _nycControlSettings.noBallotMessage) : _nycControlSettings.noBallotMessage)
            .end()
            .toggle((!!cs) ? cs.noBallotMessageOn : _nycControlSettings.noBallotMessageOn);

        $("#no-ballot-message p").text((!!cs) ? (cs.noBallotMessage || _nycControlSettings.noBallotMessage) : _nycControlSettings.noBallotMessage);

        var cbP$ = $("#message-box")
            .find("p:first");

        if (_nycControlSettings.checkBackOn == true || (!!cs && cs.checkBackOn == true)) {

            if (_nycControlSettings.checkBackMessage != cbP$.text() || (!!cs && cs.checkBackMessage != cbP$.text())) {
                cbP$
                    .text((!!cs) ? cs.checkBackMessage : _nycControlSettings.checkBackMessage);
            }

            viewstate("checkback");
        }
        else {
            if (viewstate() == "checkback" || _init==true) {
                viewstate("search");
                checkQS();
            }
        }

        _init = false;

        if (!!cs) {
            $("main").toggleClass("setting-ed-sites-show", cs.showEDSites);
            $("main").toggleClass("setting-ev-sites-show", cs.showEVSites);
            $("main").toggleClass("setting-ed-schedule-show", cs.showEDSchedule);
            $("main").toggleClass("setting-ev-schedule-show", cs.showEVSchedule);
            $("main").toggleClass("setting-contest-list-show", cs.showContestList);
            $("main").toggleClass("setting-sample-ballots-show", cs.showSampleBallots);
            $("main").toggleClass("setting-no-ballot-msg-show", cs.noBallotMessageOn);
        }
    };

    /* View State */

    function viewstate(state) {
        if (!state) return $("main").data("state");
        $("main")
            .removeClass("show-checkback show-search show-result show-contests show-no-election-result show-contests-only show-no-ballot")
            .addClass("show-" + state)
            .data("state", state);
    }

    /* Search Functions */

    function setSearchError(err) {
        $("#search-error").text(err || "").toggleClass("show", !!err);
    }

    function showRangeInput(streetnum, street, zip, lat, lng, districtkey) {
        setSearchError(_errors.AddressSplitError);

        $("main").addClass("show-range");
        $("#txtRange").focus();
    }

    function makeAddrIntoGeoPT(addr) {
        var pt = {
            latitude: addr.latitude,
            longitude: addr.longitude,
            county: addr.county,
            streetnumber: addr.streetNumber,
            streetname: addr.route,
            postalcode: addr.postalCode,
            districtkey: addr.districtkey
        };

        return pt;
    }

    /* Search street address from Geo Server */

    function searchGeo() {
        $("#btnSearch").addClass("disabled");

        var housenum$ = $("#txtHouseNumber");
        var street$ = $("#txtStreetName");
        var zip$ = $("#txtZipcode");
        var range$ = $("#txtRange");

        var streetNum = housenum$.val() + ($("main").hasClass("show-range") ? range$.val() : "");

        $("main").removeClass("show-suggestions");

        var suggestions$ = $("#street-suggestions");

        suggestions$
            .attr("aria-hidden", true)
            .find(".street-suggestion").remove();

        setSearchError();

        $("main").attr("aria-busy", true);

        $("#loading-cover").addClass("show");

        $.ajax({
            url: $.uri({
                url: $("#hdnGeoServer").val() + "/addresses",
                options: {
                    streetnumber: encodeURIComponent(streetNum),
                    streetname: encodeURIComponent(street$.val()),
                    postalcode: encodeURIComponent(zip$.val())
                }
            }),
            dataType: "jsonp",
            success: function (d) {
                if (!!d
                    &&
                    !!d.searchStatus
                    &&
                    d.searchStatus.validAddress) {

                    if (!range$.val()) $("main").removeClass("show-range");

                    var addr = {
                        freetext: d.standardizedAddress.streetNumber + ' ' +
                            d.standardizedAddress.streetName + ', ' +
                            d.standardizedAddress.city + ', ' +
                            d.standardizedAddress.stateProvTerr + ' ' +
                            d.standardizedAddress.postalCode,
                        //+ ', ' +
                        //d.standardizedAddress.country,
                        address1: d.standardizedAddress.streetNumber + ' ' +
                            d.standardizedAddress.streetName,
                        address2: "",
                        streetNumber: d.standardizedAddress.streetNumber,
                        route: d.standardizedAddress.streetName,
                        subPremise: "",
                        city: d.standardizedAddress.city,
                        stateProvTerr: d.standardizedAddress.stateProvTerr,
                        postalCode: d.standardizedAddress.postalCode,
                        county: d.countyName,
                        country: d.standardizedAddress.country,
                        latitude: d.latitude,
                        longitude: d.longitude,
                        districtkey: d.politicalLayer.electionDistrict + "/" + d.politicalLayer.assemblyDistrict,
                        complete: true
                    };

                    _homeaddr = addr;

                    var geopt = makeAddrIntoGeoPT(addr);
                    getPollsiteInfo(geopt);
                }
                else {
                    $("main").attr("aria-busy", false);
                    $("#loading-cover").removeClass("show");

                    if (!!d) {
                        if (!!d.searchStatus) {
                            switch (d.searchStatus.returnCode) {
                                case "11":
                                case "50":
                                case "EE":
                                    setSearchError(_errors.StreetNotRecognized);
                                    street$.focus();
                                    break;

                                case "13":
                                    setSearchError(_errors.HouseNumberError);
                                    housenum$.focus();
                                    break;

                                case "41":
                                    setSearchError(_errors.StreetNoAddressError);
                                    street$.focus();
                                    break;

                                case "42":
                                    setSearchError(_errors.HouseNumberRangeError);
                                    housenum$.focus();
                                    break;

                                case "56":
                                    //DCP Error: ADDRESS IS SPLIT AMONG MULTIPLE ELECTION DISTRICTS. ADDRESS NBR SUFFIX REQUIRED
                                    showRangeInput(housenum$.val(), street$.val(), zip$.val(), -1, -1);
                                    break;

                                case "71":
                                    setSearchError(_errors.NoPollSiteFoundError);
                                    break;

                                default:
                                    setSearchError(_errors.UnrecognizedAddress);
                                    housenum$.focus();
                                    break;
                            }

                            if (!!d.searchStatus.streetSuggestions && d.searchStatus.streetSuggestions.length > 0) {
                                hideResults = true;

                                $("main").addClass("show-suggestions");

                                $.each(d.searchStatus.streetSuggestions, function (i, ss) {
                                    suggestions$
                                        .attr("aria-hidden", false)
                                        .append($("<li>")
                                            .addClass("street-suggestion")
                                            .append($("<a>")
                                                .attr("href", "javascript:void(0);")
                                                .text(ss)
                                                .click(function () {
                                                    $("#txtStreetName").val($(this).text());

                                                    searchGeo();
                                                })
                                            )
                                        );
                                });
                            }
                        }//d.searchStatus
                        else {
                            //setSearchError(d.ErrorMessage);
                            setSearchError(_errors.GeoServerOffline);
                        }
                    }//d

                }
            },
            error: function (xhr, status, msg) {
                $("main").attr("aria-busy", false);
                $("#loading-cover").removeClass("show");
                alert("There was a communication error contacting the geo server (" + $("#hdnGeoServer").val() + "). Please try again later.");
            },
            complete: function () {
                $("#btnSearch").removeClass("disabled");
            }
        });
    }

    /* Load up the Pollsite based on the ED/AD info from estreet */

    function getPollsiteInfo(geopt) {

        $("main").attr("aria-busy", true);
        $("#loading-cover").addClass("show");

        $.ajax({
            url: $.uri({
                url: "api/pollsiteinfo",
                options: {
                    latitude: geopt.latitude,
                    longitude: geopt.longitude,
                    county: geopt.county,
                    streetnumber: geopt.streetnumber,
                    streetname: geopt.streetname,
                    postalcode: geopt.postalcode,
                    districtkey: geopt.districtkey
                }
            }),
            success: function (d) {
                if (!!d) {
                    _pollsite = d;
                    $("#search-term").text(!!_homeaddr ? _homeaddr.freetext : "");
                    _controllingDistrictAltId = d.altControllingDistrictId;
                    applySettings();
                    showSiteDetail(d);
                }
                else {
                    setSearchError(_errors.NoPollSiteFoundError);
                }
            },
            error: function (xhr, status, msg) {
                if (!!xhr && !!xhr.responseJSON && !!xhr.responseJSON.ModelState) {
                    setSearchError(xhr.responseJSON.ModelState.Message);
                }
                else
                    setSearchError(_errors.NoPollSiteFoundError);

            },
            complete: function () {
                
                $("#loading-cover").removeClass("show");
                $("main").attr("aria-busy", false);
                
                $("#search-term-container").focus();
            }
        });
    }

    function showSiteDetail(info) {

        var bind = function (prop, prefix) {
            var val = info[prop];
            $("#" + (prefix || "") + prop).text(val);

            return !!val;
        };

        $("main").removeClass("has-ed-site has-ev-site");

        var state = "result";

        if (!!info.elections) bindElections(info.elections);
        else state = "no-election-result";

        if (!!info.site_name) {
            $("main").addClass("has-ed-site");

            bind("site_name");
            bind("site_address");
            $("#eday-details .voter-entrance").toggleClass("show", bind("voter_entrance"));
            $("#eday-details .handicap-entrance").toggleClass("show", bind("handicap_entrance"));
            $("#eday-details .room").toggleClass("show", bind("polling_room"));
        }

        if (!!info.ev_site_name) {
            $("main").addClass("has-ev-site");

            bind("ev_site_name");
            bind("ev_site_address");

            $("#ev-details .voter-entrance").toggleClass("show", bind("ev_voter_entrance"));
            $("#ev-details .handicap-entrance").toggleClass("show", bind("ev_handicap_entrance"));
            $("#ev-details .room").toggleClass("show", bind("ev_polling_room"));
        }

        if ((viewstate() != "no-ballot" || $("main").hasClass("setting-no-ballot-msg-show") == false) && viewstate() != "checkback")
            viewstate(state);

        bindMap($("#eday-site"), {
            marker: info.marker,
            mapURI: info.mapURI
        });

        bindMap($("#ev-site"), {
            marker: info.ev_marker,
            mapURI: info.ev_mapURI
        });

        bindDistrictList(info);
    }

    function bindDistrictList(info) {
        var tbl$ = $("#district-info table");

        var bind = function (prop) {
            var val = info[prop];
            $("#" + prop).text(val);

            $(".dr_" + prop).toggleClass("show", !!val);

            return !!val;
        };


        bind("election_district");
        bind("split");
        bind("judicial_district");
        bind("congress_district");
        bind("senate_district");
        bind("council_district");
        bind("county_council_district");
        bind("municipal_court_district");
        bind("assembly_district");
        bind("school_district");
        bind("magistrate_jury_area");
        bind("municipality");
        bind("jury_pool");
    }

    function bindElections(elections) {
        $("#ddlElections").empty();

        _elections = {};

        if (!!elections) {
            $.each(elections, function () {
                _elections[this.ID] = this;

                $("#ddlElections").append($("<option>")
                    .text(this.Description)
                    .val(this.ID)
                );
            });

            $("#ddlElections").trigger("change");
        }
    }

    var NO_TIME_YET = "to be determined";

    function bindSchedules(election) {
        $("main").removeClass("has-ed-schedule has-ev-schedule");

        var evtable$ = $("#ev-schedule table");
        var edaytable$ = $("#eday-schedule table");

        var evcal$ = $("#ev-schedule .cal-schedule").empty();
        var edaycal$ = $("#eday-schedule .cal-schedule").empty();


        evtable$.find("tbody").empty();
        edaytable$.find("tbody").empty();

        var evFrom = "";
        var evTo = "";
        var edayDt = "";
        var edayTime = "";

        if (!!election && !!election.votingdays) {
            $.each(election.votingdays, function () {
                if (this.milestoneCategory.toLowerCase() == "early voting") {
                    var evRow$ = addScheduleRow(true, election, this);
                    evtable$.find("tbody").append(evRow$);
                    evcal$.append(addScheduleItem(true, election, this));

                    if (evFrom == "") evFrom = evRow$.find(".item-date").text();
                    evTo = evRow$.find(".item-date").text();

                    $("main").addClass("has-ev-schedule");
                }
                else {
                    var edayRow$ = addScheduleRow(false, election, this);
                    edaytable$.find("tbody").append(edayRow$);
                    edaycal$.append(addScheduleItem(true, election, this));

                    edayDt = edayRow$.find(".item-date").text(); 
                    edayTime = edayRow$.find(".item-time").text();

                    $("main").addClass("has-ed-schedule")
                }
            });

            $("#ev-site").toggleClass("has-schedule", (!!evFrom && !!evTo));
            $("#ev-from").text(evFrom);
            $("#ev-to").text(evTo);

            $("#eday-site").toggleClass("has-schedule", !!edayDt);

            $("#eday-dt").text(edayDt);
            $("#eday-time")
                .text(edayTime)
                .toggleClass("tbd-time", edayTime.toLowerCase() == NO_TIME_YET);

        }

    }

    function addScheduleRow(isEarly, election, vday) {
        var dt = new Date(vday.votingDT.year, vday.votingDT.month - 1, vday.votingDT.day);
        var hours = ((vday.votingHoursFrom.toLowerCase() == NO_TIME_YET) ? vday.votingHoursFrom
            : vday.votingHoursFrom + " - " + vday.votingHoursTo
        );

        var timeCls = "item-time";

        if (vday.votingHoursFrom.toLowerCase() == NO_TIME_YET)
            timeCls += " tbd-time";

        var row$ = $("<tr>")
            .append($("<td>").addClass("day-of-week").text(_daysOfTheWeek[dt.getDay()]))
            .append($("<td>").addClass("item-date date-display").text(dt.format("mmmm d, yyyy")))
            .append($("<td>").addClass(timeCls).text(hours));
            //.append($("<td>").append(addCalendarButton(isEarly, election, vday, dt)));

        return row$;
    }

    function addScheduleItem(isEarly, election, vday) {
        var dt = new Date(vday.votingDT.year, vday.votingDT.month - 1, vday.votingDT.day);
        var hours = ((vday.votingHoursFrom.toLowerCase() == NO_TIME_YET) ? vday.votingHoursFrom
            : vday.votingHoursFrom + " - " + vday.votingHoursTo
        );

        var timeCls = "item-time";

        if (vday.votingHoursFrom.toLowerCase() == NO_TIME_YET)
            timeCls += " tbd-time";

        var item$ = $("<li>")
            .append($("<h1>").addClass("item-date").text(dt.format("dddd, mmmm d, yyyy")))
            .append($("<h2>").addClass(timeCls).text(hours).prepend($("<strong>").text("Hours: ")));
            //.append(addCalendarButton(isEarly, election, vday, dt));

        return item$;
    }

    function addCalendarButton(isEarly, election, vday, dt) {

        var title = election.ElectionNameNoDate + " " + dt.format("yyyy") + (isEarly ? " - " + vday.name : "");
        //TODO 20230630 Remove the site(s) below and just provide a link to the locator
        var description = title + "\n" +
            "========================================\n\n" +
            (isEarly ? "Early Voting Site: " + _pollsite.ev_site_name + "\n" + _pollsite.ev_site_address :
                "Election Day Site: " + _pollsite.site_name + "\n" + _pollsite.site_address);


        var sp = function (name, val) {
            return $("<span>").addClass(name).text(val);
        }

        var btn$ = $("<a>")
            .attr({
                title: "Add to Calendar",
                href: "javascript:void(0);"
            })
            .addClass("cal-button button")
            .text("Add to Calendar")
            .prepend(sp("button-icon icon-calendar", ""))
            .append($("<ul>")
                .addClass("cal-picker pop-menu")
                .append(addCalendarOption("ical", {
                    label: "Apple iCal",
                    icon: "icon-apple"
                }))
                .append(addCalendarOption("google", {
                    label: "Google Calendar",
                    icon: "icon-google1"
                }))
                .append(addCalendarOption("outlook", {
                    label: "Microsoft Outlook",
                    icon: "icon-microsoftoutlook"
                }))
                .append(addCalendarOption("yahoo", {
                    label: "Yahoo! Mail",
                    icon: "icon-yahoo"
                }))
            )
            .click(function (e) {
                e.stopPropagation();

                //generate calendar popup
                $(".cal-picker").removeClass("show");
                $(this).find(".cal-picker").addClass("show");
            });

        //var sHr = (!!vday.votingHoursFrom ? vday.votingHoursFrom.substr(0, vday.votingHoursFrom.length - 2) + " " + vday.votingHoursFrom.substr(vday.votingHoursFrom.length - 2) : "12:00 AM");
        //var eHr = (!!vday.votingHoursTo ? vday.votingHoursTo.substr(0, vday.votingHoursTo.length - 2) + " " + vday.votingHoursTo.substr(vday.votingHoursTo.length - 2) : "11:59 PM");

        var sHr = (
            (!!vday.votingHoursFrom && vday.votingHoursFrom.toLowerCase() != NO_TIME_YET) ? vday.votingHoursFrom.substr(0, vday.votingHoursFrom.length - 2) + " " + vday.votingHoursFrom.substr(vday.votingHoursFrom.length - 2)
                : "12:00 AM"
        );

        var eHr = (
            (!!vday.votingHoursTo && vday.votingHoursTo.toLowerCase() != NO_TIME_YET) ? vday.votingHoursTo.substr(0, vday.votingHoursTo.length - 2) + " " + vday.votingHoursTo.substr(vday.votingHoursTo.length - 2)
                : "11:59 PM"
        );

        var sDtStr = (dt.getMonth() + 1).toString() + "/" + dt.getDate() + "/" + dt.getFullYear() + " " + sHr;
        var eDtStr = (dt.getMonth() + 1).toString() + "/" + dt.getDate() + "/" + dt.getFullYear() + " " + eHr;

        var start = Date.parse(sDtStr);
        var end = Date.parse(eDtStr);
        var duration = Math.round(((end - start) / 1000) / 60);

        description += "\n\nVoting Hours (New York - Eastern Time): " + vday.votingHoursFrom + " to " + vday.votingHoursTo; 

        $.cal.generateCalendars({
            start: new Date(start),
            end: new Date(end),
            duration: duration,
            title: title,
            description: description,
            address: (isEarly ? _pollsite.ev_site_address : _pollsite.site_address)
        }, btn$);

        return btn$;
    }

    function addCalendarOption(name, options) {
        var opts = $.extend({
            icon: ""
        }, options);

        return $("<li>").append($("<a>")
            .addClass("cal-option cal-" + name)
            .attr({
                href: "javascript:void(0);"
            })
            .text(opts.label)
            .prepend($("<span>").addClass(opts.icon)))
            .click(function (e) {
                e.stopPropagation();
                $(this).closest(".cal-picker").removeClass("show");
            });
    }

    /* Map and Directions */

    function bindMap(site$, pollsite) {
        var map$ = site$.find(".site-map");
        var full$ = site$.find(".full-map");

        var mapaddr = pollsite.marker;
        var marker = { color: _settings.markerColor };

        var width = parseInt(map$.innerWidth());
        var height = parseInt(map$.innerHeight());

        var src = (pollsite.mapURI ||
            "https://maps.googleapis.com/maps/api/staticmap?markers=" + encodeURIComponent("color:" + marker.color.replace("#", "0x") + "|" + mapaddr) + "&size=" + width.toString() + "x" + height.toString() + "&maptype=roadmap&sensor=false&key=" + $("#hdnMapsApiKey").val()
        );

        map$.empty();
        map$.append($("<img>")
            .attr({
                src: src,
                target: "psmap"
            })
            .css({
                display: "block",
                "margin-left": "auto",
                "margin-right": "auto"
            })
        );

        updateFullMapLink(site$);
    }

    function updateFullMapLink(site$) {
        var form = this;

        if (!site$ || site$.length == 0) {
            $(".ps-info-wrapper").each(function () {
                updateFullMapLink($(this));
            });
        }
        else {
            var isEarly = site$.hasClass("early-voting");
            var full$ = site$.find(".full-map");

            var scode = Weglot.getCurrentLang();

            if (!!_pollsite && !!_pollsite.latitude) {

                full$.attr({
                    href: $.uri({
                        url: "https://maps.google.com/maps",
                        options: {
                            ll: _pollsite.latitude.toString() + "," + _pollsite.longitude.toString(),
                            z: 18, //zoom level
                            t: "m",
                            hl: scode + "-US",
                            gl: "US",
                            mapclient: "embed",
                            q: (isEarly ? _pollsite.ev_marker : _pollsite.marker)
                        }
                    }),
                    target: (isEarly ? _pollsite.ev_site_name : _pollsite.site_name)
                });
            }
        }
    }

    /* Contest List / Sample Ballot */

    function buildContestList(election, options) {

        var opts = $.extend({
            districtKey: "",
            altElectionId: ""
        }, options);

        if (!election && !!opts) {
            election = {
                BallotStatus: "has_ballot",
                ID: opts.altElectionId
            };
        }

        $("main")
            .removeClass("show-no-party-ballot")
            .toggleClass("has-ballot", election.BallotStatus.toLowerCase() == "has_ballot");

        _parties = {};
        $("#ddlParties").empty();
        $("#ballot").empty();

        var dk = opts.districtKey || (!!_pollsite ? _pollsite.districtKey : "");

        if (!dk) return;

        $.ajax({
            url: $.uri({
                url: "api/contestlist",
                options: {
                    districtkey: opts.districtKey || _pollsite.districtKey,
                    electionId: election.ID,
                    lang_code: _alpha3LangCodes[Weglot.getCurrentLang()] || "eng"
                }
            }),
            success: function (d) {
                if (!!d) {
                    $.each(d.parties, function () {
                        var p = this;

                        $("#ddlParties").append($("<option>")
                            .text(p.name)
                            .val(p.altId)
                        );

                        _parties[p.altId] = p;
                    });

                    if (!!opts.contestsOnly) {

                        _contestOnlyCDAltId = d.controllingDistrictAltId;
                        applySettings();
                    }
                }
            },
            error: function (xhr, status, msg) {

            },
            complete: function () {
                $("#ddlParties").trigger("change");
            }
        });

    }

    function addContestBlock(contest, partyId) {
        var n = 0;

        var contest$ = $("<div>")
            .attr("id", "can-list-" + partyId.toString() + "-" + (n++).toString())
            .addClass("candidacy-list party-" + partyId.toString())
            .append($("<h1>").text(contest.contest_description))
            .append($("<blockquote>").addClass("proposal-text").text(contest.proposal_text))
            .append($("<span>").addClass("vote-for-line").text(contest.choice_selection_instructions))
            .append($("<ul>").addClass("choices"));

        return contest$;
    }

    function addChoiceRow(choice) {
        var choice$ = $("<li>")
            .addClass("choice-row ballot-line")
            .append($("<a>")
                .attr({ href: "javascript:void(0);" })
                .append($("<div>")
                    .addClass("ballot-line-selectbox")
                    .append($("<span>").addClass("ballot-line-check icon-checkmark"))
                )
                .append($("<div>")
                    .addClass("ballot-line-info")
                    .append($("<h2>").text(choice.ballot_name))
                    .append($("<h3>").text(choice.party || ""))
                    .append($("<span>").text(choice.group))
                )
            );

        return choice$;
    }


    /* Back to Top Link */

    var dockTop = 50;
    var btn = $('#back-top');

    $(window).scroll(function (e) {

        dockTop = 50;

        if ($(this).scrollTop() > dockTop) {
            btn.addClass('show');
        }
        if ($(this).scrollTop() < dockTop) {
            btn.removeClass('show');
        }
    });

    function clear() {

        //sites
        $("#site_name").text("");
        $("#site_address").text("");
        $("#voter-entrance").text("");
        //$("#eday-details .voter-entrance").hide();
        //$("#eday-details .handicap-entrance").hide();
        $("#handicap_entrance").text("");
        //$("#eday-details .room").hide();
        $("#polling_room").text("");

        $("#ev_site_name").text("");
        $("#ev_site_address").text("");
        $("#ev_voter_entrance").text("");
        //$("#ev-details .voter-entrance").hide();
        //$("#ev-details .handicap-entrance").hide();
        $("#ev_handicap_entrance").text("");
        //$("#ev-details .room").hide();
        $("#ev_polling_room").text("");

        //schedules
        $("#ev-schedule table").find("tbody").empty();
        $("#eday-schedule table").find("tbody").empty();

        $("#ev-schedule .cal-schedule").empty();
        $("#eday-schedule .cal-schedule").empty();

        //maps
        $("#eday-site").find(".site-map").empty();
        $("#ev-site").find(".site-map").empty();

        //contest list/sample ballot
        $("#ddlParties").empty();
        $("#ballot").empty();

        //districts
        $("#election_district").text("");
        $("#split").text("");
        $("#judicial_district").text("");
        $("#congress_district").text("");
        $("#senate_district").text("");
        $("#council_district").text("");
        $("#county_council_district").text("");
        $("#municipal_court_district").text("");
        $("#assembly_district").text("");
        $("#school_district").text("");
        $("#magistrate_jury_area").text("");
        $("#municipality").text("");
        $("#jury_pool").text("");



    }

})(jQuery);