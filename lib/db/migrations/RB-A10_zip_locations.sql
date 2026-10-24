CREATE TABLE zip_location (
  zip text NOT NULL CHECK (zip ~ '^[0-9]{5}$'),
  boundary_year integer NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  postal jsonb,
  source_urls jsonb NOT NULL,
  checked_at timestamptz NOT NULL,
  PRIMARY KEY (zip,boundary_year)
);
