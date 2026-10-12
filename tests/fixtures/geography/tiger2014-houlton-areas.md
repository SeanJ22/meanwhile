# Real Census Houlton area polygons

These two complete features retain the Census attributes and polygon vertices
of `1530R` and `1530T` from the TIGER/Line 2014 GeoJSON mirror:

<https://github.com/boundaryissues/TIGER2014/blob/e6325ba3074e1668c6c4fe4c0d4e65c940e87d16/native/AIANNH/tl_2014_us_aiannh.geojson>

Captured on 2026-10-12. The source directory describes the file as a GeoJSON
conversion of Census TIGER/Line 2014. This is a genuine boundary fixture from
that vintage, not evidence that the 2020 routine source has been acquired.

The trust-land feature's own `INTPTLAT` and `INTPTLON` identify the positive
test point: latitude `46.1716537`, longitude `-67.8096846`. A Portland point
at `43.6591`, `-70.2568` is the negative test. Tests preserve the reservation
and trust-land components as one Census four-digit area for ZIP weighting.
