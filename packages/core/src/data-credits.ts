/**
 * The credits of the data the app uses, as the desktop's "Crédits des données" window and the phone's page list them:
 * the catalogues shipped with the app, the reference documents, and the online data downloaded when the horizon of
 * a place is computed. Names and details are the sources' own (not translated); licences, notes and section texts
 * are translated at call time.
 */
import { t } from './i18n/index';

export interface DataCredit {
  name: string;
  detail: string;
  url?: string;
  linkText?: string;
  license?: string;
  licenseUrl?: string;
  note?: string;
}

export interface DataCreditSection {
  label: string;
  /** A line under the section's label. */
  intro?: string;
  credits: DataCredit[];
}

const CC_BY_SA_4 = 'https://creativecommons.org/licenses/by-sa/4.0/';
const ETALAB_2 = 'https://www.etalab.gouv.fr/licence-ouverte-open-licence/';

export function dataCreditSections(): DataCreditSection[] {
  const allRights = t('settings.dataCreditsLicenseAllRights');
  return [
    {
      label: t('settings.dataCreditsCatalogsLabel'),
      credits: [
        {
          name: 'Stars — d3-celestial',
          detail: 'Olaf Frohn · Hipparcos data (ESA)',
          url: 'https://github.com/ofrohn/d3-celestial',
          linkText: 'github.com/ofrohn/d3-celestial',
          license: 'BSD 3-Clause',
          licenseUrl: 'https://github.com/ofrohn/d3-celestial/blob/master/LICENSE',
        },
        {
          name: 'Deep-sky objects — OpenNGC',
          detail: 'Mattia Verga',
          url: 'https://github.com/mattiaverga/OpenNGC',
          linkText: 'github.com/mattiaverga/OpenNGC',
          license: 'CC BY-SA 4.0',
          licenseUrl: CC_BY_SA_4,
        },
        {
          name: 'Coordinates — SIMBAD',
          detail: 'CDS, Université de Strasbourg',
          url: 'https://simbad.cds.unistra.fr',
          linkText: 'simbad.cds.unistra.fr',
          license: 'Etalab 2.0',
          licenseUrl: ETALAB_2,
        },
        {
          name: 'Coordinates — VizieR',
          detail: 'CDS, Université de Strasbourg',
          url: 'https://vizier.cds.unistra.fr',
          linkText: 'vizier.cds.unistra.fr',
          license: 'Etalab 2.0',
          licenseUrl: ETALAB_2,
        },
        {
          name: 'Constellation boundaries',
          detail: 'IAU · Eugène Delporte, 1930',
          license: t('settings.dataCreditsLicensePublicDomain'),
        },
        {
          name: 'Constellation figures — Stellarium sky cultures',
          detail: 'modern · H.A. Rey · Chinese',
          url: 'https://github.com/Stellarium/stellarium/tree/master/skycultures',
          linkText: 'stellarium/skycultures',
          license: 'CC BY-SA 4.0',
          licenseUrl: CC_BY_SA_4,
        },
        {
          // Listed separately from the three CC BY-SA cultures above: al-Sufi is the
          // one sky culture Stellarium releases under a no-derivatives licence.
          name: 'Constellation figures — Arabic (al-Sufi)',
          detail: 'Stellarium sky culture · after ʿAbd al-Rahman al-Sufi, c. 964',
          url: 'https://github.com/Stellarium/stellarium/tree/master/skycultures/arabic_al-sufi',
          linkText: 'stellarium/arabic_al-sufi',
          license: 'CC BY-ND 4.0',
          licenseUrl: 'https://creativecommons.org/licenses/by-nd/4.0/',
        },
      ],
    },
    {
      label: t('settings.dataCreditsDocsLabel'),
      credits: [
        { name: 'The 750 Best Deep Sky Objects', detail: '© 2024 Gary Imm', license: allRights },
        {
          name: 'Large PN Observing Atlas',
          detail: 'Reiner Vogel · version 03/2013',
          url: 'https://www.reinervogel.net/LargePN/LargePN_e.html',
          linkText: 'reinervogel.net',
          license: allRights,
          note: t('settings.dataCreditsLargePnNote'),
        },
        {
          name: 'Finest NGC Chart/Log System',
          detail: 'Terry Adrian · © Royal Astronomical Society of Canada',
          url: 'https://www.rasc.ca/finest-ngc-objects',
          linkText: 'rasc.ca/finest-ngc-objects',
          license: allRights,
        },
      ],
    },
    {
      // Downloaded at run time, not shipped: OpenStreetMap's ODbL and several of the elevation sources ask for
      // attribution wherever their data is shown (the peak names and the skyline of the horizon).
      label: t('settings.dataCreditsOnlineLabel'),
      intro: t('settings.dataCreditsOnlineIntro'),
      credits: [
        {
          name: 'Peak names — OpenStreetMap',
          detail: '© OpenStreetMap contributors · Overpass API',
          url: 'https://www.openstreetmap.org/copyright',
          linkText: 'openstreetmap.org/copyright',
          license: 'ODbL 1.0',
          licenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
        },
        {
          name: 'Elevation — Terrain Tiles',
          detail:
            'Mapzen · AWS Open Data · USGS (SRTM, GMTED2010, 3DEP), NOAA ETOPO1, Copernicus EU-DEM and others',
          url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
          linkText: 'tilezen/joerd attribution',
        },
      ],
    },
  ];
}
