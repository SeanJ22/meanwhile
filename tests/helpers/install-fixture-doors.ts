/** Preloaded for every test process: the fixture meeting doors are installed before any test module reads them. */
import { installFixtureDoors } from "./meeting-doors-fixture.ts";
import { fixturePlaceMapQuery } from "./place-map.ts";
import { installPlaceMapQuery } from "../../lib/place-map/reader.ts";

installFixtureDoors();
installPlaceMapQuery(fixturePlaceMapQuery());
