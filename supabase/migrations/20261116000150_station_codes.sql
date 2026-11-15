-- Only the seven scan stations may be a profile's station (RECEIVED is intake, not a station).
alter table public.profiles add constraint profiles_station_codes
  check (station is null or station in ('RSB', 'WEFTING', 'VENT_MARINDUQUE', 'VENT_HQ_PCR', 'VENT_HQ_FIXING', 'CURLING', 'FOR_QA'));
