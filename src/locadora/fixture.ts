import { normalizeDiscoveryTitle, type DiscoveryTitle, type PublicTitlePayload } from '../domain/content';

const SYNTHETIC_TITLES: PublicTitlePayload[] = [
  { id: 101, imdbId: 'tt1254207', type: 'movie', name: 'Big Buck Bunny', year: 2008, genres: ['Animation', 'Comedy'], description: 'A gentle giant meets three tiny troublemakers in this open-movie classic.' },
  { id: 102, imdbId: 'tt1727587', type: 'movie', name: 'Sintel', year: 2010, genres: ['Animation', 'Fantasy'], description: 'A lone traveler crosses a wintry world looking for a lost dragon.' },
  { id: 103, imdbId: 'tt2285752', type: 'movie', name: 'Tears of Steel', year: 2012, genres: ['Sci-Fi', 'Drama'], description: 'Scientists and warriors face a robot invasion in a transformed Amsterdam.' },
  { id: 104, imdbId: 'tt0807840', type: 'movie', name: 'Elephants Dream', year: 2006, genres: ['Animation', 'Sci-Fi'], description: 'Two travelers explore the workings of a mysterious machine.' },
  { id: 105, imdbId: 'tt6381634', type: 'movie', name: 'Agent 327: Operation Barbershop', year: 2017, genres: ['Animation', 'Action', 'Comedy'], description: 'A secret agent walks into a barbershop and discovers more than a haircut.' },
  { id: 106, imdbId: 'tt1002563', type: 'movie', name: 'A Trip to the Moon', year: 1902, genres: ['Sci-Fi', 'Adventure'], description: 'Astronomers launch a capsule toward the Moon in a landmark fantasy.' },
  { id: 107, imdbId: 'tt0000439', type: 'movie', name: 'The Great Train Robbery', year: 1903, genres: ['Action', 'Crime'], description: 'Bandits stage a daring robbery in an early narrative film.' },
  { id: 108, imdbId: 'tt0006206', type: 'movie', name: 'Les Vampires', year: 1915, genres: ['Crime', 'Drama'], description: 'A reporter pursues a strange criminal society through Paris.' },
  { id: 201, imdbId: 'tt3107288', type: 'series', name: 'The Flash', year: 2014, genres: ['Action', 'Adventure', 'Drama'], description: 'A fast-moving series placeholder used only to exercise series browsing.' },
  { id: 202, imdbId: 'tt0903747', type: 'series', name: 'Breaking Bad', year: 2008, genres: ['Crime', 'Drama'], description: 'A series placeholder used to verify title and episode boundaries.' },
  { id: 203, imdbId: 'tt0944947', type: 'series', name: 'Game of Thrones', year: 2011, genres: ['Drama', 'Fantasy'], description: 'A series placeholder used to verify manual-only source selection.' },
  { id: 204, imdbId: 'tt2861424', type: 'series', name: 'Rick and Morty', year: 2013, genres: ['Animation', 'Comedy', 'Sci-Fi'], description: 'An animated series placeholder for catalogue layout testing.' },
];

export const FIXTURE_TITLES: DiscoveryTitle[] = SYNTHETIC_TITLES
  .map(normalizeDiscoveryTitle)
  .filter((title): title is DiscoveryTitle => title !== null);
