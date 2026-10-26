export const ORIGIN_COUNTRY = 'United Kingdom';
export const ORIGIN_CITIES = ['London', 'Manchester', 'Birmingham', 'Leeds'] as const;
export const DESTINATION_CITIES: Record<string, readonly string[]> = {
  Germany: ['Berlin', 'Frankfurt', 'Hamburg'],
  France: ['Paris', 'Lyon'],
  Netherlands: ['Amsterdam', 'Rotterdam'],
};
export const DESTINATION_COUNTRIES = Object.keys(DESTINATION_CITIES);
export const ALL_DESTINATION_CITIES = Object.values(DESTINATION_CITIES).flat();
export const CURRENCY = 'GBP';
export const ITEM_COUNTRIES = ['United Kingdom', 'China', 'India', 'Vietnam', 'Turkey', 'Germany'] as const;
export const DESTINATION_TYPES = ['Warehouse', 'Business address'] as const;
export const PRIORITIES = ['Cheapest', 'Fastest', 'Most reliable', 'Balanced'] as const;
export type Priority = (typeof PRIORITIES)[number];
export type DestinationType = (typeof DESTINATION_TYPES)[number];

/** city -> country for every supported city (origin and destination). */
export const CITY_TO_COUNTRY: Record<string, string> = {
  ...Object.fromEntries(ORIGIN_CITIES.map((c) => [c, ORIGIN_COUNTRY])),
  ...Object.fromEntries(Object.entries(DESTINATION_CITIES).flatMap(([country, cities]) => cities.map((c) => [c, country]))),
};

/** Keys are normalised (lower-case, no diacritics, no full stops, single spaces). */
export const COUNTRY_ALIASES: Record<string, string> = {
  uk: 'United Kingdom',
  'great britain': 'United Kingdom',
  gb: 'United Kingdom',
  england: 'United Kingdom',
  britain: 'United Kingdom',
  de: 'Germany',
  deutschland: 'Germany',
  fr: 'France',
  nl: 'Netherlands',
  holland: 'Netherlands',
  'the netherlands': 'Netherlands',
  prc: 'China',
  turkiye: 'Turkey',
};
export const CITY_ALIASES: Record<string, string> = {
  frankfort: 'Frankfurt',
  'frankfurt am main': 'Frankfurt',
};
export const PRIORITY_ALIASES: Record<string, string> = {
  cheap: 'Cheapest',
  lowest: 'Cheapest',
  fast: 'Fastest',
  quickest: 'Fastest',
  reliable: 'Most reliable',
  'most reliable': 'Most reliable',
  balance: 'Balanced',
};
export const DESTINATION_TYPE_ALIASES: Record<string, string> = {
  business: 'Business address',
  'business address': 'Business address',
  address: 'Business address',
};

/** Cities/countries we recognise but do not serve, so we can say so politely. */
export const UNSUPPORTED_PLACES = [
  'Köln', 'Cologne', 'Munich', 'München', 'Stuttgart', 'Düsseldorf', 'Dusseldorf', 'Leipzig', 'Dresden', 'Nuremberg', 'Nürnberg',
  'Marseille', 'Nice', 'Toulouse', 'Bordeaux', 'Lille', 'Nantes', 'Strasbourg',
  'Utrecht', 'The Hague', 'Eindhoven', 'Brussels', 'Antwerp', 'Madrid', 'Barcelona', 'Milan', 'Rome', 'Vienna', 'Zurich', 'Dublin',
  'Warsaw', 'Prague', 'Lisbon', 'Copenhagen', 'Stockholm', 'Oslo', 'Glasgow', 'Edinburgh', 'Bristol', 'Liverpool', 'Sheffield',
  'Spain', 'Italy', 'Belgium', 'Poland', 'Ireland', 'Austria', 'Switzerland', 'Portugal', 'Denmark', 'Sweden', 'Norway', 'USA', 'America',
  'Canada', 'Australia', 'Scotland', 'Wales',
];
