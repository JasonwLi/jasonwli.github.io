/**
 * Data and type credits, rendered by src/sections/Credits.tsx in the footer.
 * Keys match manifest.credits ids (INT acceptance: every manifest id appears).
 * Beck et al. is CC BY 4.0: credit plus a licence link are mandatory.
 */
export interface Credit {
  id: string
  text: string
  url: string
  licenceUrl?: string
}

export const credits: Credit[] = [
  {
    id: 'etopo',
    text: 'Relief: ETOPO 2022, NOAA NCEI',
    url: 'https://doi.org/10.25921/fd45-gt74',
  },
  {
    id: 'ne',
    text: 'Natural Earth',
    url: 'https://www.naturalearthdata.com/',
  },
  {
    id: 'modis',
    text: 'Land cover: NASA MODIS MCD12Q1 v061 via NASA GIBS',
    url: 'https://www.earthdata.nasa.gov/data/catalog/lpcloud-mcd12q1-061',
  },
  {
    id: 'koppen',
    text: 'Climate: Beck et al. 2023, Köppen-Geiger 1991-2020, Sci. Data 10:724 (CC BY 4.0)',
    url: 'https://doi.org/10.1038/s41597-023-02549-6',
    licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
  },
  {
    id: 'detail',
    text: 'Detail textures: Poly Haven / ambientCG (CC0)',
    url: 'https://polyhaven.com/',
    licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  },
  {
    id: 'castoro',
    text: 'Castoro type by Tiro Typeworks (SIL OFL)',
    url: 'https://github.com/TiroTypeworks/Castoro',
    licenceUrl: 'https://openfontlicense.org/',
  },
]
