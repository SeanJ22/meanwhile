# September 4 flight and state relief

The frozen PERF-1 and MAP-6 changes were measured before changing camera
presentation. `scripts/measure-tester-flight.mts` exercised the real ZIP-entry
flight, then two repeat flights, on the same isolated local app, browser,
hardware renderer, viewport and camera settings. Dev route compilation was
warmed outside each fresh visitor measurement. No video, civic acquisition,
database credentials or model calls were used.

The same probe records rAF gaps, Long Tasks, application layer mutations,
React hook changes, requests and MapLibre event callbacks. The compact raw
observations are in `tester-flight-9-4.json`. Hook-change observations include
effects/memos as well as state; they are not an inferred count of user actions.

| Flight | Before p95 / max ms | After p95 / max ms | Before / after >32 ms frames | Before / after application map mutations | Before / after React commits |
|---|---:|---:|---:|---:|---:|
| First ZIP entry | 33.3 / 83.3 | 16.8 / 116.7 | 10 / 2 | 32 / 0 | 78 / 1 |
| Repeat 1 | 50.0 / 66.7 | 16.7 / 33.3 | 24 / 2 | 0 / 0 | 61 / 1 |
| Repeat 2 | 49.9 / 166.6 | 16.8 / 16.8 | 15 / 0 | 0 / 0 | 64 / 1 |

Median frame intervals remain 16.7 ms. Before: no Long Tasks were recorded.
After: the first flight retains one 104 ms main-thread task; repeat flights
have none. This is a remaining first-flight spike, not concealed by the improved
p95. The change removes competing work and improves pacing; it does not claim
every frame is perfect. Actual flight durations remain approximately 2.6 s.
`flyTo` retains `duration: 2600`, `curve: 1.5`, `essential: true`. No animation
constant was tuned. The map remains flat Mercator, with rotation disabled.

Before, the first flight added 8 district sources and 24 district layers. Both
repeat flights carried all 24 visible district layers. StateFocusOverlay
committed 73/61/64 times during the three flights from its continuous move/zoom
schedule. The first Who Governs Here `/api/meetings` request started 0.4 ms after
motion began and finished during motion.

After, first entry has no application layers; repeats retain 29 cached district
and relief layers with visibility `none`. No application add/remove, paint,
filter, feature-state or rendered-feature query runs inside any motion window.
Continuous move and zoom listeners are MapLibre camera/control/marker work;
the StateFocusOverlay listeners are gone. Render has no application callback.
Moveend keeps the existing debounced camera memory and schedules a guarded
source refresh; it does not reveal overlays. Idle releases the hold, reconciles
district layers, loads canonical relief geometry and releases Who Governs Here.
The sole in-flight MapCanvas commit changes the presentation state at the
transition. There is no React update driven by continuous movement.

The first post-motion idle arrived 136.7 ms after motion ended. Who Governs Here
began 14.8 ms after that idle and finished 69.7 ms after it. Repeat requests also
begin after idle (12.8 and 13.2 ms). During motion, only base-map glyph requests
remain on first entry, with no application requests in the repeat flights.
The loading presentation is four neutral gray blocks plus the actual heading;
it contains no jurisdiction, official or invented district data. Map markers
are hidden by one motion attribute and restored at idle.

The MapTiler attribution source reported loaded, and the relevant idle events
were observed in both arms. Older comments saying this source could never reach
idle were superseded where touched. The sequencing follows the documented
[MapLibre idle event](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapEventType/).
The supplied [Mapbox flight example](https://docs.mapbox.com/mapbox-gl-js/example/flyto/)
is the motion reference, without adopting its basemap or projection.

MAP-6 uses five style layers: an offset state-shaped shadow fill, a blurred
shadow edge, a material surface fill, and separate illuminated/shaded edges.
All sources use the existing canonical state feature with GeoJSON tolerance 0.
Directional edges are derived mechanically from each segment's Mercator normal;
every coordinate and consecutive edge is conserved, including river bends and
holes. No state is special-cased. The canonical fixture currently covers the
three states in the coverage manifest; the proof compares that manifest exactly.
There is no rendered DOM/SVG state follower and no relief animation. Light and
dark paint values are separate. Visual proof at multiple zooms is recorded in
the final visual receipt.

Targeted geometry, motion wiring and existing state-focus controls: 30 passed.
The superseded software-only/moveend source assertions now enforce all-renderer
holding and idle reveal; the original renderer classifier and normalized
software performance floors remain protected.
